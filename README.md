# F5.news

<img src="demo.gif">

![GitHub top language](https://img.shields.io/github/languages/top/fairbanksio/f5news.svg)
![GitHub last commit](https://img.shields.io/github/last-commit/fairbanksio/f5news.svg)
![License](https://img.shields.io/github/license/fairbanksio/f5news.svg?style=flat)

Trending news site built with AWS Lambdas that monitor web trends, storing data in a cloud-hosted MongoDB and presenting it to users via an AWS-hosted React UI.

### Live Site

<span style="font-size: 20px;">
    <a href="https://f5.news">F5.news</a>
</span>

### Deployments

Main-branch deployments select components from changes since the last successful automatic deployment. Required pull-request checks still run before release.

| Changed Area | Deploys |
| --- | --- |
| `webui/` | Web UI |
| An individual service | That service |
| Shared feed catalog | All services and Web UI |
| Browser runtime inputs | Scraper and live verification |
| `infrastructure/` | Full stack |
| Documentation and unit test files | Nothing |

Deployment logic changes, unknown runtime inputs, or unavailable deployment history trigger a full rollout. Failed or cancelled prerequisites block dependent deployments.

The Deploy workflow also accepts manual scopes: `full`, `changed`, `webui`, `posts`, `subreddits`, `scraper`, and `infrastructure`. The default is `full` for recovery. For example, deploy only the frontend with:

```sh
gh workflow run deploy.yml --ref main -f scope=webui
```

Manual runs leave the automatic deployment baseline unchanged.

### Local API Origins

Local services allow HTTP `localhost` and `127.0.0.1` origins on ports 3000 and 5173 when `IS_OFFLINE=true`. The subreddit service enables offline mode with `npm start`; Serverless Offline enables it for posts. Production Lambda ignores these local allowances and keeps its HTTPS domain allowlist.

For another frontend port, set `LOCAL_FRONTEND_ORIGIN` to its exact HTTP loopback origin. For example, run `LOCAL_FRONTEND_ORIGIN=http://localhost:3011 npm start` in `services/subreddits`. When running posts with Serverless Offline, use `--localEnvironment` to forward that variable. Configure the frontend's API endpoints to use the local services; production APIs still reject localhost.

### Support

Help keep F5.news independent and ad-free: [Buy me a coffee](https://www.buymeacoffee.com/f5news).

### Local Reddit Extraction

The [Stagehand prototype](scripts/reddit-stagehand/README.md) extracts Rising posts into JSON using a separate local Chrome profile or an existing session. It runs separately from the scheduled scraper and does not write to MongoDB.

The scheduled scraper now uses the [Firefox browser source](services/scraper/README.md) in an ARM64 Lambda container. It reads up to 25 Rising posts per configured feed, then uses the existing MongoDB and image pipeline. The [local runtime test](scripts/reddit-invisible/README.md) shares the same browser reader.
