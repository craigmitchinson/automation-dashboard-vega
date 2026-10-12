#!/usr/bin/env bash
# Assemble the deliverable (what main holds) from this source branch into $1,
# usually a worktree of main:  git worktree add ../main-out main && scripts/publish.sh ../main-out
# Run npm run build (and npm run preview if visuals changed) first.
set -euo pipefail
src=$(cd "$(dirname "$0")/.." && pwd)
out=${1:?usage: scripts/publish.sh <main worktree>}
cd "$out"
git rm -rqf --ignore-unmatch . >/dev/null
mkdir -p docs kibana logstash jobs previews
cp "$src/publish/README.md" .
cp "$src"/publish/docs/*.md docs/
cp "$src/dist/kibana/devtools-setup.txt" "$src/dist/kibana/ia-dashboards.ndjson" kibana/
cp -r "$src/dist/specs" kibana/panels
mkdir -p kibana/mock && cp "$src/dist/mock/ia-dashboards-mock.ndjson" kibana/mock/ && cp -r "$src/dist/mock/panels" kibana/mock/panels
cp "$src"/etl/logstash/ia-workqueue.conf "$src"/etl/logstash/ia-enrich.rb "$src/etl/reference/reference.json" logstash/
cp "$src/etl/cost-job/stamp_costs.py" "$src"/etl/service-job/service_checks.py "$src"/etl/service-job/service-checks.json "$src"/etl/service-job/create_rules.py "$src/setup/crontab.example" jobs/
cp -r "$src/previews/pages" "$src/previews/visuals" "$src/previews/README.md" previews/
git add -A
git status --short | wc -l | xargs echo "files changed:"
