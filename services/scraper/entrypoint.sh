#!/bin/sh
set -eu

if [ -n "${AWS_LAMBDA_RUNTIME_API:-}" ]; then
  exec "$@"
fi

exec /usr/bin/tini -s -- "$@"
