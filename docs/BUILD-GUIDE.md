# Build guide: from this repo to working dashboards in Kibana

This is the order to do it in, who does each step, and how to tell it worked. Allow a day for the Kibana side and a few days for the Logstash side, most of which is mapping your Blue Prism fields.

Two routes, and the first is strongly recommended:

- **Route A: mock data first.** Load the demo data into a sandbox space or test cluster and import the dashboards. In about an hour you see all nine dashboards working in your own Kibana, and any Kibana-specific problems show up before real data muddies the picture.
- **Route B: real data.** Steps 1 to 10 below.

## What you're building

```
Blue Prism items already in Elastic
        │  Logstash, every 15 min: ia-enrich.rb (stage 1)
        ▼
ia-workqueue-items ◄── cost job, daily (stage 2): stamps cost.* ──► ia-cost-daily, ia-vdi-daily
        │                                                     ▲
        │                          reference.json ─► ia-reference (targets, processes, SLAs, releases)
        ▼
46 Vega panels on 9 dashboards (Kibana)
        ▲
ia-service-checks ◄── service check job, every 15 min ──► 4 alert rules ──► Teams / email
```

| Who | Does |
|---|---|
| Logstash developer | Step 4 (stage 1), and keeps Blue Prism field names mapped |
| Platform / Elastic admin | Steps 1, 2, 3, 6, 9 (API keys, templates, import, connectors) |
| Whoever runs scheduled jobs | Steps 5 and 8 (two cron entries) |
| You (IA lead) | Steps 7 and 10, and the reference data: targets, SLAs, releases |

## Before you start

- [ ] **Kibana version.** Help menu > About, or `python3 setup/install.py check`. You need it in step 2.
- [ ] **Licence.** Platinum: everything here works, including PDF export and the Teams/email connectors.
- [ ] **A machine with Node 20+** to run the build (any laptop or CI runner). Kibana and Elasticsearch never need Node.
- [ ] **A host for the two jobs** with Python 3.9+ (the Logstash host is fine).
- [ ] **API keys.** For setup: `manage_index_templates`, plus write on `ia-*`, plus Kibana saved-object write. For the jobs: read on the Blue Prism index and `ia-*`, write on `ia-workqueue-items`, `ia-cost-daily`, `ia-vdi-daily` and `ia-service-checks`. For the alert rules: Kibana "Rules and Connectors" in the target space.

Set these in your shell for the setup steps (the jobs use the same names):

```bash
export IA_ES_URL=https://your-cluster:9200      IA_ES_API_KEY=...
export IA_KIBANA_URL=https://your-kibana         IA_KIBANA_API_KEY=...
# export IA_KIBANA_SPACE=ia                      # if the dashboards live in their own space
```

## Step 1. Check connectivity

```bash
python3 setup/install.py check
```

Expect four `ok` lines: Elasticsearch version, licence, Kibana version, and whether `dist/` matches your Kibana. A `FAIL` on the last line means step 2 is needed.

## Step 2. Build for your Kibana version

```bash
npm ci
KIBANA_VERSION=8.14.3 npm run build     # your exact version from step 1
npm test                                # 48 checks: every spec parses, the numbers reconcile
```

Kibana refuses saved objects stamped with a newer version than itself, so this stamps them with yours. Commit nothing from this step; it only rewrites `dist/`.

## Step 3. Index templates and reference data

```bash
python3 setup/install.py templates reference
```

This creates the five index templates (strict mappings, so a wrong field name fails loudly instead of silently) and loads `ia-reference` from `reference.json`.

**Before go-live, edit `etl/reference/reference.json`** and rerun `npm run build` then `python3 setup/install.py reference`:
- `targets`: completion, exception, system exception and cost-per-item targets, with spoke or process overrides. These drive Alerts and the target chips.
- `processes[].slaHours` for each process (default `slaHoursDefault`: 24).
- `financeTargets`: annual net benefit targets (`spokeId: "ESTATE"` for the estate). Target columns stay hidden until these exist.
- `releases`: changes you want marked on the charts.

## Step 4. Stage 1: Logstash (the Logstash developer)

Read `docs/DATA-CONTRACT.md` first; it is the specification. Then:

1. Copy `etl/logstash/ia-enrich.rb` and `etl/reference/reference.json` to the Logstash host (`/etc/logstash/ia/`).
2. In `ia-enrich.rb`, set `SOURCE_FIELDS` to where your Blue Prism index keeps each field, and `WORKTIME_DIVISOR` if worktime is in milliseconds.
3. Copy `etl/logstash/ia-workqueue.conf`, fill in the `<placeholders>`, and start the pipeline.
4. **Check in Discover** (data view `ia-workqueue-items*`, created by step 6, or query the index in Dev Tools):
   - documents arrive, with `outcome`, `process.name`, `spoke.name`, `value.benefit_gbp` and `item.sla_due_at` filled in;
   - `mapped: false` is rare: every unmapped queue is a missing `queueMap` row;
   - a pending item becomes Completed **in place** when it finishes (same `_id`, T11), not a second document;
   - times are UTC (T1): compare a few items with Control Room.

The Ruby filter is tested against the reference implementation on 20,000 items (`npm run test:etl`), so if a number disagrees with the React app, check the field mapping before the logic.

## Step 5. Stage 2: the cost job

```bash
pip install requests
python3 etl/cost-job/stamp_costs.py --reference etl/reference/reference.json --dry-run   # look first
python3 etl/cost-job/stamp_costs.py --reference etl/reference/reference.json             # first run backfills every uncosted day
```

Then schedule it daily (`setup/crontab.example`). Without it, every £ figure shows £0 and Value & Finance is empty.

## Step 6. Import the dashboards

```bash
python3 setup/install.py dashboards verify
```

