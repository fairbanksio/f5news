# Browser Scraper

The scheduled handler reads up to 25 organic Rising posts for each configured subreddit through `invisible-playwright`. It replaces the OAuth and Reddit listing API calls. The MongoDB upsert, article thumbnails, image backfill, and job metrics use the existing pipeline.

The Python browser and the Stagehand prototype share a DOM reader and F5 field mapper. The deployed runtime uses Firefox directly because Stagehand requires Chromium. It makes no AI model calls and needs no Browserbase account or Reddit API client credentials.

## Runtime

The function runs from an ARM64 container with 3008 MiB RAM, a 240-second timeout, and 1 GiB of temporary storage. Firefox is baked into the image. Runtime state goes under `/tmp`, allowing a read-only root filesystem. On Lambda, the entrypoint starts Node directly to avoid unsupported subreaper calls. Local Docker runs use Tini to reap orphaned browser processes across repeated invocations.

The image command is `index.fetchPosts`. The entrypoint sets the handler and application directory explicitly before starting the Lambda runtime client.

The image builds the Lambda runtime client separately and includes only its bundled JavaScript, compiled native addon, package metadata, and licenses. Its build tools and the application's development dependencies stay out of the runtime image.

Events use a shared authenticated session when `F5_REDDIT_SESSION_ENABLED=true` or `session: true`. A scheduled batch reuses one browser context across all 11 feeds. Each new browser restores the session's cookies, Reddit local storage, and saved seed. Session data lives in private encrypted S3 objects; MongoDB stores only the active generation and renewal coordination. Temporary files use a private directory and 0600 permissions, then are removed after each attempt.

A blocked, challenged, or interrupted reuse gets one bounded retry with the same session. Transient GET navigation failures also receive up to three attempts within the original timeout; form submissions are never retried. Firefox preserves empty HTTP error responses for status inspection instead of replacing them with an internal error page. HTTP 401, 403, and 429 responses stop immediately without another browser attempt or login. A 429 pauses shared-session requests in MongoDB for the supplied retry delay, or ten minutes when no delay is provided. Paused jobs make no browser or login attempt. Other exhausted transport or access failures do not trigger login. Missing or genuinely invalid session data triggers one coordinated login using the existing SSM-backed account credentials. A MongoDB lease uses server time and lasts five minutes. Each login attempt records a 15-minute cooldown before it starts; successful publication reduces that to five minutes. A separate 12-hour job renews the session without repeating the full feed batch. Regular batches keep using the active session. Single-feed checks can also refresh a session after 12 hours; waiters and failed proactive refreshes retain proven posts and report deferred renewal. Explicit renewal tests still require a verified new session. Other invocations wait when no working session is available. Immutable objects and an owner-checked pointer update prevent an expired lease holder from replacing a newer session. Objects expire after seven days. Challenges and rejected credentials fail without repeated login attempts.

The manual verification workflow supports `diagnostics` to inspect session counts, expiry, and coordination metadata without exposing stored values or opening Reddit. Supply a base64 DER SPKI RSA public key in `diagnostics_public_key`; keep the private key local. The workflow emits an encrypted report, including bounded memory, resource, and HTTP status aggregates from the last hour of private runtime logs. It supports `scheduled` to read fresh scheduled completions for all 11 feeds without invoking Lambda. It also supports `all_feeds` to check all 11 feeds in one browser, then repeat politics in a fresh browser to verify persisted reuse. Both invocations must use one session generation. `renew_session` renews the first invocation under the same lease and cooldown, then verifies reuse. Explicit `session: false, authenticate: true` retains the single-login diagnostic; `session: false` disables shared state for an anonymous diagnostic.

The feed batch runs every five minutes. A separate job renews the shared session every 12 hours. Both use the shared rate-limit backoff.

Each batch starts one browser and reads exact timestamps, counts, destination links, and media metadata for all configured feeds. Single-feed events remain available for diagnostics. Gallery posts receive a detail-page read. Known-small stored link thumbnails take priority for up to four optional Reddit detail reads within a shared 25-second batch budget. Candidate allocation rotates across feeds, selecting larger published previews. Native video manifests are verified before storage. Missing required data, blocked access, unresolved human checks, browser failures, and empty feeds fail the affected feed. A partial batch preserves completed feeds and reports unattempted feeds as failed. Optional preview failures retain valid listing data. Optional article thumbnail failures retain the existing degraded-job behavior. Recent known-small link thumbnails receive bounded repair checks at most once per hour. A small fallback cannot replace an existing large or unknown-size image; the repair timestamp stays out of the public API.

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

Use the repository's GitHub Actions deployment workflow. After deploying the scraper, the workflow checks politics and requires every extracted post to be saved. Use the manual `all_feeds` check for a full batch and fresh-browser reuse verification. It prints aggregate counts only; raw responses stay on the runner. Serverless builds the container from the repository root and publishes it to its managed ECR repository. The deployment role needs the ECR image-build and push permissions required by Serverless, in addition to its existing Lambda and CloudFormation permissions.

The function has a new physical name ending in `fetchPosts-browser`, since AWS cannot change an existing ZIP function into an image function. CloudFormation targets the batch schedule at this function. Update any dashboard or alert filters that use the old physical function name. Existing post data needs no migration. OAuth client parameters remain in Terraform for rollback. The browser function loads only the Reddit username and password needed for coordinated session renewal.

Local checks do not establish AWS network access, actual Lambda cold starts, or sustained unattended access. After deployment, verify every feed's terminal job event and stored post fields. A human challenge can still prevent a run; this is not a guarantee of challenge-free access.
