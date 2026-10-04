"""Portable, interactive report of topic changes in the collected sample."""

import html
import json
import math
from datetime import datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit


def _e(value):
    return html.escape(str(value if value is not None else "Unavailable"), quote=True)


def _number(value, digits=1):
    try:
        value = float(value)
        if not math.isfinite(value):
            return "Unavailable"
        return f"{value:,.{digits}f}" if digits else f"{value:,.0f}"
    except (TypeError, ValueError):
        return "Unavailable"


def _safe_url(value):
    value = str(value or "")
    try:
        parsed = urlsplit(value)
        return value if parsed.scheme.lower() in {"https", "http"} and parsed.netloc and not any(ord(c) < 32 for c in value) else None
    except ValueError:
        return None


def _stories(stories):
    if not stories:
        return '<p class="muted">No examples in this period.</p>'
    rows = []
    for story in stories[:3]:
        title = _e(story.get("title", "Untitled Story"))
        url = _safe_url(story.get("url"))
        link = f'<a href="{_e(url)}" target="_blank" rel="noopener noreferrer">{title}</a>' if url else title
        rows.append(f'<li>{link}<small>{_e(_story_date(story.get("date", "")))} · r/{_e(story.get("sub", ""))} · {_number(story.get("votes"), 0)} saved votes · {_number(story.get("comments"), 0)} comments</small></li>')
    return '<ul class="stories">' + ''.join(rows) + '</ul>'


def _day(value):
    return str(value or "Unavailable")[:10]


def _story_date(value):
    raw = str(value or "")
    if len(raw) <= 10:
        return raw
    try:
        stamp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            return _day(raw)
        stamp = stamp.astimezone(ZoneInfo("America/Los_Angeles"))
        return f"{stamp.strftime('%b')} {stamp.day}, {stamp.year} {stamp.hour % 12 or 12}:{stamp.minute:02d} {stamp.strftime('%p %Z')}"
    except ValueError:
        return raw


def _sparkline(history):
    segments, segment, values = [], [], []
    for index, point in enumerate(history):
        try:
            value = float(point.get("share_pct"))
            if not math.isfinite(value):
                raise ValueError
        except (TypeError, ValueError):
            if segment:
                segments.append(segment)
                segment = []
            continue
        segment.append((index, value))
        values.append(value)
    if segment:
        segments.append(segment)
    if not values:
        return '<p class="muted">No weekly history available.</p>'
    maximum = max(max(values), 1)
    paths = []
    for group in segments:
        points = ' '.join(f'{8 + i * 344 / max(len(history)-1, 1):.1f},{72-value / maximum * 58:.1f}' for i, value in group)
        paths.append(f'<polyline points="{points}" fill="none" stroke="#91ceff" stroke-width="2.5"/>')
        for i, value in group:
            paths.append(f'<circle cx="{8 + i * 344 / max(len(history)-1, 1):.1f}" cy="{72-value / maximum * 58:.1f}" r="2" fill="#91ceff"/>')
    return '<svg viewBox="0 0 360 86" role="img" aria-label="Weekly share of collected posts, gaps mean no data"><title>Weekly share of collected posts, gaps mean no data</title><line x1="8" y1="72" x2="352" y2="72" stroke="#354455"/>' + ''.join(paths) + '</svg>'


