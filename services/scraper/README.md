# Browser Scraper

The scheduled handler reads up to 25 organic Rising posts for each configured subreddit through `invisible-playwright`. It replaces the OAuth and Reddit listing API calls. The MongoDB upsert, article thumbnails, image backfill, and job metrics use the existing pipeline.

The Python browser and the Stagehand prototype share a DOM reader and F5 field mapper. The deployed runtime uses Firefox directly because Stagehand requires Chromium. It makes no AI model calls and needs no Browserbase account or Reddit API client credentials.

## Runtime

The function runs from an ARM64 container with 2 GiB RAM, a 240-second timeout, and 1 GiB of temporary storage. Firefox is baked into the image. Runtime state goes under `/tmp`, allowing a read-only root filesystem. On Lambda, the entrypoint starts Node directly to avoid unsupported subreaper calls. Local Docker runs use Tini to reap orphaned browser processes across repeated invocations.

The image command is `index.fetchPosts`. The entrypoint sets the handler and application directory explicitly before starting the Lambda runtime client.

The image builds the Lambda runtime client separately and includes only its bundled JavaScript, compiled native addon, package metadata, and licenses. Its build tools and the application's development dependencies stay out of the runtime image.

Events use a shared authenticated session when `F5_REDDIT_SESSION_ENABLED=true` or `session: true`. Each fresh browser restores the session's cookies, Reddit local storage, and saved seed. Session data lives in private encrypted S3 objects; MongoDB stores only the active generation and renewal coordination. Temporary files use a private directory and 0600 permissions, then are removed after each attempt.

A blocked or challenged reuse gets one bounded retry with the same session before renewal is considered. A missing, invalid, or 12-hour-old session triggers one coordinated login using the existing SSM-backed account credentials. A MongoDB lease uses server time and lasts five minutes. Each login attempt records a 15-minute cooldown before it starts; successful publication reduces that to five minutes. Other invocations wait for the active session. Immutable objects and an owner-checked pointer update prevent an expired lease holder from replacing a newer session. Objects expire after seven days. Challenges and rejected credentials fail without repeated login attempts.

The manual verification workflow supports `scheduled` to read fresh scheduled completions for all 11 feeds without invoking Lambda. It also supports `all_feeds` to check all 11 feeds and repeat politics, requiring one session generation. `renew_session` renews the first invocation under the same lease and cooldown, then verifies reuse. Explicit `session: false, authenticate: true` retains the single-login diagnostic; `session: false` disables shared state for an anonymous diagnostic.

Schedules remain paused during the initial verification rollout. Enable them after both all-feed reuse and renewal checks pass.

Each invocation starts a fresh browser and reads exact timestamps, counts, destination links, and media metadata. Gallery posts receive a detail-page read. Native video manifests are verified before storage. Missing required data, blocked access, unresolved human checks, browser failures, and empty feeds fail the job before any post writes. Optional article thumbnail failures retain the existing degraded-job behavior.

Shared-session acquisition and extraction have a 210-second budget. Anonymous extraction has 90 seconds, and the single-login diagnostic has 150 seconds, shortened when Lambda has less time remaining. It reserves time for process cleanup and storage. Progress logs include `BROWSER_SESSION` with an opaque generation and renewal/reuse mode, `BROWSER_PROGRESS`, `BROWSER_EXTRACTED`, and the existing terminal scraper events. A deadline stops the browser process group and its owned Xvfb display, then rejects the invocation.

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
