# Intelligent Automation: performance dashboards for Kibana

This is the [automation-dashboard](https://github.com/craigmitchinson/automation-dashboard) React app rebuilt as nine Kibana dashboards made of Vega panels. It runs on the Elastic estate that already holds the Blue Prism work-queue data, so there's nothing extra to host. It keeps the React app's measures and rules, adds service checks, SLA and turnaround, and takes its colours and type from the Platform Health report (`vega/lib/tokens.mjs`). Against the same mock data every figure matches the React app to the penny, with one deliberate exception: a multi-stage process now earns its benefit once per case, not once per stage (docs/DATA-CONTRACT.md T13).

![Overview](previews/pages/03-overview.png)

Every page and every visual: [previews](previews/README.md).

## What's here

| Path | What it is |
|---|---|
| `dist/kibana/ia-dashboards.ndjson` | **One import** that creates the data view, 46 panels and 9 dashboards (docs/KIBANA-SETUP.md) |
| `dist/specs/<dashboard>/<panel>.vg.json` | Each panel's Vega spec, paste-ready |
| `docs/DATA-CONTRACT.md` | **The brief for the Logstash developer**: indices, fields and every transformation |
| `docs/FORMULAS.md` | Every measure on every panel, with the React source it came from |
| `docs/SERVICE.md` | The run team's checks, the job that runs them and the alert rules |
| `docs/KIBANA-SETUP.md` | Import, settings, how the Kibana behaviour differs, alerting rules, changing a panel |
| `previews/` | `pages/` has a PNG of every dashboard, `visuals/` a PNG of every visual (named page then position), `svg/` the SVGs; rendered from the specs against mock data |
| `etl/logstash/` | Logstash pipeline and Ruby filter for stage 1 (per-item enrichment) |
| `etl/cost-job/stamp_costs.py` | Stage 2: the scheduled daily cost job |
| `etl/service-job/` | Service checks every 15 minutes (`service_checks.py`) and the Kibana alert rules (`create_rules.py`) |
| `etl/reference-impl/` | Executable reference for both stages, plus the mock data generator |
| `etl/index-templates/` | Mappings for the five indices |
| `etl/reference/reference.json` | Team-owned reference data (same file as the React app) |
| `vega/` | Spec sources: `lib/` is the design kit (tokens, formats, cards, charts, tables, alert engine); `panels/` has one file per dashboard |
| `preview/` | Renders every spec against the mock data: a small Elasticsearch emulator runs each panel's real query |

## Dashboards

Nine dashboards, grouped in the navigation by who uses them.

| Group | Dashboard | Panels | Preview |
|---|---|---|---|
| Run | Service | Nine run-team checks (OK, Warning, Action), what to do now, 24-hour check history, hourly activity against usual, workers, queues against SLA, exceptions. Alerts come from the same checks (docs/SERVICE.md). | [service](previews/pages/01-service.png) |
| Run | Process detail | Chooser, or banner, KPIs, flow with release markers, top exceptions, workers and profile | [chooser](previews/pages/02-process-detail.png) · [one process](previews/pages/02-process-detail-one-process.png) |
| Manage | Overview | KPIs (items and cases), item flow (daily, 7-day, monthly) with release markers, watchlist, throughput, outcome mix | [overview](previews/pages/03-overview.png) |
| Manage | Process Analysis | Within SLA, turnaround, first-time success, runtime, throughput and exception rate by process; SLA trend; league table | [process-analysis](previews/pages/04-process-analysis.png) |
| Manage | Exceptions | KPIs, process × reason heatmap, trend, work handed back to colleagues, searchable detail | [exceptions](previews/pages/05-exceptions.png) |
| Manage | VDI & Capacity | KPIs incl. room for more work in items, utilisation by worker, capacity table | [all](previews/pages/06-capacity.png) · [one spoke](previews/pages/06-capacity-one-spoke.png) |
| Manage | Alerts | Performance against target, trailing 7 days, one row per process or spoke, ranked by money at stake | [estate](previews/pages/07-alerts.png) · [one spoke](previews/pages/07-alerts-one-spoke.png) |
| Money | Executive Summary | FYTD KPIs, operations, estate health (processes below target, £ at stake), by hub or proposition, movers, briefing | [estate](previews/pages/08-exec.png) · [hub](previews/pages/08-exec-one-spoke.png) |
| Money | Value & Finance | KPIs, FY attainment, waterfall, monthly trend, cost per item and cumulative benefit with forecasts, spoke P&L, Pareto, review candidates | [value-finance](previews/pages/09-value-finance.png) |

Retired from the React app's set: Input & Outcome (its flow is Overview's item flow) and Commercial Performance (its KPIs repeated Value & Finance; its two charts moved there; its what-if slider could only move its own panel in Kibana).

## How it works

```
Blue Prism items in Elastic ─► Logstash (enrich) ─► ia-workqueue-items ─┐
reference.json ─────────────► cost job (daily) ─► ia-cost-daily        ├─► Vega panels in Kibana
                             └► reference loader ─► ia-vdi-daily       │   (aggregations only; ES
                                                    ia-reference ───────┘    does the arithmetic)
```

The ETL puts every per-item figure on the document: outcome, process, spoke, grade-rate benefit and stamped apportioned cost. Every panel then asks Elasticsearch for sums and receives a few hundred rows at most, which keeps them fast. The panels follow the dashboard's controls, query bar and time picker. Clicking a process filters the whole dashboard.

## Commands

```bash
npm install
npm run mock      # mock CSV -> the four indices as _bulk NDJSON in mock/ (≈10 s)
npm run build     # panels -> dist/specs + dist/kibana/ia-dashboards.ndjson
npm test          # every spec parses; ETL reproduces the React totals
npm run test:etl  # Ruby filter and Python cost job agree with the reference implementation
npm run mock:service  # run the service check job against the mock for 24 hours (≈2 min)
npm run preview   # run every query against mock/, render previews/ (pages, visuals, svg)
```

The preview needs Python with Playwright and Pillow. The ETL test needs Ruby.

## Status and limits

- **Proven:** the numbers (ETL reference = React app to the penny, apart from T13, which is reconciled exactly; Ruby and Python twins match it), that every spec renders, and the queries (run through an emulator of the Elasticsearch subset they use, under Kibana's context substitution rules).
- **Service checks:** the dashboard and the alerting job agree on every check at seven moments in the mock data (tests/service.test.mjs), and the job has run end to end against an emulated cluster.
- **Not yet run in a real Kibana:** the import file, the `%context%` and `%timefilter%` handling, `kibanaAddFilter`, the controls and the alert rules API. Expect one round of fixes on first load. docs/KIBANA-SETUP.md section 8 lists the likely ones.
- **Behaviour that doesn't carry over from the React app:** acknowledge and snooze (use alerting rules), saved views, admin editing, the accessibility panel, scrolling inside a panel, and a what-if slider that changes every page. docs/KIBANA-SETUP.md section 5 has the full mapping.
