"""Retain observed counts locally without inventing a history of past votes."""
from datetime import datetime, timezone
import sqlite3
import pandas as pd


def record_snapshots(posts, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE IF NOT EXISTS observations (post_key TEXT, observed_at TEXT, collected_at TEXT, created_at TEXT, votes REAL, comments REAL, PRIMARY KEY(post_key, observed_at))')
        before = db.total_changes
        collected = datetime.now(timezone.utc).isoformat()
        rows = [(p.post_key, p.fetched_at.isoformat(), collected, p.created_at.isoformat(),
                 float(p.upvoteCount), float(p.commentCount) if pd.notna(p.commentCount) else None)
                for p in posts.itertuples()]
        db.executemany('INSERT OR IGNORE INTO observations VALUES (?, ?, ?, ?, ?, ?)', rows)
        added = db.total_changes - before
        total = db.execute('SELECT COUNT(*) FROM observations').fetchone()[0]
        repeated = db.execute('SELECT COUNT(*) FROM (SELECT post_key FROM observations GROUP BY post_key HAVING COUNT(*) >= 2)').fetchone()[0]
    return {'status': 'needs_history', 'summary': f'Saved {added:,} new readings locally; {repeated:,} posts now have repeated readings. Forecasts need readings near ages 1 hour and 24 hours. Rerun to capture new scraper readings; duplicate readings are ignored.',
            'new_observations': added, 'observations': total, 'repeated_posts': repeated}
