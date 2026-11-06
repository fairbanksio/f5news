FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv ca-certificates fonts-dejavu-core libasound2t64 libdbus-glib-1-2 \
    libfontconfig1 libgbm1 libgtk-3-0t64 libnspr4 libnss3 libx11-xcb1 \
    libxdamage1 libxfixes3 libxrandr2 xvfb \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home runner

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH \
    INVISIBLE_PLAYWRIGHT_CACHE_DIR=/home/runner/.cache/invisible-playwright \
    F5_BROWSER_READER=/app/browser-reader.js F5_SUBREDDITS_FILE=/app/subreddits.json

WORKDIR /app
COPY scripts/reddit-invisible/requirements.lock ./
RUN python3 -m venv /opt/venv && pip install --no-cache-dir -r requirements.lock

USER runner
RUN python -m invisible_playwright fetch

COPY --chown=runner:runner scripts/reddit-invisible/smoke.py ./
COPY --chown=runner:runner scripts/reddit-stagehand/browser-reader.js ./
COPY --chown=runner:runner services/posts/subreddits.json ./
ENTRYPOINT ["python", "/app/smoke.py"]
CMD ["--subreddit", "politics", "--limit", "25"]
