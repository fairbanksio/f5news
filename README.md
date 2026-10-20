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

### Local API Origins

Local services allow HTTP `localhost` and `127.0.0.1` origins on ports 3000 and 5173 when `IS_OFFLINE=true`. The subreddit service enables offline mode with `npm start`; Serverless Offline enables it for posts. Production Lambda ignores these local allowances and keeps its HTTPS domain allowlist.

For another frontend port, set `LOCAL_FRONTEND_ORIGIN` to its exact HTTP loopback origin. For example, run `LOCAL_FRONTEND_ORIGIN=http://localhost:3011 npm start` in `services/subreddits`. When running posts with Serverless Offline, use `--localEnvironment` to forward that variable. Configure the frontend's API endpoints to use the local services; production APIs still reject localhost.

### Support

Help keep F5.news independent and ad-free: [Buy me a coffee](https://www.buymeacoffee.com/f5news).
