#!/bin/bash
set -euo pipefail
analysis_dir="$(cd "$(dirname "$0")" && pwd)"
python_bin="${F5_PYTHON:-python3.11}"
if ! command -v "$python_bin" >/dev/null 2>&1; then
  echo "Python 3.11 is required. Install it with: brew install python@3.11" >&2
  exit 1
fi
"$python_bin" -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 11) else 1)' || {
  echo "Use Python 3.11. Set F5_PYTHON to its executable path if needed." >&2
  exit 1
}
venv_dir="$analysis_dir/models/runner-venv"
if [ ! -x "$venv_dir/bin/python" ]; then
  echo "Creating the local analysis environment..."
  "$python_bin" -m venv "$venv_dir"
fi
requirements_hash="$(cat "$analysis_dir/requirements.txt" "$analysis_dir/requirements-runner.txt" | shasum -a 256 | cut -d ' ' -f 1)"
stamp="$venv_dir/.requirements-hash"
if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$requirements_hash" ]; then
  echo "Installing notebook dependencies (first run or changed requirements)..."
  "$venv_dir/bin/python" -m pip install --disable-pip-version-check -q -r "$analysis_dir/requirements-runner.txt"
  printf '%s\n' "$requirements_hash" > "$stamp"
fi
export PYTHONDONTWRITEBYTECODE=1
exec "$venv_dir/bin/python" "$analysis_dir/run_notebook.py" "$@"
