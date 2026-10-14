# Application Review Follow-Up

Eight remaining report findings are addressed in this change:

| Finding | Change |
| --- | --- |
| 5 | CloudFront signs requests to the S3 REST origin. The bucket policy allows only this distribution, all public-access blocks are enabled, and the existing ACL becomes private. |
| 6 | Add the missing www A and apex/www AAAA aliases without renaming the existing apex A resource. |
| 7 | Evaluate model timestamp defaults when each document is created. |
| 8 | Attach AWS's managed SecurityHeadersPolicy. It supplies basic headers but no CSP. |
| 10 | Identify the scraper and its configured contact in Reddit requests while preserving authentication. |
| 14 | Allow explicit HTTP loopback origins in offline services while retaining production restrictions. |
| 17 | Clear loading immediately after posts arrive. |
| 18 | Use serialized `_id` or the comment permalink in selection analytics. |

## Origin Migration

Terraform updates CloudFront before replacing the public bucket policy. Public-access blocks follow the restricted policy, then the existing bucket ACL becomes private. Website configuration is retained during this transition so the previous endpoint stays available while CloudFront switches origins. CloudFront uses `index.html` as its root object and returns it for both 403 and 404 responses to preserve SPA deep links.

Bucket ownership stays `BucketOwnerPreferred`. Switching directly to `BucketOwnerEnforced` can fail while the existing public ACL is present. Uploads continue through the existing deployment role and do not need public object ACLs.

Configuration tests use mocked providers. They do not prove the live migration. After promotion through CI, verify apex/www A and AAAA DNS, HTTPS headers, `/`, a direct `/r/science` navigation, an asset request, and denial of anonymous S3 access. Confirm Terraform completes without replacing the bucket or distribution.

## Deferred Work

Indexing requires live index inventory and representative query plans. Retention, token caching, schedule changes, polling, and narrower cache invalidation require capacity, traffic, freshness, or cache measurements. Keep the current historical retention and feed freshness contracts.

A strict CSP needs compatibility checks for Chakra styling, analytics, images, and media. Atlas network changes need an architecture and cost decision. The report's script-link exploit was not reproduced in the installed React version. Subreddit configuration duplication already has a CI parity guard; runtime configuration machinery remains a separate recommendation.
