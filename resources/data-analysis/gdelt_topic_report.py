"""Render a portable report of topics in one GDELT news batch."""

import html
from datetime import datetime
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo


def _escape(value):
    return html.escape(str(value if value is not None else "Unavailable"), quote=True)


def _safe_url(value):
    if not isinstance(value, str) or any(c.isspace() or ord(c) < 32 for c in value) or "\\" in value:
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            return None
        if parsed.username is not None or parsed.password is not None:
            return None
        parsed.port  # Reject malformed ports before producing a link.
        return value
    except ValueError:
        return None


def _timestamp(value):
    try:
        stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            return _escape(value)
        stamp = stamp.astimezone(ZoneInfo("America/Los_Angeles"))
        return f"{stamp.strftime('%b')} {stamp.day}, {stamp.year} {stamp.hour % 12 or 12}:{stamp.minute:02d} {stamp.strftime('%p %Z')}"
    except (TypeError, ValueError):
        return _escape(value)


def _count(value, noun):
    return f"{_escape(value)} {noun}{'' if value == 1 else 's'}"


def _articles(articles):
    rows = []
    for article in articles:
        label = _escape(article.get("label") or article.get("url") or "Article")
        url = _safe_url(article.get("url"))
        link = f'<a href="{_escape(url)}" target="_blank" rel="noopener noreferrer">{label}</a>' if url else label
        reason = f' · {_escape(article["reason"])}' if article.get("reason") else ''
        rows.append(f'<li>{link}<small>{_escape(article.get("source") or "Unknown website")}{reason}</small></li>')
    return '<ul class="articles">' + ''.join(rows) + '</ul>' if rows else '<p class="muted">No article links available.</p>'


def render_topics(result):
    """Render the supplied ranking, escaping all source text and link attributes."""
    topics = result.get("topics", [])
    cards = []
    for rank, topic in enumerate(topics, 1):
        cards.append(f'''<article class="topic"><div class="rank">{rank}</div><div>
<h2>{_escape(topic.get("name", "Unnamed Topic"))}</h2>
<p>{_escape(topic.get("summary", ""))}</p>
<p class="counts">{_count(topic.get("source_count", 0), "website")} · {_count(topic.get("article_count", 0), "article")}</p>
{_articles(topic.get("articles", []))}</div></article>''')
    content = ''.join(cards) or '<p class="empty">No topics found in this batch.</p>'
    other_articles = result.get("other_articles", [])
    excluded = result.get("excluded_articles", [])
    all_articles = [article for topic in topics for article in topic.get("articles", [])] + other_articles + excluded
    url_note = '<p class="muted">Some link labels come from URLs and are not verified headlines.</p>' if any(article.get("label_kind") == "url" for article in all_articles) else ''
    filter_note = ''
    excluded_section = ''
    if "excluded_articles" in result:
        filter_note = f'<p class="muted"><strong>News Filter:</strong> Kept {_escape(result.get("article_count", 0))} of {_escape(result.get("input_article_count", 0))} articles. Obvious quizzes, advice, shopping, and entertainment were removed. Automatic filtering can miss things.</p>'
        if excluded:
            excluded_section = f'<details><summary>Excluded Articles ({len(excluded)})</summary>{_articles(excluded)}</details>'
    other_section = f'<section><h2>Other News</h2>{_articles(other_articles)}</section>' if other_articles else ''
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Topics In This News Batch</title><style>
:root{{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#0c131b;color:#e9f1f8}}
*{{box-sizing:border-box}}body{{margin:0}}main{{max-width:960px;margin:auto;padding:48px 24px}}
h1{{font-size:clamp(2rem,5vw,3rem);line-height:1.15;margin:0 0 18px;letter-spacing:-.03em}}
h2{{font-size:1.35rem;margin:0}}p{{line-height:1.6;margin:12px 0}}a{{color:#91ceff;overflow-wrap:anywhere}}
a:focus-visible{{outline:2px solid #91ceff;outline-offset:4px}}.muted,small{{color:#a5b6c7}}
.batch{{display:flex;flex-wrap:wrap;gap:24px;border-block:1px solid #354455;padding:18px 0;margin:24px 0}}
.batch b{{display:block;font-size:1.7rem}}.topic{{display:grid;grid-template-columns:32px minmax(0,1fr);gap:16px;padding:24px 0;border-bottom:1px solid #354455}}
.rank{{font-size:1.2rem;color:#80d3bb}}.counts{{color:#80d3bb;font-size:.9rem}}.articles{{padding-left:20px}}
.articles li{{margin:14px 0;line-height:1.5}}small{{display:block;font-size:.8rem;margin-top:3px}}
footer{{font-size:.85rem;margin-top:32px}}.empty{{padding:24px 0}}section,details{{margin-top:28px}}summary{{cursor:pointer}}@media(max-width:600px){{main{{padding:28px 16px}}.batch{{gap:18px}}}}
</style></head><body><main>
<h1>Topics In This News Batch</h1>
<p>Ranked by the number of websites covering each topic. This single batch cannot show whether interest is rising.</p>
<p class="muted">Groups compare headline meaning. Each article appears in at most one group. Several websites may carry the same syndicated story.</p>
<p class="muted">{_escape(result.get("country_note", ""))}</p>
<div class="batch"><div><b>{_escape(result.get("article_count", 0))}</b>Articles</div><div><b>{_escape(result.get("source_count", 0))}</b>Websites</div><div><b>{len(topics)}</b>Topics</div></div>
{filter_note}{url_note}{content}{other_section}{excluded_section}
<footer class="muted"><p>Fetched: {_timestamp(result.get("fetched_at"))}</p>
<p>{_count(result.get("unassigned_count", 0), "article")} did not fit a topic. Topics are grouped automatically. Check the linked articles.</p>
<p>This file works offline. Article links open their original websites.</p></footer>
</main></body></html>'''
