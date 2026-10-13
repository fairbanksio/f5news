"""Read a bounded sample using the notebook's existing credential helper."""
import ast
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

from dotenv import dotenv_values
import numpy as np
import pandas as pd
from pymongo import MongoClient

ANALYSIS_DIR = Path(__file__).resolve().parent
ROOT = ANALYSIS_DIR.parents[1]
FIELDS = ('title', 'sub', 'domain', 'url', 'commentLink', 'created_utc',
          'upvoteCount', 'commentCount', 'upvote_ratio', 'fetchedAt', 'is_self', 'is_video')


def credentials(source='vault'):
    # Compile only the shared helper, never execute notebook cells or saved outputs.
    notebook = json.loads((ANALYSIS_DIR / 'f5-spark-analysis.ipynb').read_text())
    cell = next(c for c in notebook['cells'] if 'definitions' in c.get('metadata', {}).get('tags', []))
    tree = ast.parse(''.join(cell['source']))
    helper = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'load_database_config')
    namespace = dict(os=os, json=json, quote=quote, Request=Request, urlopen=urlopen)
    exec(compile(ast.Module(body=[helper], type_ignores=[]), 'notebook_credentials', 'exec'), namespace)
    settings = {**dotenv_values(ROOT / '.env'), **{k: v for k, v in os.environ.items()
                if k.startswith('VAULT_') or k in ('mongo_uri', 'database', 'collection')}}
    return namespace['load_database_config'](settings, source)


def read_posts(config, limit=100000, subreddit=None):
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100000:
        raise ValueError('Choose between 1 and 100,000 posts.')
    projection = {field: 1 for field in FIELDS}
    try:
        with MongoClient(config['mongo_uri'], serverSelectionTimeoutMS=10000,
                         connectTimeoutMS=10000, socketTimeoutMS=30000,
                         appname='F5LocalExperiments') as client:
            cursor = (client[config['database']][config['collection']]
                      .find({'sub': subreddit} if subreddit else {}, projection)
                      .sort('_id', -1).limit(limit).max_time_ms(20000))
            return list(cursor)
    except Exception:
        raise RuntimeError('Database read failed. Check access and connectivity.') from None


def prepare_sample(records):
    df = pd.DataFrame(records).reindex(columns=['_id', *FIELDS])
    loaded = len(df)
    if not loaded:
        raise ValueError('No posts were returned.')
    valid_titles = df.title.map(lambda v: isinstance(v, str) and bool(v.strip()))
    df['title'] = df.title.where(valid_titles, '').str.strip()
    for name in ('upvoteCount', 'commentCount', 'upvote_ratio', 'created_utc'):
        values = df[name].map(lambda v: np.nan if isinstance(v, (bool, np.bool_)) else v)
        df[name] = pd.to_numeric(values, errors='coerce')
    df['created_at'] = pd.to_datetime(df.created_utc, unit='s', utc=True, errors='coerce')
    df['fetched_at'] = pd.to_datetime(df.fetchedAt, utc=True, errors='coerce')
    df['observation_age_hours'] = (df.fetched_at - df.created_at).dt.total_seconds() / 3600
    valid = valid_titles & np.isfinite(df.upvoteCount) & df.upvoteCount.ge(0)
    valid &= df.created_at.notna() & df.fetched_at.notna() & df.observation_age_hours.ge(0)
    df = df.loc[valid].copy()
    df.loc[~np.isfinite(df.commentCount) | df.commentCount.lt(0), 'commentCount'] = np.nan
    df.loc[~np.isfinite(df.upvote_ratio) | ~df.upvote_ratio.between(0, 1), 'upvote_ratio'] = np.nan
    for name in ('domain', 'sub', 'url', 'commentLink'):
        df[name] = df[name].map(lambda v: v.strip() if isinstance(v, str) and v.strip() else 'unknown')
    def identity(row):
        if pd.notna(row['_id']):
            return str(row['_id'])
        parts = [row['sub'], row['commentLink'] if row['commentLink'] != 'unknown' else row['title'], str(row['created_utc'])]
        return hashlib.sha256('\0'.join(parts).encode()).hexdigest()
    df['post_key'] = df.apply(identity, axis=1)
    df = df.sort_values('fetched_at').drop_duplicates('post_key', keep='last')
    df = df.sort_values('created_at', kind='stable').reset_index(drop=True)
    if df.empty:
        raise ValueError('No valid dated posts with saved votes were returned.')
    summary = dict(loaded=loaded, usable=len(df), excluded=loaded-len(df),
                   first_post=df.created_at.min().isoformat(), last_post=df.created_at.max().isoformat(),
                   subreddit_counts={str(k): int(v) for k,v in df['sub'].value_counts().items()},
                   field_coverage={'commentCount': float(df.commentCount.notna().mean()),
                                   'upvote_ratio': float(df.upvote_ratio.notna().mean())})
    return df, summary