def _cards(topics):
    output = []
    for topic in topics:
        m = topic.get("metrics", {})
        examples = topic.get("examples", {})
        history = topic.get("history", [])
        rows = ''.join(f'<tr><td>{_e(_day(h.get("start")))} to {_e(_day(h.get("end")))}</td><td>{_number(h.get("count"), 0)}</td><td>{_number(h.get("share_pct"))}%</td></tr>' for h in history)
        output.append(f'<details class="topic"><summary>{_e(topic.get("name", "Unnamed Topic"))}<span>{_number(m.get("current_count"), 0)} recent posts · {_number(m.get("share_change_pp"))} point share change</span></summary><div class="topic-body"><p class="muted">Headlines grouped automatically. Check examples.</p><p><strong>Keywords:</strong> {_e(", ".join(topic.get("keywords", [])))}</p>{_sparkline(history)}<details><summary>Weekly Counts and Shares</summary><div class="table-wrap"><table><thead><tr><th>Week</th><th>Posts</th><th>Share</th></tr></thead><tbody>{rows}</tbody></table></div></details><div class="examples"><div><h3>Recent Stories</h3>{_stories(examples.get("current", []))}</div><div><h3>Earlier Stories</h3>{_stories(examples.get("previous", []))}</div></div></div></details>')
    return ''.join(output) or '<p>No topics are available for this sample.</p>'


def _table(topics):
    rows = []
    for topic in sorted(topics, key=lambda t: -(t.get("metrics", {}).get("share_change_pp") or 0)):
        m = topic.get("metrics", {})
        rows.append(f'<tr><th scope="row">{_e(topic.get("name", "Unnamed Topic"))}</th><td>{_number(m.get("previous_count"), 0)} → {_number(m.get("current_count"), 0)}</td><td>{_number(m.get("previous_share_pct"))}% → {_number(m.get("current_share_pct"))}%</td><td>{_number(m.get("share_change_pp"))}</td><td>Choose a Subreddit</td><td>Choose a Subreddit</td><td>{"Enough Posts" if m.get("stable_comparison") else "New in This Period" if (m.get("current_count") or 0) >= 10 and m.get("previous_count") == 0 else "Absent Recently" if (m.get("previous_count") or 0) >= 10 and m.get("current_count") == 0 else "Few Posts"}</td></tr>')
    return '<div class="table-wrap"><table><thead><tr><th>Topic</th><th>Posts, Earlier → Recent</th><th>Share, Earlier → Recent</th><th>Share Change (Points)</th><th>Saved Median Votes</th><th>Saved Median Comments</th><th>Comparison</th></tr></thead><tbody>' + ''.join(rows) + '</tbody></table></div>'


