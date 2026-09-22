# Production Credential Boundary

The Deploy workflow requires `refs/heads/main` and the `production` environment. The environment and secret migration must be completed before this patch is released. A workflow condition alone cannot protect repository secrets from someone who can edit a branch workflow.

## Required GitHub Settings

Create `production` with a custom deployment branch policy allowing only the branch `main`. Do not allow tags, wildcard branches, or every protected branch. Disable administrator bypass where the repository plan supports it. This preserves automated releases after the existing protected `develop` to `main` checks; adding a required human reviewer would change that release policy.

Move `TF_API_TOKEN` and `SERVERLESS_ACCESS_KEY` into this environment, then remove their repository and any repository-accessible organization copies. GitHub cannot reveal existing secret values, so obtain replacements from the credential owners. Rotate them if prior exposure is suspected. Keep the PR in draft until this migration is coordinated, because existing Deploy revisions do not reference the environment.

The Snyk workflow now fails when `SNYK_TOKEN` is unavailable. Supply the scanner credential through the appropriate Actions and Dependabot secret stores for supported PRs. Fork PRs without a token remain blocked by the required check. Do not restore warning-only success to unblock them. The scanner reads committed npm lockfiles without installing or executing dependency lifecycle scripts.

## AWS Trust

The deployment role must trust only this repository's protected production environment, using `aud = sts.amazonaws.com` and `sub = repo:fairbanksio/f5news:environment:production`. Environment jobs use this subject instead of the branch-only subject. Enforce `main` through the environment's branch policy. Remove broader repository or wildcard subjects; preserve unrelated principals only after reviewing their ownership.

The current role trust could not be read during remediation. The available AWS connector targets a different account, and the local F5 login has expired. Apply this change through the role owner's infrastructure repository and CI workflow, then verify the policy by readback.

## Release Checks

1. Verify the environment permits only `main`, and the production credentials exist only at the protected environment scope.
2. Verify the AWS trust policy, including its audience and exact subject.
3. Run the normal PR checks and Snyk scans. Promote only `develop` to `main` through the existing release workflow.
4. Observe Deploy for the release SHA and confirm the news UI and supported API routes return ordinary results.

Gateway throttling and Lambda concurrency caps are deferred until burst traffic and account capacity can be measured. This patch retains supported-subreddit validation, query coalescing, a short cache, query deadlines, and connection limits. These reduce database work but do not bound public API invocation costs.

No production dispatch, secret transfer, credential rotation, or cloud mutation was performed during local remediation.
