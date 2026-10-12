# Intelligent Automation dashboards for Kibana

Nine Kibana 8 dashboards, built from Vega panels, over the Blue Prism work-queue data already in Elastic. Logstash adds the calculated fields (outcome, process, spoke, benefit, SLA) and a daily job adds cost.

![Overview](previews/pages/03-overview.png)

## Building it

| Part | Who | What | Guide |
|---|---|---|---|
| 1 | Dashboard owner | Paste one file into Dev Tools, import one file, three settings. About 30 minutes, all in Kibana. | [docs/KIBANA.md](docs/KIBANA.md) |
| 2 | Logstash developer | Map the Blue Prism field names and run the enrichment pipeline | [docs/LOGSTASH.md](docs/LOGSTASH.md) |
| 3 | Logstash developer | Schedule the daily cost job; optionally the service checks for alerts | [docs/JOBS.md](docs/JOBS.md) |

Every measure on every panel is defined in [docs/FORMULAS.md](docs/FORMULAS.md). Every dashboard and visual is pictured in [previews](previews/README.md).

## Files

| Folder | Contents |
|---|---|
| `kibana/` | `devtools-setup.txt` (index templates and reference data), `ia-dashboards.ndjson` (data view, panels, dashboards) and `panels/` (each panel's Vega, only for building one by hand) |
| `logstash/` | `ia-workqueue.conf`, the `ia-enrich.rb` filter, and `reference.json` (processes, queues, rates, targets, SLAs) |
| `jobs/` | `stamp_costs.py` (daily cost), `service_checks.py` and `create_rules.py` (optional alerts), `crontab.example` |
| `docs/` | The three guides and the formulas |
| `previews/` | An image of every dashboard and every visual |

## Dashboards

| Group | Dashboard | Shows |
|---|---|---|
| Run | [Service](previews/pages/01-service.png) | Nine run-team checks (OK, Warning, Action), what to do now, check history, activity against usual, workers, queues against SLA |
| Run | [Process detail](previews/pages/02-process-detail-one-process.png) | One process: KPIs, flow, top exceptions, workers, profile |
| Manage | [Overview](previews/pages/03-overview.png) | KPIs, item flow with release markers, watchlist, throughput, outcome mix |
| Manage | [Process Analysis](previews/pages/04-process-analysis.png) | SLA, turnaround, first-time success, runtime and exception rate by process; league table |
| Manage | [Exceptions](previews/pages/05-exceptions.png) | Process by reason heatmap, trend, work handed back to colleagues, detail |
| Manage | [VDI & Capacity](previews/pages/06-capacity.png) | Utilisation by worker, room for more work |
| Manage | [Alerts](previews/pages/07-alerts.png) | Performance against target, ranked by money at stake |
| Money | [Executive Summary](previews/pages/08-exec.png) | Fiscal year to date: net benefit, health, by hub, movers, briefing |
| Money | [Value & Finance](previews/pages/09-value-finance.png) | Waterfall, monthly trend, cost per item, spoke P&L, value league, review candidates |

## Status

The figures reproduce the React automation dashboard's to the penny on the same data, except that a multi-stage process now earns its benefit once per case rather than once per stage. The dashboards have been rendered against an emulation of Elasticsearch and Kibana but not yet loaded into a real Kibana, so expect one round of first-load fixes; [docs/KIBANA.md](docs/KIBANA.md) lists the likely ones.

Everything here is generated from the `source` branch. Changes to panels, thresholds or reference data are made there and republished, never by editing these files in place.
