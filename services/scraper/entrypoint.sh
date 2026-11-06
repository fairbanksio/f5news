#!/bin/sh
set -eu

if [ "${1:-}" = "index.fetchPosts" ]; then
  export _HANDLER="$1"
  export LAMBDA_TASK_ROOT=/app/services/scraper
  shift
  set -- /usr/local/bin/node /opt/lambda-ric/index.mjs "$@"
fi

if [ -n "${AWS_LAMBDA_RUNTIME_API:-}" ]; then
  exec "$@"
fi

exec /usr/bin/tini -s -- "$@"
