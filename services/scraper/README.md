# Browser Scraper

The scheduled handler reads up to 25 organic Rising posts from r/politics through `invisible-playwright`. It replaces the OAuth and Reddit listing API calls. The scraper saves the posts and media exposed by the initial listing to MongoDB and records the outcome.

The Python browser and the Stagehand prototype share a DOM reader and F5 field mapper. The deployed runtime uses Firefox directly because Stagehand requires Chromium. It makes no AI model calls and needs no Browserbase account or Reddit API client credentials.

## Runtime

The function runs from an ARM64 container with 3008 MiB RAM, a 240-second timeout, and 1 GiB of temporary storage. Firefox is baked into the image. Runtime state goes under `/tmp`, allowing a read-only root filesystem. On Lambda, the entrypoint starts Node directly to avoid unsupported subreaper calls. Local Docker runs use Tini to reap orphaned browser processes across repeated invocations.

The image command is `index.fetchPosts`. The entrypoint sets the handler and application directory explicitly before starting the Lambda runtime client.

The image builds the Lambda runtime client separately and includes only its bundled JavaScript, compiled native addon, package metadata, and licenses. Its build tools and the application's development dependencies stay out of the runtime image.

Events use a shared authenticated session when `F5_REDDIT_SESSION_ENABLED=true` or `session: true`. A scheduled batch reuses one browser context for the Politics feed. Each new browser restores the session's cookies, Reddit local storage, and saved seed. Session data lives in private encrypted S3 objects; MongoDB stores only the active generation and renewal coordination. Temporary files use a private directory and 0600 permissions, then are removed after each attempt.

The scheduled batch opens r/politics Rising once every 15 minutes and gives the page up to three seconds to render more cards before reading the listing once. It saves up to 25 posts. The browser does not scroll, open post pages, or retry the listing within the run. The scheduled job uses the listing images and skips additional cover and video manifest fetches. Posts with incomplete media still appear, with whatever media the listing provided. Manual publisher image backfill remains available separately.

A Reddit challenge or HTTP 429 pauses shared-session requests for Reddit's retry delay, or ten minutes when no delay is provided. Scheduled scrapes and renewals skip the browser during cooldown. The next scheduled run after expiry can try again. A separate 12-hour job renews the session using the existing coordinated login. Session objects expire after seven days.

The manual verification workflow supports `diagnostics` to inspect session counts, expiry, and coordination metadata without exposing stored values or opening Reddit. Supply a base64 DER SPKI RSA public key in `diagnostics_public_key`; keep the private key local. The workflow emits an encrypted report, including bounded memory, resource, and HTTP status aggregates from the last hour of private runtime logs. It supports `scheduled` to read fresh scheduled completions for r/politics without invoking Lambda. It also supports `all_feeds` to check the configured feed in one browser, then wait five minutes and repeat r/politics in a fresh browser to verify persisted reuse. Both invocations must use one session generation. `renew_session` renews the first invocation under the same lease and cooldown, then verifies reuse. Explicit `session: false, authenticate: true` retains the single-login diagnostic; `session: false` disables shared state for an anonymous diagnostic.

Batch browser extraction has a 160-second budget and reserves time for bounded post writes and optional image work. Single-feed shared-session acquisition and extraction have a 210-second budget. Anonymous extraction has 90 seconds, and the single-login diagnostic has 150 seconds, shortened when Lambda has less time remaining. It reserves time for process cleanup and storage. Progress logs include `BROWSER_SESSION` with an opaque generation and renewal/reuse mode, `BROWSER_PROGRESS`, `BROWSER_EXTRACTED`, and the existing terminal scraper events. A deadline stops the browser process group and its owned Xvfb display, then rejects the invocation.

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
docker run --rm --init --read-only --memory 3008m --pids-limit 1024 \
  --tmpfs /tmp:rw,size=1g --entrypoint node f5-scraper:local -e '
const { scrapePosts } = require("./browser-source");
scrapePosts({ subreddit: "politics" }).then(posts => {
  console.log(JSON.stringify({ count: posts.length }));
}).catch(error => { console.error(error.message); process.exitCode = 1; });'
```

No credentials are required for that extraction check. Running the real handler writes to MongoDB and requires `MONGO_CONNECTION_STRING`.

## Deployment

Use the repository's GitHub Actions deployment workflow. With schedules paused, deployment checks the full batch and persisted reuse at the normal cadence. With scheduling enabled, it watches actual scheduled completions instead of adding manual browser traffic. Every extracted post must be saved. It prints aggregate counts only; raw responses stay on the runner. Serverless builds the container from the repository root and publishes it to its managed ECR repository. The deployment role needs the ECR image-build and push permissions required by Serverless, in addition to its existing Lambda and CloudFormation permissions.

The function has a new physical name ending in `fetchPosts-browser`, since AWS cannot change an existing ZIP function into an image function. CloudFormation targets the batch schedule at this function. Update any dashboard or alert filters that use the old physical function name. Existing post data needs no migration. OAuth client parameters remain in Terraform for rollback. The browser function loads only the Reddit username and password needed for coordinated session renewal.

Local checks do not establish AWS network access, actual Lambda cold starts, or sustained unattended access. After deployment, verify every feed's terminal job event and stored post fields. A human challenge can still prevent a run; this is not a guarantee of challenge-free access.
