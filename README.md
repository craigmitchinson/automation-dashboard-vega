# Intelligent Automation dashboards for Kibana

Ten Kibana 8 dashboards, built from Vega panels, over the Blue Prism work-queue data already in Elastic. Logstash adds the calculated fields (outcome, process, spoke, benefit, SLA) and two scheduled Logstash pipelines add cost.

![Overview](previews/pages/03-overview.png)

## Building it

Start with [docs/DATA-REQUIREMENTS.md](docs/DATA-REQUIREMENTS.md): what the build needs, field by field, in stages from easiest to hardest, with the open questions.

| Part | Who | What | Guide |
|---|---|---|---|
| 1 | Dashboard owner | Paste one file into Dev Tools, import one file, three settings. About 30 minutes, all in Kibana. | [docs/KIBANA.md](docs/KIBANA.md) |
| 2 | Logstash developer | Map the Blue Prism field names and run the enrichment pipeline | [docs/LOGSTASH.md](docs/LOGSTASH.md) |
| 3 | Logstash developer and dashboard owner | Schedule the daily cost pipelines; attach a connector to the five Kibana alert rules | [docs/JOBS.md](docs/JOBS.md) |

Every measure on every panel is defined in [docs/FORMULAS.md](docs/FORMULAS.md). Every dashboard and visual is pictured in [previews](previews/README.md).

## Files

| Folder | Contents |
|---|---|
| `kibana/` | `devtools-setup.txt` (index templates and reference data), `ia-dashboards.ndjson` (data view, panels, dashboards, five alert rules) `panels/` (each panel's Vega, only for building one by hand), and `mock/` (the same with demonstration data built in, to view before any data or access exists) |
| `logstash/` | `ia-workqueue.conf` with the `ia-enrich.rb` filter (items), `ia-cost-daily.conf` and `ia-cost-stamp.conf` with the `ia-cost.rb` filter (daily cost), and `reference.json` (processes, queues, rates, targets, SLAs) |
| `docs/` | The data requirements, the three guides and the formulas |
| `previews/` | An image of every dashboard and every visual |

## Dashboards

| Group | Dashboard | Shows |
|---|---|---|
| Run | [Service](previews/pages/01-service.png) | A card per hub (work, outcome, waiting, cost, today by the hour against usual, status), nine run-team checks, what to do now, queues, workers, activity, exceptions |
| Run | [Process detail](previews/pages/02-process-detail-one-process.png) | One process: KPIs, flow, top exceptions, workers, profile |
| Manage | [Overview](previews/pages/03-overview.png) | KPIs, item flow, watchlist, hub scorecard against targets, what moved against the previous period, day-by-day exception calendar |
| Manage | [Work in & out](previews/pages/04-work-flow.png) | Work in against work out, waiting, cases, cost per item and per case; where the work went (process, stage, outcome); waiting by age; period-by-period table with FTE (onshore and offshore) |
| Manage | [Process Analysis](previews/pages/05-process-analysis.png) | KPIs against the previous period; SLA, turnaround, first-time success, runtime and exception rate by process; SLA trend; bot time per item, completed against exception; league table; bot time lost to exceptions |
| Manage | [Exceptions](previews/pages/06-exceptions.png) | Process by reason heatmap, trend, work handed back to colleagues, when exceptions happen, detail; filter by reason |
| Manage | [VDI & Capacity](previews/pages/07-capacity.png) | Utilisation over time, digital workers needed against licensed, the VDI capacity table, when the work runs, room for more work |
| Manage | [Alerts](previews/pages/08-alerts.png) | KPIs, hubs against each target, and the register ranked by money at stake |
| Money | [Executive Summary](previews/pages/09-exec.png) | Fiscal year to date: net benefit, health, by hub, movers, briefing |
| Money | [Value & Finance](previews/pages/10-value-finance.png) | Waterfall, monthly trend, cost per item, colleague time (FTE released and handed back, onshore and offshore), gross benefit by location, spoke P&L, value league, review candidates |

## Status

The figures reproduce the React automation dashboard's to the penny on the same data, except that a multi-stage process now earns its benefit once per case (split across its stages where reference data gives stage shares) rather than in full at every stage. The dashboards have been rendered against an emulation of Elasticsearch and Kibana but not yet loaded into a real Kibana, so expect one round of first-load fixes; [docs/KIBANA.md](docs/KIBANA.md) lists the likely ones.

Everything here is generated from the `source` branch. Changes to panels, thresholds or reference data are made there and republished, never by editing these files in place.
