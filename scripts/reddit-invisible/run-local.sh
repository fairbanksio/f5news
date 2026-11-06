#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd -- "$script_dir/../.." && pwd)
daemon_arch=$(docker info --format '{{.Architecture}}')
case "$daemon_arch" in
  aarch64|arm64) native_arch=arm64 ;;
  x86_64|amd64) native_arch=amd64 ;;
  *) printf 'Unsupported Docker architecture: %s\n' "$daemon_arch" >&2; exit 1 ;;
esac

platform="linux/$native_arch"
image="f5-reddit-invisible:local-$native_arch"
printf 'Using native Docker platform %s.\n' "$platform" >&2
docker build --platform "$platform" --file "$script_dir/Dockerfile" --tag "$image" "$repo_dir" >&2
exec docker run --rm --platform "$platform" --init --memory 2g --cpus 2 \
  --pids-limit 256 --shm-size 256m --cap-drop ALL --security-opt no-new-privileges \
  "$image" "$@"
