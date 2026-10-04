# Local News Analysis

Run the notebook from a terminal. It uses PyMongo, pandas, and scikit-learn; Spark, Java, and Docker are not required.

## Run and View Results

From the repository root:

```sh
./resources/data-analysis/run.sh
```

The command creates an environment under ignored `models/`, installs dependencies on the first run, executes the notebook, and opens an HTML report in your browser. Later runs reuse the environment. Python 3.11 is required (`brew install python@3.11` if missing). Use `--no-open` to save results without opening a browser.

The report compares headline-only guesses, the selected range model, and always choosing the most common range. A separate Yes/No section asks whether saved counts reached 1,000 upvotes. Two charts show range coverage and how far guesses missed; six real test posts show actual and guessed ranges. Detailed diagnostics stay in the notebook. The report is `resources/data-analysis/models/latest-report.html`. The executed notebook is saved beside it as `latest-run.ipynb`. Edit the notebook's Configuration cell to change the subreddit or sample size, then rerun. If execution fails, the command exits with an error and keeps the previous report.

## Optional Headline Meaning

Include models that read headline meaning:

```sh
./resources/data-analysis/run.sh --semantic
```

The runner installs the pinned semantic dependencies automatically. The first semantic run downloads the pinned `sentence-transformers/all-MiniLM-L6-v2` model weights; later runs reuse them and cached title embeddings under ignored `models/meaning-cache/`. New headlines are encoded locally. Headline text is not sent to an inference service. The encoder uses Apple MPS when available, otherwise CPU. Add `--no-open` to save results without opening a browser.

The report says whether headline meaning was tested. Testing it does not guarantee it wins: each experiment chooses its model using older validation posts, then checks it on the newest test posts. Run without `--semantic` for the standard word-pattern models.

## Seven News Experiments

Run the whole suite and open its report:

```sh
./resources/data-analysis/run.sh --experiments
```

This reads up to 100,000 posts across all available subreddits. It reuses the local headline-meaning cache. Use `--limit 50000`, `--subreddit politics`, or `--no-open` as needed. The original upvote notebook still runs without `--experiments`.

| Experiment | What to Look For |
| --- | --- |
| Group the Same Story | Do the suggested headline groups cover the same event? |
| Spot Growing Topics | Which topics gained a larger share of the collected sample? |
| Find Similar Stories | Do the earlier matches provide useful context? |
| Build a Balanced Feed | Does a more varied feed still contain useful stories? |
| Predict Discussion | Can it spot posts with 100+ saved comments better than a simple guess? |
| Compare Publishers | Which websites draw more engagement within the same subreddit? |
| Compare Posting Times | How do saved counts differ by day and time in Pacific time? |

The concise report is `models/experiments/latest-experiments.html`; detailed results are in the JSON file beside it. All outputs remain ignored. Story matches need manual review. Weekly trends describe collected posts, and publisher/time comparisons cannot prove causes. Discussion settings are selected on older posts before checking newer ones; the target is a saved comment total.

Each run also retains new scraper readings in local `models/experiments/observations.sqlite`. Repeating an unchanged scraper reading does not create another observation. This prepares a history for later growth forecasts; it does not change production scraping or schedule collection. Future popularity remains marked as needing history. No reader activity is available to test personalized recommendations.

## Credentials

Vault is the default credential source. Put `VAULT_ADDR` and `VAULT_TOKEN` in the repository root's ignored `.env` or export them in the kernel environment. The KV v2 secret defaults to mount `kv`, path `f5.news`, with string keys `mongo_uri`, `database`, and `collection`. Override the mount/path with `VAULT_KV_MOUNT` and `VAULT_SECRET_PATH` in the root `.env`. The token needs only read access to the analysis secret.

For direct database credentials, set `CREDENTIAL_SOURCE = "env"` and put those three keys in the root `.env`. Use `.env.notebook.example` as a template. URL-encode the password in the URI and use a read-only database account. The notebook never prints tokens or connection strings, and a Vault failure does not silently fall back to another credential source.

Configuration defaults to up to 50,000 recently inserted posts from `politics`. `SUBREDDIT = None` includes all subreddits. Reads are limited to 100,000 posts with timeouts. Existing values in the analysis folder's `.env` do not override the root file.

## Results

Every range covers 500 upvotes: 0–499, 500–999, 1,000–1,499, and so on. The error-distance chart shows how many ranges each guess missed by. Correct Range means the guess was right; each step means another 500-upvote range, rather than an exact 500-upvote error. The report includes sample size, date span, fetch time, and training time.

The notebook displays cleaning counts, observation ages, bucket coverage, chronological train/test ranges, accuracy, macro F1, weighted F1, a majority-class baseline, a classification report, error distance, and sample predictions with model scores. The separate binary experiment reports accuracy, balanced accuracy, precision, recall, and F1 for reaching at least 1,000 saved upvotes, alongside its majority-answer baseline. Its model and Yes-score threshold are selected on validation posts before test evaluation.

The scraper stores the latest observed score, not a final popularity label. The sample is selected from scraped rising posts. Deduplication removes normalized title repeats before a chronological 60/20/20 training, validation, and test split. The detailed range models use a faster training method for the many 500-upvote ranges. Five standard models compare headline patterns, a word/letter Naive Bayes model, and source website/posting clues on validation weighted F1. With `--semantic`, three more models compare headline meaning. The selected settings are refit on older training plus validation posts, then evaluated alongside a headline-only reference on the same newest test posts. Website, posting hour/day, post type, and title shape are available before votes arrive; upvotes, fetch time, and observation age are excluded from model inputs. Scores may have been updated after the split date, so this is not a historical backtest. Missing buckets cannot be learned, and probability scores are not calibrated guarantees.

`MIN_OBSERVATION_AGE_HOURS` optionally excludes scores recorded before a chosen post age. It measures `fetchedAt - created_utc`, rather than how long ago a document was fetched.

Saved models need `analysis_models.py`. Meaning models also need `semantic_analysis.py` and the semantic dependencies. It accepts post DataFrames with `title`, `domain`, `created_utc`, `is_self`, and `is_video`; missing optional clues become unknown. The pipeline and metric summary are saved under ignored `resources/data-analysis/models/`. The Yes/No model file contains its pipeline, chosen threshold, and target. Apply that threshold to the Yes probability when using it. Only load trusted model files. Keep database-derived outputs out of commits; committed notebook cells must have cleared outputs.

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
