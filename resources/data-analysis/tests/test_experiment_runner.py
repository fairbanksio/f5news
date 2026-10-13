"""Ensure failed reads preserve reports and do not reveal connection details."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import experiment_data
import run_experiments


class ExperimentRunnerTests(unittest.TestCase):
    def test_credentials_reuse_only_the_existing_helper(self):
        with patch.object(experiment_data,'dotenv_values',return_value=dict(mongo_uri='fake',database='db',collection='posts')):
            with patch.dict(experiment_data.os.environ,{},clear=True):
                config=experiment_data.credentials('env')
        self.assertEqual(config,dict(mongo_uri='fake',database='db',collection='posts'))

    def test_failure_keeps_old_outputs_and_hides_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);out=root/'models/experiments';out.mkdir(parents=True)
            paths=[out/'latest-experiments.html',out/'latest-experiments.json']
            for path in paths:path.write_text('previous result')
            stdout,stderr=io.StringIO(),io.StringIO()
            with patch.object(run_experiments,'__file__',str(root/'run_experiments.py')):
                with patch.object(sys,'argv',['run_experiments.py','--experiments','--no-open']):
                    with patch.object(run_experiments,'credentials',side_effect=RuntimeError('secret-token-in-driver-error')):
                        with contextlib.redirect_stdout(stdout),contextlib.redirect_stderr(stderr):
                            code=run_experiments.main()
            self.assertEqual(code,1)
            self.assertNotIn('secret-token',stderr.getvalue())
            self.assertIn('Previous reports were kept',stderr.getvalue())
            for path in paths:self.assertEqual(path.read_text(),'previous result')


if __name__=='__main__':unittest.main()