def render_topic_report(result):
    """Render safe HTML with useful initial content and offline browser controls."""
    topics = result.get("topics", [])
    sample = result.get("sample", {})
    periods = result.get("periods", {})
    current, previous = periods.get("current", {}), periods.get("previous", {})
    payload = json.dumps(result, ensure_ascii=False, allow_nan=False, default=str)
    for raw, escaped in [("&", "\\u0026"), ("<", "\\u003c"), (">", "\\u003e"), ("\u2028", "\\u2028"), ("\u2029", "\\u2029")]:
        payload = payload.replace(raw, escaped)
    options = ''.join(f'<option value="{index}">r/{_e(row.get("name"))}</option>' for index, row in enumerate(result.get("subreddits", [])))
    technical = _e(json.dumps(result.get("method", {}), ensure_ascii=False, indent=2, default=str))
    period_text = f'Recent: {_day(current.get("start"))} to {_day(current.get("end"))}. Earlier: {_day(previous.get("start"))} to {_day(previous.get("end"))}.'
    page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>What Topics Are Changing?</title><style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#0c131b;color:#e9f1f8}*{box-sizing:border-box}body{margin:0}main{max-width:1280px;margin:auto;padding:48px 24px}h1{font-size:clamp(2rem,4vw,3.5rem);margin:12px 0 16px;letter-spacing:-.04em}h2{font-size:1.4rem;margin:0 0 16px}h3{font-size:1rem}p{line-height:1.6;max-width:900px}a{color:#91ceff;overflow-wrap:anywhere}small{display:block;color:#a5b6c7;margin-top:7px}.muted,footer{color:#a5b6c7}.eyebrow{font-size:.8rem;text-transform:uppercase;letter-spacing:.16em;color:#80d3bb}.intro{font-size:1.1rem}.coverage{display:flex;gap:36px;flex-wrap:wrap;padding:24px 0;border-top:1px solid #354455;border-bottom:1px solid #354455;margin:28px 0}.coverage b{font-size:1.8rem;display:block}.controls{display:flex;gap:18px;flex-wrap:wrap;margin:28px 0}.controls label{display:flex;flex-direction:column;gap:8px;font-size:.85rem;flex:1;min-width:190px}select,input{background:#182432;color:#e9f1f8;border:1px solid #536479;border-radius:6px;padding:12px;font:inherit;max-width:100%}:focus-visible{outline:2px solid #91ceff;outline-offset:4px}.period{font-size:.9rem;padding:16px;background:#182432;border-left:3px solid #80d3bb}section{margin:36px 0}.leaders{display:grid;grid-template-columns:1fr 1fr;gap:28px}.leaders>div{background:#131f2c;padding:22px;border:1px solid #354455;border-radius:8px}.bar-row{display:grid;grid-template-columns:minmax(140px,1fr) 100px;gap:10px;padding:10px 0;border-bottom:1px solid #354455;font-size:.9rem}.bar-row strong{text-align:right}.bar{grid-column:1/-1;height:5px;background:#273748}.bar span{display:block;height:100%;background:#80d3bb}.falling .bar span{background:#e6ac97}.table-wrap{overflow-x:auto;border:1px solid #354455;border-radius:8px}table{border-collapse:collapse;width:100%;font-size:.85rem}th,td{padding:13px;text-align:left;vertical-align:top;border-bottom:1px solid #354455;min-width:110px}thead th{background:#1d2b3c}tbody th{font-weight:500;min-width:200px}tbody tr:last-child>*{border-bottom:0}details{margin:16px 0}summary{cursor:pointer;line-height:1.5}details.topic{border:1px solid #354455;border-radius:8px;background:#131f2c}details.topic>summary{padding:20px;font-weight:600}summary span{display:block;font-weight:400;font-size:.85rem;color:#a5b6c7;margin-top:5px}.topic-body{padding:0 22px 22px}.topic-body svg{width:100%;max-width:600px;display:block}.examples{display:grid;grid-template-columns:1fr 1fr;gap:28px}.stories{padding-left:20px}.stories li{margin:18px 0;line-height:1.5}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:20px;background:#182432}footer{font-size:.85rem;line-height:1.6;margin-top:40px}[hidden]{display:none!important}@media(max-width:700px){main{padding:28px 16px}.leaders,.examples{grid-template-columns:1fr}.coverage{gap:24px}.topic-body{padding:0 16px 16px}}
