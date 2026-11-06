# Firefox Runtime Test

Run the alternative Python browser in a native Linux container. The runner selects ARM64 or AMD64 from the Docker daemon's architecture, avoiding cross-architecture emulation. It uses a non-root user, a 2 GiB memory limit, and the same metadata reader as the Stagehand prototype.

With Docker running, from the repository root:

```sh
bash scripts/reddit-invisible/run-local.sh --subreddit politics
```

For the isolated Colima profile:

```sh
DOCKER_CONTEXT=colima-f5-invisible bash scripts/reddit-invisible/run-local.sh --subreddit politics
```

The default target is 25 posts; `--limit` accepts 1–25. Only F5's configured subreddits are accepted. Each run starts a fresh browser session. JSON metadata goes to stdout and progress/resource counters go to stderr. To retain results, redirect stdout into `scripts/reddit-invisible/output/`, which Git ignores.

The test uses `invisible-playwright==0.45.0`, including its pinned browser engine. `requirements.lock` records the passing dependency versions. Check architecture support before upgrading. An unresolved verification challenge or browser failure exits nonzero. Image challenges are not solved automatically.

This CLI checks browser extraction without database writes. The [scheduled scraper](../../services/scraper/README.md) uses it as its browser source. A successful local run does not verify AWS networking or sustained scheduled access.

Run the Python tests without installing a browser:

```sh
python3 -m unittest discover -s scripts/reddit-invisible -p 'test_*.py'
```
