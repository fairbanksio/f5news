# Production Credential Boundary

The production environment migration is deferred. This PR keeps the existing deployment credentials, AWS role, and branch-based OIDC identity. No GitHub environment setup, secret transfer, or AWS trust change is required to release it.

Deploy jobs require `refs/heads/main`. The Serverless access key is available only to deployment steps, and PR Terraform validation receives no Terraform Cloud token. These changes reduce exposure, but a workflow condition cannot protect repository secrets from someone who can edit a branch workflow. The stronger credential boundary remains unresolved.

## Deferred Migration

If this work resumes, coordinate these changes before adding `environment: production` to Deploy:

1. Create a `production` environment with a custom deployment branch policy allowing only the branch `main`. Preserve the existing automated release policy unless a separate approval requirement is intended.
2. Move `TF_API_TOKEN` and `SERVERLESS_ACCESS_KEY` into that environment and remove repository-accessible copies. Obtain replacement values from their owners; GitHub cannot reveal existing values.
3. Update the deployment role through its infrastructure repository to require `aud = sts.amazonaws.com` and `sub = repo:fairbanksio/f5news:environment:production`. Verify the trust policy and environment branch restriction together before switching the workflow.

The current AWS trust policy and historical credential revocation remain unverified. No production credentials or cloud settings were changed during this remediation.

## Scanner Credentials

Snyk fails when `SNYK_TOKEN` is unavailable. Supported PRs need the scanner credential in the appropriate Actions or Dependabot secret store. Fork PRs without a token remain blocked by the required check. The scanner reads committed npm lockfiles without installing dependency lifecycle scripts.

## Release Checks

1. Run the required PR checks and Snyk scans.
2. Promote only `develop` to `main` through the existing release workflow.
3. Observe Deploy for the release SHA, then verify the news UI and supported API routes.

Gateway throttling and Lambda concurrency caps are also deferred until burst traffic and account capacity can be measured. Supported-subreddit validation, query coalescing, a short cache, query deadlines, and connection limits reduce database work but do not bound public API invocation costs.