`verify` prints what the dashboards depend on: item count and latest item, mapped versus unmapped, stamped cost, SLA times, the other indices, and the nine dashboards. Anything marked `FAIL` names the step to revisit.

If the import rejects `controlGroupInput` (control formats changed across 8.x), rebuild without controls and add them by hand (step 7):

```bash
KIBANA_VERSION=8.x.y NO_CONTROLS=1 npm run build && python3 setup/install.py dashboards
```

## Step 7. Settings in Kibana (once, about 15 minutes)

1. **Light theme**: Stack Management > Advanced Settings > Dark mode off. The panels are designed for it.
2. **Controls**, only if you used `NO_CONTROLS`: on one dashboard, Edit > Controls > Add options list for `spoke.name`, `proposition.name`, `process.name`, `queue.name` and `process.tags`, titled Spoke, Proposition, Process, Queue and Tags. Save, then copy them to the other dashboards.
3. **Links panel (8.12+)**: replace the markdown navigation strip at the top of each dashboard with a Links panel to the nine dashboards, ticking "Use filters and query from origin dashboard" and "Use date range". This is what carries a clicked process through to Process detail. One saved Links panel can go on every dashboard.
4. **Home page**: set `ia-service` (run team) or `ia-overview` as the default route for the space.
5. **Full screen** (the icon top right) gives every panel about 150px more height. Worth telling people.

## Step 8. Service checks and alerts

1. Schedule `etl/service-job/service_checks.py` every 15 minutes (`setup/crontab.example`). Run it once by hand with `--dry-run` first; it prints each check.
2. Create a Teams (or email) connector in Stack Management > Connectors and note its id.
3. Create the rules:

```bash
python3 etl/service-job/create_rules.py --dry-run                                  # see the four rules
python3 etl/service-job/create_rules.py --connector <id> --connector-type teams    # create or update them
```

4. **Prove an alert end to end**: temporarily set `SERVICE.freshnessMin.act` to 1 in `vega/lib/service.mjs`, rebuild, run the job, and watch the Teams message arrive. Put it back. Details in `docs/SERVICE.md`.

## Step 9. PDF sharing

Share > PDF reports on any dashboard. Tick "Optimize for printing" for A4 pages. To email one on a schedule on 8.x, use a watch with a `reporting` attachment (see docs/KIBANA-SETUP.md section 4).

## Step 10. First-load test: what to look at

Open each dashboard on a 90-day window. A panel with a red error box is the thing to report; for anything else, compare against this list.

| Dashboard | It works when | If not, first look at |
|---|---|---|
| Service | Board shows nine checks with a status and "Checked HH:MM"; Last 24 hours fills in after the job has run a while | No check history: step 8.1. Everything "Out of hours": service hours are UTC 07:00 to 19:00 (`vega/lib/service.mjs`) |
| Process detail | Tiles to choose a process; click one and the page fills | Click does nothing: the data view title must be `ia-workqueue-items*` |
| Overview | Six tiles with deltas, item flow with ◆ release markers, watchlist | Blank: no mapped items in the window (step 4) |
| Process Analysis | Missed SLA bars, SLA trend, league table | Missed SLA all 0%: `item.sla_due_at` / `n.in_sla` missing (T14) |
| Exceptions | Heatmap of process × reason, trend, work handed back | Few columns: exception classification (T5) needs patterns in reference.json |
| VDI & Capacity | Every VDI with utilisation; "Room for more work" | No VDIs: `resources` names must match Blue Prism's resource names |
| Alerts | Rows per process ranked by £ at stake | Everything breaching: targets need calibrating (step 3) |
| Executive Summary | FYTD figures, health line, by hub, briefing | £0 everywhere: cost job (step 5) |
| Value & Finance | Waterfall reconciles gross, teams, machines and net | Unattributed memo large: VDI days with no work, worth a look |

Also check each one with **one spoke selected** in the Spoke control and with **a 12-month window**.

**Reporting a problem** (so it can be fixed in one go): the dashboard and panel name, a screenshot, and for a panel error the panel's Inspect > Requests (the query Kibana actually sent and what came back). Most first-load issues are listed in docs/KIBANA-SETUP.md section 8.

## Changing things later

| To change | Edit | Then |
|---|---|---|
| A panel's layout, wording or measure | `vega/panels/<dashboard>.mjs` | `npm run build`, `npm test`, `npm run preview` to look, `python3 setup/install.py dashboards` |
| Colours, fonts | `vega/lib/tokens.mjs` | same |
| Targets, SLAs, releases, processes, rates | `etl/reference/reference.json` | `npm run build`, `python3 setup/install.py reference`, copy the file to the Logstash host; re-run the cost job over affected days if rates or costs changed |
| Service thresholds | `vega/lib/service.mjs` (`SERVICE`) | `npm run build`, redeploy `etl/service-job/service-checks.json` with the job, re-import dashboards |
| Alert messages or channels | `etl/service-job/create_rules.py` | re-run it (it updates in place) |

Never edit a panel inside Kibana's Vega editor: the next import overwrites it. Edit the source, rebuild, re-import.

## Route A in detail: the mock data

```bash
npm ci && npm run mock && npm run mock:service      # about 3 minutes; writes mock/
KIBANA_VERSION=<yours> npm run build
IA_KIBANA_SPACE=ia-demo python3 setup/install.py templates reference dashboards
python3 setup/install.py mock verify                # loads about 360 MB, so allow a while
```

Use a test cluster or at least a separate space, and set the time picker to end on **14 July 2026**, where the mock data ends (Service: 15:00 that day). The previews in `previews/` show what each page should look like at that moment. Delete the mock indices before loading real data (`DELETE ia-workqueue-items,ia-cost-daily,ia-vdi-daily,ia-service-checks`).
