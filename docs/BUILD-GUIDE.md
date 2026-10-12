# Build guide

Everything you do is in the Kibana UI: no API keys, no scripts, no Node. Two files from this repo, about 30 minutes.

| Who | Does | Where |
|---|---|---|
| You | Part 1: paste one file into Dev Tools, import one file, three settings | Kibana |
| Logstash developer | Part 2: map the Blue Prism fields, run the transform | Logstash host |
| Logstash developer | Part 3: schedule the daily cost job (and, optionally, the service checks) | Same host |

The Blue Prism data stays where it is. Logstash reads it and writes enriched copies to `ia-workqueue-items`, which is what the dashboards read.

## Part 1. In Kibana (you)

**1. Create the indices and load the reference data.** Open `dist/kibana/devtools-setup.txt`, copy all of it, paste into Kibana > Dev Tools > Console, select all and run (Ctrl+Enter). It creates five index templates and loads targets, processes, SLAs and rates into `ia-reference`. Expect `"acknowledged": true` five times, a 404 on the `DELETE` the first time (nothing to delete yet), and `"errors": false` on the bulk load. Safe to re-run.

**2. Import the dashboards.** Stack Management > Saved Objects > Import > `dist/kibana/ia-dashboards.ndjson`, with "Automatically overwrite conflicts" ticked. That brings in the nine dashboards, their panels and the `ia-workqueue-items*` data view.

If the import refuses the file as being from a newer Kibana (it is stamped for 8.15), say which version you have (Help > About) and it gets rebuilt for yours. If it rejects `controlGroupInput`, the same: it gets rebuilt without controls and you add them in step 3.

**3. Settings.**
- Stack Management > Advanced Settings > Dark mode **off**. The panels are designed for the light theme.
- Only if the dashboards came without controls: on one dashboard, Edit > Controls > Add options list for `spoke.name`, `proposition.name`, `process.name`, `queue.name` and `process.tags` (titled Spoke, Proposition, Process, Queue, Tags), save, and copy them to the others.
- Optional, 8.12+: replace the navigation strip at the top of each dashboard with a Links panel to the nine dashboards, ticking "Use filters and query from origin dashboard" and "Use date range", so a clicked process carries through to Process detail.

The dashboards show nothing until Part 2 has run. That is expected.

## Part 2. The transform (Logstash developer)

`docs/DATA-CONTRACT.md` is the specification. The work is mostly field mapping:

1. Copy `etl/logstash/ia-enrich.rb` and `etl/reference/reference.json` to the Logstash host.
2. In `ia-enrich.rb`, point `SOURCE_FIELDS` at your Blue Prism field names, and set `WORKTIME_DIVISOR` if worktime is in milliseconds.
3. Fill in the placeholders in `etl/logstash/ia-workqueue.conf` and start the pipeline.
4. Check in Discover (data view `ia-workqueue-items*`):
   - items arrive with `outcome`, `process.name`, `spoke.name`, `value.benefit_gbp` and `item.sla_due_at` filled in;
   - `mapped: false` is rare (each one is a queue missing from `queueMap` in reference.json);
   - a pending item becomes Completed in place when it finishes (same `_id`), not a second document;
   - times are UTC: compare a few against Control Room.

If a figure disagrees with the React app, check the field mapping first. The logic is tested against the React app's on 20,000 items.

## Part 3. Scheduled jobs (Logstash developer, same host)

**The cost job: required for any £ figure.** An item's cost depends on how much of its VDI's day it used, which Logstash can't know while the day is still running. So one script runs once a day after the overnight ingest:

```bash
pip install requests
python3 etl/cost-job/stamp_costs.py --reference reference.json --dry-run   # look first
python3 etl/cost-job/stamp_costs.py --reference reference.json             # first run backfills every day
```

Then add it to cron (`setup/crontab.example`). Without it, £ figures show £0 and Value & Finance is empty; everything else works.

**The service checks: optional.** Only needed if the run team wants Teams or email alerts rather than looking at the Service dashboard. A second script every 15 minutes, plus four alert rules (`docs/SERVICE.md`). Without it, the Service dashboard still shows the live checks; only its "Last 24 hours" history panel stays empty. Leave this until everything else is working.

Both jobs need one Elasticsearch API key, created by whoever runs the host: read on the Blue Prism index and `ia-*`, write on `ia-*`.

## First look

Open each dashboard on a 90-day window. A red error box on a panel is the thing to report. Otherwise:

| Dashboard | Works when | If not |
|---|---|---|
| Service | Nine checks with a status | All "Out of hours": service hours are 07:00 to 19:00 UTC |
| Process detail | Tiles to choose a process; clicking one fills the page | Data view title must be `ia-workqueue-items*` |
| Overview | Six tiles, item flow, watchlist | Blank: no mapped items yet (Part 2) |
| Process Analysis | Missed SLA bars, league table | Missed SLA all 0%: `item.sla_due_at` missing (Part 2) |
| Exceptions | Heatmap of process by reason | Few columns: needs exception patterns in reference.json |
| VDI & Capacity | Every VDI with utilisation | No VDIs: `resources` names must match Blue Prism's |
| Alerts | Rows per process ranked by £ at stake | Everything breaching: targets need calibrating |
| Executive Summary | FYTD figures, health line | £0 everywhere: cost job (Part 3) |
| Value & Finance | Waterfall from gross to net | £0: cost job (Part 3) |

Also try one spoke selected, and a 12-month window. To report a problem: dashboard, panel, screenshot, and for an error the panel's Inspect > Requests.

## Changing things

| To change | Edit | Then |
|---|---|---|
| Targets, SLAs, releases, processes, rates | `etl/reference/reference.json` | Rebuild, re-run step 1, copy the file to the Logstash host |
| A panel, colours, wording | `vega/panels/*.mjs`, `vega/lib/tokens.mjs` | Rebuild, re-import (step 2) |

"Rebuild" is `npm run build` on any machine with Node 20+, which regenerates both files in `dist/`. Don't edit panels in Kibana's Vega editor: the next import overwrites them.

## Appendix: doing it from a script instead

`setup/install.py` does Part 1 from the command line (templates, reference data, import) plus a `verify` step that counts what the dashboards rely on. It needs Elasticsearch and Kibana API keys, so it is only worth it for repeated installs or CI. `python3 setup/install.py` with no arguments explains itself.

To see the dashboards working before real data exists, the mock data (`npm run mock`, then `python3 setup/install.py mock`, about 360 MB) loads into a test space; set the time picker to end on 14 July 2026. The pictures in `previews/` show the same thing without loading anything.
