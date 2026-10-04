# Local News Analysis

Run the notebook from a terminal. It uses PyMongo, pandas, and scikit-learn; Spark, Java, and Docker are not required.

## Run and View Results

From the repository root:

```sh
./resources/data-analysis/run.sh
```

The command creates an environment under ignored `models/`, installs dependencies on the first run, executes the notebook, and opens an HTML report in your browser. Later runs reuse the environment. Python 3.11 is required (`brew install python@3.11` if missing). Use `--no-open` to save results without opening a browser.

The report compares headline-only guesses, richer guesses, and always choosing the most common range. It shows two charts and six randomly chosen real test posts with their actual and guessed ranges. Detailed metrics stay in the notebook. Setup instructions and detailed diagnostics stay in the notebook. The report is `resources/data-analysis/models/latest-report.html`. The executed notebook is saved beside it as `latest-run.ipynb`. Edit the notebook's Configuration cell to change the subreddit or sample size, then rerun the command. If execution fails, the command exits with an error and keeps the previous report.

## Credentials

Vault is the default credential source. Put `VAULT_ADDR` and `VAULT_TOKEN` in the repository root's ignored `.env` or export them in the kernel environment. The KV v2 secret defaults to mount `kv`, path `f5.news`, with string keys `mongo_uri`, `database`, and `collection`. Override the mount/path with `VAULT_KV_MOUNT` and `VAULT_SECRET_PATH` in the root `.env`. The token needs only read access to the analysis secret.

For direct database credentials, set `CREDENTIAL_SOURCE = "env"` and put those three keys in the root `.env`. Use `.env.notebook.example` as a template. URL-encode the password in the URI and use a read-only database account. The notebook never prints tokens or connection strings, and a Vault failure does not silently fall back to another credential source.

Configuration defaults to up to 50,000 recently inserted posts from `politics`. `SUBREDDIT = None` includes all subreddits. Reads are limited to 100,000 posts with timeouts. Existing values in the analysis folder's `.env` do not override the root file.

## Results

The low range is split into 0–499 and 500–999. Higher ranges remain 1,000–4,999, 5,000–9,999, 10,000–24,999, 25,000–49,999, and 50,000+. The report includes sample size, date span, fetch time, and training time.

The notebook displays cleaning counts, observation ages, bucket coverage, chronological train/test ranges, accuracy, macro F1, weighted F1, a majority-class baseline, a classification report, a confusion matrix, and sample predictions with model scores.

The scraper stores the latest observed score, not a final popularity label. The sample is selected from scraped rising posts. Deduplication removes normalized title repeats before a chronological 60/20/20 training, validation, and test split. Five finalists compare headline patterns, a word/letter Naive Bayes model, and source website/posting clues on validation weighted F1. The selected settings are refit on older training plus validation posts, then evaluated alongside a headline-only reference on the same newest test posts. Website, posting hour/day, post type, and title shape are available before votes arrive; upvotes, fetch time, and observation age are excluded from model inputs. Scores may have been updated after the split date, so this is not a historical backtest. Missing buckets cannot be learned, and probability scores are not calibrated guarantees.

`MIN_OBSERVATION_AGE_HOURS` optionally excludes scores recorded before a chosen post age. It measures `fetchedAt - created_utc`, rather than how long ago a document was fetched.

The saved pipeline uses the local `analysis_models.py` module, which must remain available when loading it. It accepts post DataFrames with `title`, `domain`, `created_utc`, `is_self`, and `is_video`; missing optional clues become unknown. The pipeline and metric summary are saved under ignored `resources/data-analysis/models/`. Only load trusted model files. Keep database-derived outputs out of commits; committed notebook cells must have cleared outputs.

## Optional MLflow

Install tracking support in the runner environment:

```sh
source resources/data-analysis/models/runner-venv/bin/activate
python -m pip install -r resources/data-analysis/requirements-mlflow.txt
```

Set `TRACK_EXPERIMENT = True` in Configuration and rerun. MLflow uses local SQLite and artifact files. From the repository root, open its results UI with:

```sh
mlflow ui --backend-store-uri sqlite:///resources/data-analysis/models/mlflow.db --host 127.0.0.1 --port 5000
```

Visit `http://127.0.0.1:5000`. MySQL, MinIO, and a tracking server are not needed during training.

## Tests

Use the runner environment:

```sh
source resources/data-analysis/models/runner-venv/bin/activate
python -m pip install -r resources/data-analysis/requirements-dev.txt
MPLBACKEND=Agg PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s resources/data-analysis/tests -v
```

Tests execute the notebook's analysis functions with synthetic data and a fake database client. They need no credentials or database services. GitHub Actions runs these checks when analysis files change.

## Legacy Docker Stack

`docker-compose.yml`, `.env.example`, and `wait-for-it.sh` describe the older development stack. They are not used by the notebook. The MLflow build directory referenced by Compose is missing; the legacy stack has not been restored or tested.

Its published ports bind to loopback. Do not forward the unauthenticated Spark ports or attach untrusted containers. Earlier revisions committed MinIO/MySQL defaults and a MongoDB credential. Removing credentials from source does not revoke them; their owners must rotate any affected accounts. Never reuse historical credentials.
