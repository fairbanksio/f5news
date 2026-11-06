# Browser Scraper

The scheduled handler reads up to 25 organic Rising posts for each configured subreddit through `invisible-playwright`. It replaces the OAuth and Reddit listing API calls. The MongoDB upsert, article thumbnails, image backfill, and job metrics use the existing pipeline.

The Python browser and the Stagehand prototype share a DOM reader and F5 field mapper. The deployed runtime uses Firefox directly because Stagehand requires Chromium. It makes no AI model calls and needs no Browserbase account or Reddit API credentials.

## Runtime

The function runs from an ARM64 container with 2 GiB RAM, a 240-second timeout, and 1 GiB of temporary storage. Firefox is baked into the image. Runtime state goes under `/tmp`, allowing a read-only root filesystem. Tini reaps orphaned browser processes so repeated warm invocations do not accumulate zombies.

Each invocation starts a fresh browser and reads exact timestamps, counts, destination links, and media metadata. Gallery posts receive a detail-page read. Native video manifests are verified before storage. Missing required data, blocked access, unresolved human checks, browser failures, and empty feeds fail the job before any post writes. Optional article thumbnail failures retain the existing degraded-job behavior.

Browser extraction has a 90-second budget, shortened when Lambda has less time remaining. It reserves time for process cleanup and storage. Progress logs include `BROWSER_PROGRESS`, `BROWSER_EXTRACTED`, and the existing terminal scraper events. A deadline stops the browser process group and its owned Xvfb display, then rejects the invocation.

## Local Checks

From this directory:

```sh
npm ci
npm run lint
npm test
```

From the repository root, build the Lambda image using a native ARM64 Docker daemon:

```sh
docker build --platform linux/arm64 --provenance=false \
  -f services/scraper/Dockerfile -t f5-scraper:local .
```

To check browser extraction without writing to MongoDB:

```sh
docker run --rm --init --read-only --memory 2g --pids-limit 1024 \
  --tmpfs /tmp:rw,size=1g --entrypoint node f5-scraper:local -e '
const { scrapePosts } = require("./browser-source");
scrapePosts({ subreddit: "politics" }).then(posts => {
  console.log(JSON.stringify({ count: posts.length }));
}).catch(error => { console.error(error.message); process.exitCode = 1; });'
```

No credentials are required for that extraction check. Running the real handler writes to MongoDB and requires `MONGO_CONNECTION_STRING`.

## Deployment

Use the repository's GitHub Actions deployment workflow. After deploying the scraper, the workflow invokes politics and requires a completed job with every extracted post saved. It prints aggregate counts only; raw responses stay on the runner. Serverless builds the container from the repository root and publishes it to its managed ECR repository. The deployment role needs the ECR image-build and push permissions required by Serverless, in addition to its existing Lambda and CloudFormation permissions.

The function has a new physical name ending in `fetchPosts-browser`, since AWS cannot change an existing ZIP function into an image function. CloudFormation retains the scheduled inputs and retargets them to the new function. Update any dashboard or alert filters that use the old physical function name. Existing post data needs no migration. Reddit credential parameters remain in Terraform for rollback, but the browser function does not load them.

Local checks do not establish AWS network access, actual Lambda cold starts, or sustained unattended access. After deployment, verify every feed's terminal job event and stored post fields. A human challenge can still prevent a run; this is not a guarantee of challenge-free access.
