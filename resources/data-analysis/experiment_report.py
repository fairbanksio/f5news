"""Render a portable, script-free report of the collected news sample."""

import html
import json
import math
from numbers import Integral, Real
from urllib.parse import urlsplit


def _scalar(value):
    """Accept ordinary Python values and NumPy scalar values without importing NumPy."""
    if hasattr(value, "item") and callable(value.item):
        try:
            return value.item()
        except (ValueError, TypeError):
            pass
    return value


def _format(value):
    value = _scalar(value)
    if value is None:
        return "Unavailable"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, Integral):
        return f"{value:,}"
    if isinstance(value, Real):
        if not math.isfinite(value):
            return "Unavailable"
        if value == 0:
            return "0"
        if abs(value) < 0.001:
            return f"{value:.3g}"
        return f"{value:,.3f}".rstrip("0").rstrip(".")
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False, default=_json_default)
    return str(value)


def _json_default(value):
    scalar = _scalar(value)
    return scalar if scalar is not value else str(value)


def _escape(value):
    return html.escape(_format(value), quote=True)


def _cell(value, column):
    scalar = _scalar(value)
    text = (f"{scalar:.1f}" if isinstance(scalar, Real) and not isinstance(scalar, bool)
            and math.isfinite(scalar) and ("(%)" in str(column) or "Percentage Points" in str(column))
            else _escape(value))
    if str(column).lower() in {"url", "link", "post url", "post link"}:
        raw = str(value)
        try:
            parsed = urlsplit(raw)
            safe = parsed.scheme.lower() in {"http", "https"} and bool(parsed.netloc)
            safe = safe and not any(ord(char) < 32 for char in raw)
        except ValueError:
            safe = False
        if safe:
            return f'<a href="{html.escape(raw, quote=True)}" rel="noopener noreferrer">Open Story</a>'
    return text


def _table(title, rows):
    heading = f"<h3>{_escape(title)}</h3>"
    if not rows:
        return heading + '<p class="muted">No rows are available for this sample.</p>'
    columns = list(dict.fromkeys(key for row in rows for key in row))
    if not columns:
        return heading + '<p class="muted">No rows are available for this sample.</p>'
    headers = "".join(f'<th scope="col">{_escape(key)}</th>' for key in columns)
    body = "".join("<tr>" + "".join(f"<td>{_cell(row.get(key), key)}</td>" for key in columns)
                   + "</tr>" for row in rows)
    return heading + f'<div class="table-wrap"><table><thead><tr>{headers}</tr></thead><tbody>{body}</tbody></table></div>'


def _status(status):
    return "Complete" if status in {"complete", "completed", "ok"} else "Need More Data"


def _metrics(metrics):
    if not metrics:
        return ""
    return '<dl class="metrics">' + "".join(
        f"<div><dt>{_escape(str(key).replace('_', ' ').title())}</dt><dd>{_escape(value)}</dd></div>"
        for key, value in metrics.items()) + "</dl>"


