"""Keep previous topic reports when a read fails; reject invalid comparisons."""
import contextlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))


class TopicRunnerTests(unittest.TestCase):
    def test_failed_read_preserves_outputs_and_redacts(self):
        import run_topics
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);out=root/'models/topics';out.mkdir(parents=True)
            for name in ('latest-topics.html','latest-topics.json'):(out/name).write_text('previous')
            stdout,stderr=io.StringIO(),io.StringIO()
            with patch.object(run_topics,'__file__',str(root/'run_topics.py')):
                with patch.object(sys,'argv',['run_topics.py','--topics','--no-open']):
                    with patch.object(run_topics,'credentials',side_effect=RuntimeError('secret-token')):
                        with contextlib.redirect_stdout(stdout),contextlib.redirect_stderr(stderr):code=run_topics.main()
            self.assertEqual(code,1);self.assertNotIn('secret-token',stderr.getvalue())
            for name in ('latest-topics.html','latest-topics.json'):self.assertEqual((out/name).read_text(),'previous')

    def test_invalid_windows_or_topic_counts_fail_before_reading(self):
        import run_topics
        for arguments in [('--window-days','0'),('--window-days','91'),('--topic-count','1'),('--topic-count','101')]:
            with self.subTest(arguments=arguments),patch.object(sys,'argv',['run_topics.py',*arguments]):
                with patch.object(run_topics,'credentials') as read,contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit) as exit:run_topics.main()
                self.assertEqual(exit.exception.code,2);read.assert_not_called()


if __name__=='__main__':unittest.main()
