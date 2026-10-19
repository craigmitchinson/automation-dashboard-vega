#!/usr/bin/env bash
# Assemble the deliverable (what main holds) from this source branch into $1,
# usually a worktree of main:  git worktree add ../main-out main && scripts/publish.sh ../main-out
# Run npm run build (and npm run preview if visuals changed) first.
set -euo pipefail
src=$(cd "$(dirname "$0")/.." && pwd)
out=${1:?usage: scripts/publish.sh <main worktree>}
cd "$out"
git rm -rqf --ignore-unmatch . >/dev/null
mkdir -p docs kibana logstash previews
cp "$src/publish/README.md" .
cp "$src"/publish/docs/*.md docs/
cp "$src/dist/kibana/devtools-setup.txt" "$src/dist/kibana/ia-dashboards.ndjson" kibana/
cp -r "$src/dist/specs" kibana/panels
mkdir -p kibana/mock && cp "$src/dist/mock/ia-dashboards-mock.ndjson" kibana/mock/ && cp -r "$src/dist/mock/panels" kibana/mock/panels
cp "$src"/etl/logstash/*.conf "$src"/etl/logstash/*.rb "$src/etl/reference/reference.json" logstash/
cp -r "$src/dist/previews/pages" "$src/dist/previews/visuals" "$src/dist/previews/README.md" previews/
git add -A
git status --short | wc -l | xargs echo "files changed:"
