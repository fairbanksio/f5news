"""Run seven local news experiments and save a concise browser report."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from experiment_data import credentials, read_posts, prepare_sample
from semantic_analysis import encode_titles
from story_experiments import run_story_experiments
from engagement_experiments import run_engagement_experiments
from snapshot_experiment import record_snapshots
from experiment_report import render_experiment_report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--experiments', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--semantic', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--no-open', action='store_true')
    parser.add_argument('--limit', type=int, default=100000)
    parser.add_argument('--subreddit', default=None, help='Default: all available subreddits')
    parser.add_argument('--source', choices=('vault', 'env'), default='vault')
    args = parser.parse_args()
    output = Path(__file__).resolve().parent / 'models/experiments'
    output.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
    os.environ.setdefault('HF_HUB_DISABLE_XET', '1')
    os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
    started = time.perf_counter()
    stage = 'Reading Data'
    try:
        print('Reading a bounded, read-only sample...', flush=True)
        posts, sample = prepare_sample(read_posts(credentials(args.source), args.limit, args.subreddit))
        print(f'Using {len(posts):,} posts across {len(sample["subreddit_counts"])} subreddits.', flush=True)
        stage = 'Reading Headline Meaning'
        vectors = encode_titles(posts.title)
        stage = 'Story Experiments'
        print('Grouping stories, comparing topics, finding similar stories, and balancing a feed...', flush=True)
        experiments = run_story_experiments(posts, vectors)
        stage = 'Engagement Experiments'
        print('Testing discussion guesses, publishers, and posting times...', flush=True)
        experiments += run_engagement_experiments(posts, vectors)
        stage = 'Saving Local History'
        snapshot = record_snapshots(posts, output / 'observations.sqlite')
        result = dict(sample=sample, experiments=experiments, snapshot=snapshot,
                      elapsed_seconds=time.perf_counter()-started)
        stage = 'Building Report'
        report = render_experiment_report(result)
        report_path = output / 'latest-experiments.html'
        # Build both files before replacing previous successful outputs.
        pending = output / 'results.pending.json'
        pending.write_text(json.dumps(result, indent=2, default=lambda v: v.item() if hasattr(v,'item') else str(v)), encoding='utf-8')
        report_pending = output / 'report.pending.html'
        report_pending.write_text(report, encoding='utf-8')
        pending.replace(output / 'latest-experiments.json')
        report_pending.replace(report_path)
    except Exception:
        print(f'Experiments failed during {stage}. Previous reports were kept. Error details are hidden to protect credentials.', file=sys.stderr)
        return 1
    print(f'Report: {report_path}', flush=True)
    if not args.no_open and sys.platform == 'darwin':
        subprocess.run(['open', str(report_path)], check=False)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
