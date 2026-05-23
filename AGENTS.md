# AGENTS.md

This file gives automation agents and contributors the minimum repo-specific context needed to work safely in `f5oclock`.

## Repo Overview

This repository is a small serverless news app with three main parts:

- `infrastructure/`: Terraform for Route53, ACM, CloudFront, S3, SSM, and MongoDB Atlas
- `services/`: AWS Lambda services deployed with Serverless Framework
- `webui/`: React frontend deployed to S3 + CloudFront

Service layout:

- `services/posts`: read API for posts by subreddit
- `services/subreddits`: read API for available subreddits
- `services/scraper`: scheduled job that fetches Reddit data into MongoDB
- `services/browser`: Puppeteer-based article extraction endpoint

## Toolchain and Prerequisites

Use the versions implied by CI unless a task explicitly requires something else:

- Node.js 20.x for CI-compatible installs and deploys
- npm
- Terraform `1.1.7`
- AWS credentials with access to SSM, S3, CloudFront, Route53, Lambda, and related deploy resources
- Terraform Cloud token for infrastructure apply
- MongoDB Atlas API credentials for Terraform
- Serverless Framework CLI when deploying services locally

There is no root `package.json`. Install and run commands per subproject.

## Initial Setup

### 1. Install frontend dependencies

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/webui
npm ci
```

### 2. Install service dependencies

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/services/posts
npm ci

cd /Users/jonfairbanks/Documents/GitHub/f5oclock/services/subreddits
npm ci

cd /Users/jonfairbanks/Documents/GitHub/f5oclock/services/scraper
npm ci

cd /Users/jonfairbanks/Documents/GitHub/f5oclock/services/browser
npm ci
```

### 3. Initialize Terraform when working on infrastructure

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/infrastructure
terraform init
```

## Environment and Secrets

The repo relies heavily on AWS SSM Parameter Store and Terraform variables.

Terraform variables expected in `infrastructure/variables.tf`:

- `primary_domain`
- `mongodb_atlas_public_key`
- `mongodb_atlas_private_key`
- `mongodb_atlas_org_id`
- `reddit_client_id`
- `reddit_secret_key`
- `reddit_username`
- `reddit_password`

SSM parameters used by services and deploy scripts include:

- `primary_domain_name`
- `primary_domain_cert_arn`
- `primary_domain_cdn`
- `primary_domain_cdn_distribution`
- `primary_db_connection_string`
- `reddit_client_id`
- `reddit_secret_key`
- `reddit_username`
- `reddit_password`

Do not hardcode secrets into source files. Prefer Terraform variables and SSM parameters.

## Common Commands

### Frontend

Install:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/webui
npm ci
```

Run locally:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/webui
npm start
```

Build:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/webui
npm run build
```

Tests:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/webui
CI=true npm test -- --watchAll=false
```

Generate runtime config from SSM:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/webui
npm run generate-config
```

Deploy frontend:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/webui
npm run deploy
```

Notes:

- `npm run lint` is currently a placeholder and does not perform linting.
- Deployment scripts shell out to AWS CLI and read SSM parameters.

### Lambda Services

Install dependencies in any service:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/services/<service-name>
npm ci
```

Placeholder test command for services:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/services/<service-name>
npm test
```

Notes:

- Most service `npm test` scripts are placeholders and currently exit with an error.
- Do not rely on service tests for validation unless you add real tests as part of your change.

Deploy a service locally:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/services/posts
serverless deploy
```

Equivalent pattern applies to:

- `services/subreddits`
- `services/scraper`
- `services/browser`

### Infrastructure

Format check:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/infrastructure
terraform fmt -check
```

Format in place:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/infrastructure
terraform fmt
```

Validate:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/infrastructure
terraform validate
```

Plan:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/infrastructure
terraform plan
```

Apply:

```bash
cd /Users/jonfairbanks/Documents/GitHub/f5oclock/infrastructure
terraform apply
```

## CI and Deployment

CI workflow: `.github/workflows/deploy.yml`

Main branch deploy flow:

1. Apply Terraform from `infrastructure/`
2. Deploy serverless services from `services/`
3. Deploy `webui/`

CI uses:

- Terraform `1.1.7`
- Node `20.x`
- GitHub OIDC to assume an AWS role

When changing deploy logic, keep local commands aligned with the workflow.

## Coding Conventions

### General

- Follow the existing structure rather than introducing new frameworks or build systems.
- Keep changes scoped to the affected subproject.
- Prefer small, reviewable patches.
- Avoid adding broad abstractions to a codebase this size.
- Do not commit secrets, generated credentials, or environment-specific values.

### JavaScript Style

- Match the style of the file you are editing instead of forcing a repo-wide style.
- Frontend code generally uses React function components, hooks, and context providers.
- Backend services and deployment scripts use CommonJS modules.
- Keep comments short and only where behavior is non-obvious.

### Frontend Conventions

- Use function components and hooks.
- Existing UI is Chakra UI v1-based. Reuse Chakra primitives before adding new UI dependencies.
- Existing tests use React Testing Library and Jest.
- When adding frontend tests, prefer behavior-focused tests over implementation details.
- Preserve the current route structure: `/r/:subredditPath`.
- Runtime API configuration comes from `window.REACT_APP_API` in `webui/public/config.js` or `process.env.REACT_APP_API`.

### Service Conventions

- Services are small entrypoints; keep handlers focused and avoid mixing unrelated responsibilities.
- Reuse the existing Mongo connection helpers per service rather than creating new connection logic.
- Keep environment-driven configuration in `serverless.yml` and SSM, not inline in handlers.
- Maintain compatibility with the current CommonJS module layout.

### Infrastructure Conventions

- Keep Terraform changes explicit and easy to review.
- Preserve the current pattern of using SSM parameters to bridge infrastructure outputs into services and deploy scripts.
- Run `terraform fmt` after editing Terraform files.

## Validation Expectations

Minimum validation for most changes:

- Frontend-only changes: run `CI=true npm test -- --watchAll=false` in `webui`
- Infrastructure-only changes: run `terraform fmt -check` and `terraform validate`
- Service-only changes: there are no meaningful automated tests today, so validate with targeted reasoning, local invocation if available, and deployment-safe review

If you cannot run a meaningful validation step, say so explicitly in your final summary.

## Known Gaps

- No root-level task runner
- No real test suites in most services
- Frontend lint script is a placeholder
- Browser and scraper services have dependency debt; be careful when upgrading them because transitive changes may be large

## Files Worth Reading Before Large Changes

- `/Users/jonfairbanks/Documents/GitHub/f5oclock/.github/workflows/deploy.yml`
- `/Users/jonfairbanks/Documents/GitHub/f5oclock/infrastructure/main.tf`
- `/Users/jonfairbanks/Documents/GitHub/f5oclock/infrastructure/mongo.tf`
- `/Users/jonfairbanks/Documents/GitHub/f5oclock/webui/package.json`
- `/Users/jonfairbanks/Documents/GitHub/f5oclock/services/scraper/package.json`
