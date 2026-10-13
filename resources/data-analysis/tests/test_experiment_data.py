"""Check sample cleaning, bounded reads, and truthful local observation history."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import experiment_data
from snapshot_experiment import record_snapshots


class ExperimentDataTests(unittest.TestCase):
    def row(self, key='1', title='A headline', **changes):
        created = pd.Timestamp('2026-10-01T12:00:00Z')
        result = dict(_id=key, title=title, sub='news', domain='example.com', url='https://example.com/story',
                      created_utc=created.timestamp(), fetchedAt=created + pd.Timedelta(hours=2),
                      upvoteCount=50, commentCount=10, upvote_ratio=.8)
        result.update(changes)
        return result

    def test_missing_counts_are_not_zero_and_cross_posts_remain(self):
        data, summary = experiment_data.prepare_sample([
            self.row(commentCount=None), self.row(key='2', sub='politics', commentCount=True),
            self.row(key='3', title='Other story', commentCount=-1, upvote_ratio=2)])
        self.assertEqual(len(data), 3)
        self.assertTrue(data.commentCount.isna().all())
        self.assertEqual(summary['field_coverage']['commentCount'], 0)
        self.assertTrue(pd.isna(data.iloc[-1].upvote_ratio))

    def test_latest_post_reading_and_invalid_dates_scores(self):
        rows = [self.row(), self.row(upvoteCount=80, fetchedAt=pd.Timestamp('2026-10-01T15:00:00Z'))]
        rows += [self.row(key='bad'+str(i), **change) for i, change in enumerate([
            {'upvoteCount':True}, {'created_utc':'bad'}, {'title':None}, {'fetchedAt':'bad'}, {'upvoteCount':np.inf}])]
        data, summary = experiment_data.prepare_sample(rows)
        self.assertEqual(len(data), 1)
        self.assertEqual(data.iloc[0].upvoteCount, 80)
        self.assertEqual(summary['excluded'], 6)
        self.assertEqual(data.iloc[0].observation_age_hours, 3)
        with self.assertRaises(ValueError): experiment_data.prepare_sample([])

    def test_read_is_bounded_and_projects_comments(self):
        class Fake:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def __getitem__(self,key):return self
            def find(self, query, fields):
                self.query=query; self.fields=fields;return self
            def sort(self,*args):return self
            def limit(self, value):self.bound=value;return self
            def max_time_ms(self,value):self.deadline=value;return self
            def __iter__(self):return iter([])
        fake=Fake()
        with patch.object(experiment_data,'MongoClient',return_value=fake):
            experiment_data.read_posts(dict(mongo_uri='redacted',database='db',collection='posts'),20,'news')
        self.assertEqual(fake.bound,20);self.assertEqual(fake.deadline,20000)
        self.assertEqual(fake.query,{'sub':'news'});self.assertEqual(fake.fields['commentCount'],1)
        for bound in [0,100001,True,1.5]:
            with self.assertRaises(ValueError):experiment_data.read_posts({},bound)
        with patch.object(experiment_data,'MongoClient',side_effect=RuntimeError('secret-connection')):
            with self.assertRaisesRegex(RuntimeError,'^Database read failed') as error:
                experiment_data.read_posts(dict(mongo_uri='secret',database='db',collection='posts'))
        self.assertNotIn('secret',str(error.exception))

    def test_repeated_unchanged_reads_do_not_invent_history(self):
        posts,_=experiment_data.prepare_sample([self.row()])
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'observations.sqlite'
            first=record_snapshots(posts,path);same=record_snapshots(posts,path)
            self.assertEqual(first['new_observations'],1)
            self.assertEqual(same['new_observations'],0);self.assertEqual(same['repeated_posts'],0)
            posts['fetched_at'] += pd.Timedelta(hours=1)
            posts['upvoteCount']=40
            updated=record_snapshots(posts,path)
            self.assertEqual(updated['observations'],2);self.assertEqual(updated['repeated_posts'],1)
            self.assertEqual(updated['status'],'needs_history')


if __name__=='__main__':unittest.main()