</style></head><body><main><div class="eyebrow">The Collected News Sample</div><h1>What Topics Are Changing?</h1><p class="intro"><strong>More Posts</strong> compares each topic’s share of collected headlines. <strong>More Votes</strong> and <strong>More Comments</strong> compare counts saved at similar post ages.</p><p class="muted">These results describe the posts we collected, not all of Reddit. Headlines grouped automatically. Check examples.</p>
<div class="coverage"><div><b>__POSTS__</b>Collected Posts</div><div><b>__SUBS__</b>Subreddits</div><div><b>__TOPICS__</b>Topic Groups</div><div><b>__RANGE__</b>Collected Post Dates</div></div>
<div class="controls"><label>Subreddit<select id="subreddit"><option value="all">All Collected Subreddits</option>__OPTIONS__</select></label><label>Compare<select id="measure"><option value="posts">More Posts</option><option value="reactions">More Votes</option><option value="comments">More Comments</option></select></label><label>Search Topics or Example Headlines<input id="search" type="search" placeholder="Try election, space, or a headline"></label></div>
<p id="period" class="period">__PERIOD__</p><p id="view-counts" class="muted">__COUNTS__</p><p id="adjustment-note" class="muted"></p><p id="measure-note">A share change of +2 points means 2 more posts out of every 100 covered that topic. Small groups can swing easily.</p><noscript><p>Interactive filters require JavaScript. All topics and story examples are shown below.</p></noscript>
<section id="ranking" hidden><div class="leaders"><div><h2>Rising Topics</h2><div id="rising"></div></div><div class="falling"><h2>Falling Topics</h2><div id="falling"></div></div></section>
<section><h2>Topic Comparisons</h2><p id="result-count" class="muted" role="status" aria-live="polite">__TOPICS__ topics shown. Earlier values appear before recent values.</p><div id="comparisons">__TABLE__</div></section><section><h2>Explore Every Topic</h2><p class="muted">Open a topic for weekly counts, keywords, and real stories from each period. A higher line means a larger weekly share; each chart uses its own scale.</p><div id="topic-cards">__CARDS__</div></section><details><summary>How the Comparisons Work</summary><p>Topics are learned from earlier headlines, then used to group later headlines. The latest collected post sets the recent comparison period. Its preceding period is the same length. Each subreddit filter uses that same pair of dates.</p><p>Saved votes and comments are snapshots, not lifetime totals or new reactions during the week. Posts of similar ages are compared where enough data are available. Missing values mean the sample cannot support that comparison. Open the technical details for the exact method.</p><pre>__METHOD__</pre></details><footer>This file works offline and loads no external assets. Story links open their original destinations.</footer></main><script type="application/json" id="topic-data">__DATA__</script><script>
__SCRIPT__
</script></body></html>'''
    replacements = {
        "__POSTS__": _number(sample.get("posts"), 0), "__SUBS__": _number(sample.get("subreddits"), 0),
        "__TOPICS__": str(len(topics)), "__RANGE__": _e(str(sample.get("earliest_created_at", "Unavailable"))[:10] + " to " + str(sample.get("latest_created_at", "Unavailable"))[:10]),
        "__OPTIONS__": options, "__PERIOD__": _e(period_text),
        "__COUNTS__": _e(f'{_number(previous.get("count"), 0)} earlier posts and {_number(current.get("count"), 0)} recent posts.'),
        "__TABLE__": _table(topics), "__CARDS__": _cards(topics), "__METHOD__": technical, "__DATA__": payload, "__SCRIPT__": _SCRIPT,
    }
    # Substitute once so source strings containing template tokens stay literal.
    import re
    return re.sub(r'__[A-Z_-]+__', lambda match: replacements.get(match.group(), match.group()), page)


_SCRIPT = r'''"use strict";
const data=JSON.parse(document.getElementById("topic-data").textContent);
const $=id=>document.getElementById(id), fmt=(v,d=1)=>v==null||!Number.isFinite(Number(v))?"Unavailable":Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
function el(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n;}
function safeUrl(value){try{if(/[\u0000-\u001f]/.test(value)||!/^https?:\/\//i.test(value))return null;const u=new URL(value);return ["https:","http:"].includes(u.protocol)&&u.hostname?u.href:null;}catch{return null;}}
function stories(rows){if(!rows?.length)return el("p","No examples in this period.","muted");const list=el("ul",null,"stories");rows.slice(0,3).forEach(s=>{const li=el("li"),url=safeUrl(String(s.url||""));if(url){const a=el("a",s.title||"Untitled Story");a.href=url;a.target="_blank";a.rel="noopener noreferrer";li.append(a);}else li.append(el("span",s.title||"Untitled Story"));li.append(el("small",`${storyDate(s.date)} · r/${s.sub||""} · ${fmt(s.votes,0)} saved votes · ${fmt(s.comments,0)} comments`));list.append(li);});return list;}
function table(headers,rows){const wrap=el("div",null,"table-wrap"),t=el("table"),head=el("thead"),tr=el("tr");headers.forEach(h=>{const th=el("th",h);th.scope="col";tr.append(th);});head.append(tr);const body=el("tbody");rows.forEach(row=>{const line=el("tr");row.forEach((v,i)=>{const cell=el(i===0?"th":"td",v);if(i===0)cell.scope="row";line.append(cell);});body.append(line);});t.append(head,body);wrap.append(t);return wrap;}
const day=value=>String(value||"Unavailable").slice(0,10);
function storyDate(value){const raw=String(value||"");if(raw.length<=10)return raw;const stamp=new Date(raw);if(Number.isNaN(stamp.valueOf()))return raw;return stamp.toLocaleString("en-US",{timeZone:"America/Los_Angeles",month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",hour12:true,timeZoneName:"short"});}
function trend(history){const values=(history||[]).map(h=>h.share_pct==null||String(h.share_pct).trim()===""?null:Number(h.share_pct));const available=values.filter(v=>v!==null&&Number.isFinite(v));if(!available.length)return el("p","No weekly history available.","muted");const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");svg.setAttribute("viewBox","0 0 360 86");svg.setAttribute("role","img");svg.setAttribute("aria-label","Weekly share of collected posts, gaps mean no data");const title=document.createElementNS(ns,"title");title.textContent="Weekly share of collected posts, gaps mean no data";svg.append(title);const max=Math.max(1,...available);let group=[];function flush(){if(!group.length)return;const path=document.createElementNS(ns,"polyline");path.setAttribute("points",group.map(([i,v])=>`${8+i*344/Math.max(1,values.length-1)},${72-v/max*58}`).join(" "));path.setAttribute("fill","none");path.setAttribute("stroke","#91ceff");path.setAttribute("stroke-width","2.5");svg.append(path);group.forEach(([i,v])=>{const point=document.createElementNS(ns,"circle");point.setAttribute("cx",8+i*344/Math.max(1,values.length-1));point.setAttribute("cy",72-v/max*58);point.setAttribute("r","2");point.setAttribute("fill","#91ceff");svg.append(point);});group=[];}values.forEach((v,i)=>{if(v===null||!Number.isFinite(v))flush();else group.push([i,v]);});flush();return svg;}
function card(t){const m=t.metrics||{},d=el("details",null,"topic"),s=el("summary",t.name||"Unnamed Topic");s.append(el("span",`${fmt(m.current_count,0)} recent posts · ${fmt(m.share_change_pp)} point share change`));const body=el("div",null,"topic-body");body.append(el("p","Headlines grouped automatically. Check examples.","muted"),el("p",`Keywords: ${(t.keywords||[]).join(", ")}`),trend(t.history));const history=el("details");history.append(el("summary","Weekly Counts and Shares"),table(["Week","Posts","Share"],(t.history||[]).map(h=>[`${day(h.start)} to ${day(h.end)}`,fmt(h.count,0),`${fmt(h.share_pct)}%`])));body.append(history);const examples=el("div",null,"examples");[["Recent Stories","current"],["Earlier Stories","previous"]].forEach(([label,key])=>{const box=el("div");box.append(el("h3",label),stories(t.examples?.[key]||[]));examples.append(box);});body.append(examples);d.append(s,body);return d;}
function render(){const isAll=$("subreddit").value==="all",adjusted=isAll&&Boolean(data.adjustment?.available);const view=$("subreddit").value==="all"?data:(data.subreddits||[])[Number($("subreddit").value)],comments=$("measure").value==="comments",reaction=$("measure").value!=="posts",query=$("search").value.trim().toLowerCase();let topics=(view?.topics||[]).filter(t=>[t.name,...(t.keywords||[]),...(Object.values(t.examples||{}).flat().map(s=>s.title))].join(" ").toLowerCase().includes(query));const value=t=>reaction&&isAll?null:reaction?(comments?(t.metrics?.reaction?.comments_available?t.metrics.reaction.comments_change:null):(t.metrics?.reaction?.available?t.metrics.reaction.votes_change:null)):(adjusted?t.metrics?.adjusted_share_change_pp:t.metrics?.share_change_pp);topics.sort((a,b)=>(value(b)??-Infinity)-(value(a)??-Infinity));const p=view?.periods||{},current=p.current||{},previous=p.previous||{};$("period").textContent=`Recent: ${day(current.start)} to ${day(current.end)}. Earlier: ${day(previous.start)} to ${day(previous.end)}.`;$("view-counts").textContent=`${fmt(previous.count,0)} earlier posts and ${fmt(current.count,0)} recent posts in this view.`;$("result-count").textContent=`${topics.length} topics shown. Earlier values appear before recent values.`;$("measure-note").textContent=isAll&&reaction?"Choose a subreddit to compare reactions. Communities receive different numbers of votes.":reaction?`Ranked by the change in saved median ${comments?"comments":"votes"}, using posts saved 12–48 hours after posting. These are saved snapshots; enough comparable posts are needed.`:"Ranked by change in the topic’s share of collected posts. A +2 point change means 2 more posts out of every 100. Only topics with at least 10 posts in each period enter the rising and falling lists.";
const rows=topics.map(t=>{const m=t.metrics||{},r=m.reaction||{};return [t.name,`${fmt(m.previous_count,0)} → ${fmt(m.current_count,0)}`,`${fmt(m.previous_share_pct)}% → ${fmt(m.current_share_pct)}%`,fmt(m.share_change_pp),!isAll&&r.available?`${fmt(r.previous_median_votes)} → ${fmt(r.current_median_votes)}`:(isAll?"Choose a Subreddit":"Unavailable"),!isAll&&r.comments_available?`${fmt(r.previous_median_comments)} → ${fmt(r.current_median_comments)}`:(isAll?"Choose a Subreddit":"Unavailable"),m.stable_comparison?"Enough Posts":(m.current_count>=10&&m.previous_count===0?"New in This Period":m.previous_count>=10&&m.current_count===0?"Absent Recently":"Few Posts")];});$("comparisons").replaceChildren(table(["Topic","Posts, Earlier → Recent","Share, Earlier → Recent","Share Change (Points)","Saved Median Votes","Saved Median Comments","Comparison"],rows));$("topic-cards").replaceChildren(...topics.map(card));if(!topics.length)$("topic-cards").append(el("p","No topics match this view."));$("adjustment-note").textContent=adjusted?`All-subreddit ranking keeps the earlier subreddit mix fixed, using ${data.adjustment.common_subreddits?.length||0} subreddits present in both periods (${fmt(data.adjustment.previous_coverage_pct)}% of earlier posts and ${fmt(data.adjustment.current_coverage_pct)}% of recent posts). Subreddits missing from either period are excluded from this ranking: ${(data.adjustment.excluded_subreddits||[]).join(", ")||"none"}. Tables and weekly charts show the actual collected share.`:"Tables and weekly charts show the actual collected share. The ranking uses this view’s share change.";const valid=isAll&&reaction?[]:topics.filter(t=>t.metrics?.stable_comparison&&value(t)!=null&&Number.isFinite(value(t)));[["rising",valid.filter(t=>value(t)>0).slice(0,8)],["falling",valid.filter(t=>value(t)<0).sort((a,b)=>value(a)-value(b)).slice(0,8)]].forEach(([id,list])=>{const target=$(id);target.replaceChildren();if(!list.length)target.append(el("p","No supported changes in this direction.","muted"));const max=Math.max(1,...list.map(t=>Math.abs(value(t))));list.forEach(t=>{const row=el("div",null,"bar-row");row.append(el("span",t.name),el("strong",`${value(t)>0?"+":""}${fmt(value(t))} ${reaction?(comments?"comments":"votes"):"points"}`));const bar=el("div",null,"bar"),fill=el("span");fill.style.width=`${Math.abs(value(t))/max*100}%`;bar.append(fill);row.append(bar);target.append(row);});});$("ranking").hidden=isAll&&reaction;}
["subreddit","measure"].forEach(id=>$(id).addEventListener("change",render));$("search").addEventListener("input",render);render();'''
