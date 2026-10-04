"""Pull a small live GDELT news sample and build a local report."""
import argparse
import csv
import io
import zipfile
from datetime import datetime, timezone
import html
import json
import re
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


def seen_time(value):
    """GDELT's seen time is not the publisher's publication time."""
    try:
        return datetime.strptime(value, '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def render_report(payload):
    articles = payload['data'].get('articles', [])
    fetched = datetime.fromisoformat(payload['fetched_at'])
    rows = []
    for article in articles:
        url = article.get('url', '')
        title = html.escape(article.get('title', 'Untitled'))
        if urlsplit(url).scheme in ('http', 'https') and urlsplit(url).hostname:
            title = f'<a href="{html.escape(url, quote=True)}" target="_blank" rel="noopener noreferrer">{title}</a>'
        seen = seen_time(article.get('seendate'))
        stamp = seen.astimezone(ZoneInfo('America/Los_Angeles')).strftime('%b %d, %I:%M %p %Z') if seen else 'Unknown'
        age = f'{max(0, int((fetched-seen).total_seconds()/60)):,} min' if seen else 'Unknown'
        rows.append(f'<tr><td>{title}</td><td>{html.escape(article.get("domain", ""))}</td><td>{stamp}</td><td>{age}</td></tr>')
    return f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live GDELT News Sample</title>
<style>body{{background:#111;color:#eee;font:16px system-ui;max-width:1200px;margin:40px auto;padding:0 24px}}a{{color:#8fc7ff}}p{{color:#bbb}}table{{width:100%;border-collapse:collapse}}th,td{{text-align:left;padding:14px 10px;border-bottom:1px solid #333}}th{{color:#ccc}}td:first-child{{width:55%}}code{{overflow-wrap:anywhere}}</style>
<h1>Live GDELT News Sample</h1><p>{len(articles):,} articles from {len(set(a.get('domain') for a in articles)):,} websites. Requested the latest {html.escape(payload['timespan'])}, newest seen first.</p>
<p>These are matching news articles, not a popularity ranking. Seen time means GDELT detected the article, not when it was published. No reader sentiment or comments are included.</p>
<p>Pulled {fetched.astimezone(ZoneInfo('America/Los_Angeles')).strftime('%b %d, %I:%M %p %Z')}. Search: <code>{html.escape(payload['query'])}</code></p>
<table><thead><tr><th>Headline</th><th>Website</th><th>Seen By GDELT</th><th>Age At Pull</th></tr></thead><tbody>{''.join(rows)}</tbody></table></html>'''


def pull_latest_batch():
    with urlopen('https://data.gdeltproject.org/gdeltv2/lastupdate.txt', timeout=20) as response:
        lines = response.read(10000).decode().splitlines()
    entry = next(line.split() for line in lines if line.endswith('.gkg.csv.zip'))
    url = entry[2].replace('http://', 'https://', 1)
    if urlsplit(url).hostname != 'data.gdeltproject.org' or int(entry[0]) > 10_000_000:
        raise ValueError('Unexpected batch location or size')
    with urlopen(url, timeout=30) as response:
        compressed = response.read(10_000_001)
    if len(compressed) > 10_000_000:
        raise ValueError('Batch too large')
    archive = zipfile.ZipFile(io.BytesIO(compressed))
    member = archive.infolist()[0]
    if member.file_size > 50_000_000:
        raise ValueError('Unpacked batch too large')
    rows = csv.reader(io.StringIO(archive.read(member).decode('utf-8', errors='replace')), delimiter='\t')
    articles, urls = [], set()
    for row in rows:
        if len(row) < 16 or row[2] != '1' or row[4] in urls:
            continue
        urls.add(row[4])
        extras = row[26] if len(row) > 26 else ''
        title = re.search(r'<PAGE_TITLE>(.*?)</PAGE_TITLE>', extras, re.S)
        articles.append(dict(url=row[4], source=row[3], batch_time=row[1], themes=row[7], tone=row[15], title=html.unescape(title.group(1)).strip() if title else '', persons=row[11], organizations=row[13]))
    return dict(fetched_at=datetime.now(timezone.utc).isoformat(), source_url=url, format='GDELT 2.1 GKG', articles=articles)


def filter_country(payload, country, lookup_text=None):
    lookup_url = 'https://data.gdeltproject.org/blog/2018-news-outlets-by-country-may2018-update/MASTER-GDELTDOMAINSBYCOUNTRY-MAY2018.TXT'
    if lookup_text is None:
        with urlopen(lookup_url, timeout=30) as response:
            lookup_text = response.read(10_000_000).decode('utf-8')
    domains = {row[0].lower() for line in lookup_text.splitlines() if len(row := line.split('\t')) >= 3 and row[1] == country}
    result = dict(payload)
    result['articles'] = [a for a in payload['articles'] if a['source'].lower().removeprefix('www.') in domains]
    result['country'] = country
    result['country_lookup_url'] = lookup_url
    result['country_note'] = 'Approximate US-source filter using GDELT’s 2018 publisher directory. Unknown publishers are excluded. This does not require the story to be about the United States.'
    return result


def render_batch(payload):
    rows = []
    country_note = '<p>' + html.escape(payload['country_note']) + '</p>' if payload.get('country_note') else ''
    for article in payload['articles']:
        url = article['url']
        if urlsplit(url).scheme not in ('http', 'https') or not urlsplit(url).hostname:
            continue
        label = html.escape(url)
        rows.append(f'<tr><td>{html.escape(article["source"])}</td><td><a href="{html.escape(url, quote=True)}" target="_blank" rel="noopener noreferrer">{label}</a></td></tr>')
    count = len(payload['articles'])
    sources = len(set(a['source'] for a in payload['articles']))
    stamp = datetime.fromisoformat(payload['fetched_at']).astimezone(ZoneInfo('America/Los_Angeles')).strftime('%b %d, %I:%M %p %Z')
    return f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live GDELT News Batch</title>
<style>body{{background:#111;color:#eee;font:16px system-ui;max-width:1200px;margin:40px auto;padding:0 24px}}a{{color:#8fc7ff;overflow-wrap:anywhere}}p{{color:#bbb}}table{{width:100%;border-collapse:collapse}}th,td{{text-align:left;padding:12px;border-bottom:1px solid #333}}td:first-child{{width:20%}}</style>
<h1>Live GDELT News Batch</h1>{country_note}<p>{count:,} article links from {sources:,} websites. Pulled {stamp}.</p>
<p>The search API was rate-limited, so this sample uses GDELT’s latest public news batch. It includes multiple languages and may contain older articles newly processed by GDELT. These are article links, not a popularity ranking.</p>
<p>Headline text is unavailable in this batch. Open a link to read the story. The JSON also contains topic tags and article-tone scores. No user comments or reader sentiment are included.</p>
<table><thead><tr><th>Website</th><th>Article Link</th></tr></thead><tbody>{''.join(rows)}</tbody></table></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--include-all', action='store_true', help='Keep lifestyle and entertainment in topic reports')
    parser.add_argument('--topics', action='store_true', help='Also group the public batch into topics')
    parser.add_argument('--country', choices=('US',), help='Limit to US publishers')
    parser.add_argument('--bulk', action='store_true', help='Read the latest public news batch instead of search')
    parser.add_argument('--query', default='(election OR government OR economy OR technology OR earthquake) sourcelang:english')
    parser.add_argument('--hours', type=int, default=6)
    parser.add_argument('--limit', type=int, default=100)
    args = parser.parse_args()
    if not 1 <= args.hours <= 72 or not 1 <= args.limit <= 250:
        parser.error('Use 1–72 hours and 1–250 articles.')
    if args.topics and not args.bulk:
        parser.error('--topics requires --bulk.')
    if args.bulk:
        try:
            payload = pull_latest_batch()
            if args.country:
                payload = filter_country(payload, args.country)
            report = render_batch(payload)
        except Exception as error:
            print(f'GDELT batch pull failed ({type(error).__name__}). Previous output was kept.')
            return 1
        output = Path(__file__).resolve().parent / 'models/gdelt'
        output.mkdir(parents=True, exist_ok=True)
        stem = 'latest-us' if args.country else 'latest-batch'
        (output / f'{stem}.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        (output / f'{stem}.html').write_text(report, encoding='utf-8')
        if args.topics:
            from gdelt_topics import build_topics
            from gdelt_topic_report import render_topics
            topic_payload = payload
            if not args.include_all:
                from gdelt_news_filter import filter_news
                topic_payload = filter_news(payload)
            result = build_topics(topic_payload)
            topic_stem = 'latest-us-topics' if args.country else 'latest-topics'
            (output / f'{topic_stem}.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            (output / f'{topic_stem}.html').write_text(render_topics(result), encoding='utf-8')
            print(f'Topics: {output / f"{topic_stem}.html"}')
        print(f'Saved {len(payload["articles"]):,} article links: {output / f"{stem}.html"}')
        return 0
    query = args.query + (f' sourcecountry:{args.country}' if args.country else '')
    params = dict(query=query, mode='artlist', format='json', sort='datedesc', timespan=f'{args.hours}h', maxrecords=args.limit)
    url = 'https://api.gdeltproject.org/api/v2/doc/doc?' + urlencode(params)
    try:
        with urlopen(Request(url, headers={'User-Agent': 'F5News-GDELT-Sample/1.0'}), timeout=30) as response:
            data = json.loads(response.read(5_000_000))
        if not isinstance(data, dict) or not isinstance(data.get('articles'), list):
            raise ValueError('Unexpected response')
        payload = dict(fetched_at=datetime.now(timezone.utc).isoformat(), request_url=url, query=query, timespan=f'{args.hours}h', data=data)
        report = render_report(payload)
    except Exception as error:
        print(f'GDELT pull failed ({type(error).__name__}). Previous output was kept.')
        return 1
    output = Path(__file__).resolve().parent / 'models/gdelt'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'latest-news.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
    (output / 'latest-news.html').write_text(report, encoding='utf-8')
    print(f'Saved {len(data["articles"]):,} articles: {output / "latest-news.html"}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
