FROM node:24.22.2-bookworm-slim AS node

FROM ubuntu:24.04 AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv ca-certificates fonts-dejavu-core libasound2t64 libdbus-glib-1-2 \
    libfontconfig1 libgbm1 libgtk-3-0t64 libnspr4 libnss3 libx11-xcb1 \
    libxdamage1 libxfixes3 libxrandr2 libstdc++6 xvfb tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node

FROM base AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ make cmake unzip xz-utils libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/lib/node_modules/npm /opt/npm
RUN ln -s /opt/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /app/services/scraper
COPY services/scraper/package.json services/scraper/package-lock.json ./
RUN node /opt/npm/bin/npm-cli.js ci --include=dev \
    && mkdir -p /opt/lambda-ric \
    && cp node_modules/aws-lambda-ric/index.mjs \
        node_modules/aws-lambda-ric/rapid-client.node \
        node_modules/aws-lambda-ric/package.json \
        node_modules/aws-lambda-ric/LICENSE \
        node_modules/aws-lambda-ric/NOTICE \
        node_modules/aws-lambda-ric/THIRD-PARTY-LICENSES /opt/lambda-ric/ \
    && node /opt/npm/bin/npm-cli.js prune --omit=dev --ignore-scripts \
    && rm -rf /root/.npm
COPY scripts/reddit-invisible/requirements.lock /app/requirements.lock
ENV PATH=/opt/venv/bin:$PATH \
    INVISIBLE_PLAYWRIGHT_ENGINE_DIR=/opt/invisible-browser \
    INVISIBLE_PLAYWRIGHT_CACHE_DIR=/tmp/invisible-playwright
RUN python3 -m venv /opt/venv \
    && pip install --no-cache-dir -r /app/requirements.lock \
    && python -m invisible_playwright fetch \
    && chmod -R a+rX /opt/invisible-browser

FROM base AS runtime
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    _HANDLER=index.fetchPosts LAMBDA_TASK_ROOT=/app/services/scraper \
    PATH=/opt/venv/bin:$PATH HOME=/tmp XDG_CACHE_HOME=/tmp/.cache \
    INVISIBLE_PLAYWRIGHT_ENGINE_DIR=/opt/invisible-browser \
    INVISIBLE_PLAYWRIGHT_CACHE_DIR=/tmp/invisible-playwright \
    F5_BROWSER_READER=/app/scripts/reddit-stagehand/browser-reader.js \
    F5_SUBREDDITS_FILE=/app/services/posts/subreddits.json
RUN useradd --uid 10001 --no-create-home runner
WORKDIR /app/services/scraper
COPY --from=dependencies /opt/venv /opt/venv
COPY --from=dependencies /opt/invisible-browser /opt/invisible-browser
COPY --from=dependencies /opt/lambda-ric /opt/lambda-ric
COPY --from=dependencies /app/services/scraper/node_modules ./node_modules
COPY services/scraper/*.js services/scraper/package.json ./
COPY --chmod=755 services/scraper/entrypoint.sh ./entrypoint.sh
COPY services/scraper/models ./models
COPY scripts/reddit-invisible/smoke.py /app/scripts/reddit-invisible/smoke.py
COPY scripts/reddit-stagehand/browser-reader.js scripts/reddit-stagehand/f5-dom.js scripts/reddit-stagehand/f5-record.js scripts/reddit-stagehand/package.json /app/scripts/reddit-stagehand/
COPY services/posts/subreddits.json /app/services/posts/subreddits.json
USER 10001:10001
ENTRYPOINT ["/app/services/scraper/entrypoint.sh"]
CMD ["index.fetchPosts"]
