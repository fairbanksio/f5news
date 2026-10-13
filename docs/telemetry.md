# Application Telemetry

## Failure Diagnostics

The posts API emits `POSTS_FETCH_FAILED` once per failed database operation,
including coalesced reads. It records the canonical subreddit, connection or query
stage, duration in milliseconds, request IDs, and redacted error details. The HTTP
response stays generic. Request IDs belong in log fields, never metric dimensions.

The scraper emits one `SCRAPER_JOB_COMPLETED` or `SCRAPER_JOB_FAILED` record with
the outcome, stage, duration, fetched and saved counts, image outcomes, and heap
usage. Required database, Reddit authentication, listing, and post-write failures
reject the invocation. Optional image resolution, thumbnail writes, and backfill
failures produce a degraded outcome while retaining per-post diagnostics.
Hard timeouts can stop execution before the summary; retain Lambda runtime logs
and invocation/error metrics for those failures.

Required failures can now trigger Lambda's existing asynchronous retries. Partial
writes retain the existing title/author/creation-time upsert key. This avoids
deliberately inserting a new document on each retry, but it is not a uniqueness
guarantee under concurrent invocations. Workers finish before reporting the job
outcome. Retry settings and database indexes are unchanged. See
[Lambda Retry Behavior](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html).

## Image Metrics

CloudWatch EMF stays in `F5News/Scraper` with `Service`, `Subreddit`, and `Operation`
dimensions. The existing four metric names retain their meanings:

| Metric | Meaning |
| --- | --- |
| `PostImageResolutionAttempts` | Tracked image-resolution attempts |
| `PostImageResolutionResolved` | Attempts returning a usable thumbnail |
| `PostImageResolutionMissing` | Attempts without a usable thumbnail |
| `PostImageResolutionErrors` | Resolver exceptions, possibly also counted as missing |
| `PostImageDependencyFailures` | Attempts with an exhausted publisher dependency failure |

Dependency failures include exhausted HTTP, transport, timeout, response-read, and
redirect failures. Successful transient retries, missing metadata, unsupported
content types, and blocked URLs do not count as dependency failures. A fallback
thumbnail can resolve an image even when a publisher dependency failed. Resolved
counts describe image resolution, not successful database thumbnail writes.

Metrics are absent when there are no image attempts. Use job outcomes and Lambda
invocations for liveness. The additional metric allows up to 22 more identities
for the 11 scheduled subreddits and two operations; this is a configuration bound,
not measured usage or savings.

EMF remains on the existing console emission path. Do not switch Lambda's log
format to JSON without checking extraction or updating the EMF emission path.
[AWS Node.js Logging Guidance](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html)
describes this compatibility requirement.

## Browser Diagnostics

Freshness uses the newest valid `fetchedAt`. A nonempty response with no valid
timestamp is unknown; an empty response is valid and does not prove freshness.
Stale and unknown states log immediately, then at most once every five minutes
with observation counts and time ranges. State changes and recovery log promptly.
Changing subreddit resets the reporting state. Fetch failures include HTTP status,
error type, and duration.

These records remain in the browser console. Central browser collection requires
an ingestion destination and is outside this patch. Engagement analytics are
unchanged.

## Rollout Checks

After normal CI/CD rollout, compare equivalent workload windows: job counts and
outcomes, log records and bytes per invocation, image metric visibility, and
representative connection, listing, write, and publisher failures. Confirm existing
alerts still evaluate and consumers use structured job outcomes instead of the
removed success text or per-post backfill-success records. Failure event names and
post context are retained; duplicate image exception/warning/missing records become
one outcome per attempt. Publisher URL query strings and credentials are redacted.

Roll back through a source revert and the normal release workflow if consumers or
metric extraction regress. Runtime savings and alert behavior require deployed
readback; local tests alone do not establish them.
