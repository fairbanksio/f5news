"""Build a larger topic-trend report from the collected news sample."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from experiment_data import credentials, read_posts, prepare_sample
from semantic_analysis import encode_titles
from topic_analysis import analyze_topics
from topic_report import render_topic_report
from snapshot_experiment import record_snapshots


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--topics', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--semantic', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--no-open', action='store_true')
    parser.add_argument('--limit', type=int, default=100000)
    parser.add_argument('--subreddit', default=None)
    parser.add_argument('--source', choices=('vault', 'env'), default='vault')
    parser.add_argument('--window-days', type=int, default=7, help='Compare this many days with the preceding period')
    parser.add_argument('--topic-count', type=int, default=40, help='Number of headline groups (default: 40)')
    args = parser.parse_args()
    if not 1 <= args.window_days <= 90 or not 2 <= args.topic_count <= 100:
        parser.error('Use 1–90 window days and 2–100 topics.')
    analysis_dir = Path(__file__).resolve().parent
    output = analysis_dir / 'models/topics'
    output.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
    os.environ.setdefault('HF_HUB_DISABLE_XET', '1')
    os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
    started = time.perf_counter()
    stage = 'Reading Data'
    try:
        print('Reading a bounded, read-only sample...', flush=True)
        posts, cleaning = prepare_sample(read_posts(credentials(args.source), args.limit, args.subreddit))
        print(f'Using {len(posts):,} posts across {len(cleaning["subreddit_counts"])} subreddits.', flush=True)
        stage = 'Reading Headline Meaning'
        vectors = encode_titles(posts.title)
        stage = 'Comparing Topics'
        print(f'Comparing {args.topic_count} topics across two {args.window_days}-day periods...', flush=True)
        result = analyze_topics(posts, vectors, window_days=args.window_days, topic_count=args.topic_count)
        result['cleaning'] = cleaning
        stage = 'Saving Local History'
        result['snapshot'] = record_snapshots(posts, analysis_dir / 'models/experiments/observations.sqlite')
        result['elapsed_seconds'] = time.perf_counter() - started
        stage = 'Building Report'
        report = render_topic_report(result)
        pending_json = output / 'results.pending.json'
        pending_html = output / 'report.pending.html'
        pending_json.write_text(json.dumps(result, indent=2, allow_nan=False), encoding='utf-8')
        pending_html.write_text(report, encoding='utf-8')
        pending_json.replace(output / 'latest-topics.json')
        report_path = output / 'latest-topics.html'
        pending_html.replace(report_path)
    except Exception:
        print(f'Topic report failed during {stage}. Previous reports were kept. Error details are hidden to protect credentials.', file=sys.stderr)
        return 1
    print(f'Report: {report_path}', flush=True)
    if not args.no_open and sys.platform == 'darwin':
        subprocess.run(['open', str(report_path)], check=False)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