def render_experiment_report(result):
    """Return self-contained dark HTML, escaping all supplied report content."""
    sample = result.get("sample", {})
    experiments = result.get("experiments", [])
    nav = "".join(f'<a href="#{_escape(entry.get("id", ""))}">{_escape(entry.get("title", "Experiment"))}</a>'
                  for entry in experiments)
    sample_metrics = {"Usable Posts": sample.get("usable"),
                      "Latest Post": str(sample["last_post"])[:10] if sample.get("last_post") else None,
                      "Run Time (Seconds)": f'{float(result["elapsed_seconds"]):.1f}'
                      if result.get("elapsed_seconds") is not None else None}
    coverage = sample.get("field_coverage", {})
    counts = sample.get("subreddit_counts", {})
    sample_details = ""
    if counts:
        rows = [{"Subreddit": key, "Posts": value} for key, value in counts.items()]
        sample_details += _table("Posts by Subreddit", rows)
    if coverage:
        rows = []
        for key, value in coverage.items():
            scalar = _scalar(value)
            display = f"{scalar * 100:.1f}%" if isinstance(scalar, Real) and 0 <= scalar <= 1 else value
            rows.append({"Field": key, "Coverage": display})
        sample_details += _table("Field Coverage", rows)
    if sample_details:
        sample_details = f'<details><summary>Sample Details</summary>{sample_details}</details>'
    sections = []
    for entry in experiments:
        tables = "".join(_table(table.get("title", "Results"), table.get("rows", []))
                         for table in entry.get("tables", []))
        sections.append(f'<section id="{_escape(entry.get("id", ""))}"><div class="section-head">'
                        f'<h2>{_escape(entry.get("title", "Experiment"))}</h2>'
                        f'<span class="status">{_status(entry.get("status"))}</span></div>'
                        f'<p>{_escape(entry.get("summary", ""))}</p>{tables}</section>')
    snapshot = result.get("snapshot", {})
    history_summary = snapshot.get("summary") or "We need repeated snapshots of the same posts before we can estimate tomorrow's popularity."
    technical = html.escape(json.dumps(result, indent=2, ensure_ascii=False, default=_json_default), quote=True)
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>News Experiments</title><style>
:root{{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#10151d;color:#e8edf5}}
*{{box-sizing:border-box}}body{{margin:0}}main{{max-width:1180px;margin:auto;padding:40px 24px}}
h1{{font-size:2.4rem;margin:0 0 12px}}h2{{font-size:1.5rem;margin:0}}h3{{font-size:1.05rem;margin:26px 0 12px}}
p{{line-height:1.65;max-width:900px}}a{{color:#8fc9ff;overflow-wrap:anywhere}}a:focus-visible{{outline:2px solid #8fc9ff;outline-offset:4px}}
nav{{display:flex;gap:10px 20px;flex-wrap:wrap;padding:20px 0}}section{{background:#19212d;border:1px solid #344152;border-radius:12px;padding:24px;margin:24px 0;scroll-margin-top:20px}}
.section-head{{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}}
.status{{font-size:.85rem;color:#c4dbf5;border:1px solid #52677f;border-radius:20px;padding:5px 12px;white-space:nowrap}}
.muted,dt,footer{{color:#afbed1}}.metrics{{display:flex;flex-wrap:wrap;gap:16px 32px;margin:24px 0}}
.metrics div{{min-width:130px;max-width:100%}}dt{{font-size:.85rem}}dd{{margin:6px 0 0;font-size:1.15rem;overflow-wrap:anywhere}}
.table-wrap{{overflow-x:auto;border:1px solid #344152;border-radius:8px}}table{{width:100%;border-collapse:collapse;font-size:.9rem}}
th,td{{text-align:left;padding:12px 14px;vertical-align:top;border-bottom:1px solid #344152;min-width:100px;max-width:420px;overflow-wrap:anywhere}}
th{{background:#243043;color:#f1f5fb}}tbody tr:last-child td{{border-bottom:0}}tbody tr:nth-child(even){{background:#1e2836}}
details{{margin:24px 0}}summary{{cursor:pointer;color:#8fc9ff}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#19212d;padding:20px;border-radius:8px;font-size:.8rem;line-height:1.5}}
footer{{font-size:.85rem;line-height:1.6;margin-top:32px}}@media(max-width:600px){{main{{padding:24px 14px}}section{{padding:18px}}h1{{font-size:2rem}}}}
</style></head><body><main>
<h1>News Experiments</h1><p>These experiments use the current collected sample. Counts and scores describe the posts we collected, not all of Reddit. Each result explains what we can learn from this sample.</p>
<nav aria-label="Experiments">{nav}</nav>
<section><h2>The Collected Sample</h2>{_metrics(sample_metrics)}{sample_details}</section>
{''.join(sections)}
<section id="tomorrows-popularity"><div class="section-head"><h2>Tomorrow’s Popularity</h2><span class="status">{_status(snapshot.get('status'))}</span></div><p>{_escape(history_summary)}</p></section>
<details><summary>Technical Details</summary><pre>{technical}</pre></details>
<footer>This report is a local file. It uses no external assets or scripts. Latest post in the sample: {_escape(sample_metrics['Latest Post'])}.</footer>
</main></body></html>'''
