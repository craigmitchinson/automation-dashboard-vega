# Data requirements: what we need from Logstash

This is the checklist for the people building the data feed. It says exactly what to read, what to write, and in what order, so the dashboards come to life a stage at a time. The detailed rules live in [LOGSTASH.md](LOGSTASH.md), [JOBS.md](JOBS.md) and [FORMULAS.md](FORMULAS.md); this page is the plan.

## The ask in one paragraph

Read the Blue Prism work-queue items that are **already in Elastic** (16 existing columns, read only). For each item, write one document to a **new** index, `ia-workqueue-items`, carrying about 75 **new** fields. The supplied Logstash filter (`logstash/ia-enrich.rb`) already calculates every one of them: you wire it up, tell it your column names, and check its output stage by stage. Then run two supplied **scheduled Logstash pipelines** that add cost. Nothing else is needed: no Python, no cron, no other servers. Nothing is ever written back to the Blue Prism index.

## What "existing" and "new" mean here

| Label | Meaning | What you do |
|---|---|---|
| **Existing** | A column already in your Blue Prism index | Read it. Never change it. |
| **New: copied** | A new field in `ia-workqueue-items` holding an existing column's value under a new name | The filter copies it. Check it matches. |
| **New: looked up** | A new field whose value comes from the reference data (`reference.json`), found using an existing column | The filter looks it up. Check the reference row exists. |
| **New: calculated** | A new field the filter works out from other fields | The filter calculates it. Check a few by hand. |
| **New: cost** | A new field written later by the daily cost pipelines | The cost pipelines write it. |

Every field name below that starts `item.`, `queue.`, `process.`, `value.`, `n.` and so on is **new**. None of them exists in Blue Prism.

## Terms

| Term | Meaning |
|---|---|
| Item | One Blue Prism work-queue item: one piece of work a bot picks up. |
| Case | One customer request. Usually one item; a multi-stage process makes one item per stage. |
| Outcome | Completed, Exception (failed, handed back) or Pending (not finished). |
| Business / system exception | Business: the case itself could not be processed, so a colleague takes it. System: the bot or a target system failed. |
| Process, proposition, spoke, hub | A process is one automation. Propositions are product lines, spokes the business areas, the hub the central automation team. |
| SMV | Standard minute value: minutes a colleague would take to do the item by hand. |
| Onshore / offshore | Where the colleagues who would otherwise do the work sit. Each process has an offshore share (0 to 1). |
| FTE | Full-time equivalent: hours saved expressed as full-time colleagues. Worked out separately for onshore and offshore. |
| Mapped | The item's queue is in the reference data. Unmapped items are left out of every figure. |

## The stages, easiest first

Each stage lists what it needs, the new fields it turns on, how to check it, and what appears on the dashboards. The filter runs all its steps at once; the stages are the order in which to **supply reference data and check output**, so problems are found one at a time.

| Stage | Name | Needs from the business | Effort | Dashboards it unlocks |
|---|---|---|---|---|
| 0 | Set up | Nothing | Low | None yet |
| 1 | Copy and parse | Nothing | Low | None yet (check in Discover) |
| 2 | Map queues and workers | Queue list, VDI list | Low | Counts and rates on most pages |
| 3 | Sort exceptions | Exception patterns | Low | Exceptions page, business/system split |
| 4 | Time and SLA | SLA hours per process | Medium | SLA, turnaround, waiting by age, past-SLA |
| 5 | Value, onshore and offshore | SMV, grades, rates, offshore shares | Medium | Benefit, hours saved, rework |
| 6 | Multi-stage cases | Stage order and shares | Medium | Cases completed, correct benefit for staged processes |
| 7 | Cost pipelines | Team costs, VDI costs, FTE assumptions | High | Every £ cost, net, ROI, FTE, utilisation, the Money pages |
| 8 | Alerts | Connector (Teams or email) | Low (Kibana owner) | Notifications for five checks |

### Stage 0: Set up

| Do this | Done when |
|---|---|
| In Kibana Dev Tools, paste `kibana/devtools-setup.txt` (creates the new indices and loads reference data). Import `kibana/ia-dashboards.ndjson`. See [KIBANA.md](KIBANA.md). | `GET _cat/indices/ia-*` lists the four `ia-` indices |
| Copy `logstash/` to the Logstash host (`/etc/logstash/ia/`). | Files in place |
| Create one API key: cluster `monitor`; read on the Blue Prism index; read and write on `ia-*`. | Key works from the Logstash host |
| Fill in the right-hand column below and copy it into `SOURCE_FIELDS` at the top of `ia-enrich.rb`. | Table complete |

**The 16 existing Blue Prism columns** (from `BPAWorkQueueItem`). Read only.

| Blue Prism column | Your field name in Elastic | Type | Check |
|---|---|---|---|
| ID | | keyword | Unique per item |
| KeyValue | | keyword | |
| QueueName | | keyword | Every live queue must be in `queueMap` (stage 2) |
| Resource | | keyword | Every VDI must be in `resources` (stage 2) |
| Status | | keyword | Copied for display only; never decides the outcome |
| Tags | | keyword | |
| Priority | | integer | |
| Attempt | | integer | Blank is read as 1 |
| LoadedDate | | date | UTC (see open questions) |
| LastUpdatedDate | | date | Used to poll for changes |
| CompletedDate | | date | |
| ExceptionDate | | date | |
| ExceptionReason | | text | |
| LockedDate | | date | Null once released |
| DeferredDate | | date | |
| Worktime | | number | Seconds. If milliseconds, set `WORKTIME_DIVISOR = 1000` |

### Stage 1: Copy and parse (no reference data)

Start `logstash/ia-workqueue.conf`. It polls every 15 minutes and writes one document per item with `_id` = ID, updating it in place as the item moves from Pending to Completed or Exception.

| New field | Kind | Type | Rule (step) |
|---|---|---|---|
| `item.id`, `item.key_value`, `item.status`, `item.tags`, `item.priority`, `item.attempt` | copied | keyword, integer | From ID, KeyValue, Status, Tags, Priority, Attempt |
| `queue.name`, `resource.name` | copied | keyword | From QueueName, Resource |
| `item.loaded_at`, `completed_at`, `exception_at`, `locked_at`, `deferred_at`, `last_updated_at` | copied | date | Dates parsed as UTC; blank becomes null (T1, T12) |
| `outcome` | calculated | keyword | Completed if CompletedDate, else Exception if ExceptionDate, else Pending (T2) |
| `@timestamp`, `outcome_date` | calculated | date | Outcome time: CompletedDate, else ExceptionDate, else LoadedDate; and its UTC day (T3) |
| `outcome_hour`, `outcome_weekday` | calculated | byte | UTC hour 0 to 23; weekday 1 (Mon) to 7 (T16) |
| `worktime_sec`, `worktime_completed_sec` | calculated | long | Worktime in seconds; and again for completed items only (T9) |
| `n.completed`, `n.exception`, `n.pending`, `n.attempt` | calculated | integer | 0 or 1 flags; attempt = completed + exception (T9) |
| `n.first`, `n.first_ok` | calculated | integer | First attempt (Attempt 1); and first attempt that completed (T15) |

**Done when** Discover (data view `ia-workqueue-items*`) shows items arriving; a pending item becomes Completed in place, not a second document; a few outcome times match Control Room.

### Stage 2: Map queues and workers

Supply `queueMap` (every live queue name to a process) and `resources` (every VDI) in `reference.json`.

| New field | Kind | Type | Rule (step) |
|---|---|---|---|
| `mapped` | looked up | boolean | False when the queue is not in `queueMap` (T4) |
| `process.id`, `process.name`, `process.acronym`, `process.tags`, `process.grade`, `process.grade_name`, `process.smv_minutes` | looked up | keyword, double | From the queue's process (T4) |
| `proposition.name`, `spoke.id`, `spoke.name`, `spoke.short` | looked up | keyword | From the process's proposition and spoke (T4) |
| `queue.stage`, `queue.stage_order` | looked up | keyword, integer | Stage of a multi-stage process (T4) |
| `resource.bot`, `resource.owner_spoke` | looked up | keyword | The VDI's bot and owning spoke, else Hub (T10) |

**Done when** `mapped: false` is rare (each one is a queue missing from `queueMap`).

**Unlocks** item counts, completion and exception rates, bot runtime and throughput on Overview, Work in and out, Process Analysis, Process detail and Service; active hours on VDI and Capacity.

### Stage 3: Sort exceptions

Supply `exceptionPatterns` (text that marks a reason as system or business) and optional `exceptionDisplayCodes`.

| New field | Kind | Type | Rule (step) |
|---|---|---|---|
| `exception.type` | calculated | keyword | Trust a "Business Exception" or "System Exception" prefix; else the first matching pattern; else Business (T5) |
| `exception.reason`, `exception.reason_display`, `exception.code` | calculated | keyword | Prefix stripped; blank becomes "(no reason recorded)"; short code (T6) |
| `n.business`, `n.system` | calculated | integer | 0/1 by exception type (T9) |

**Done when** the Exceptions heatmap shows a sensible spread of reasons, not one "Business" column.

**Unlocks** the Exceptions page and the business/system split everywhere; Alerts rates.

### Stage 4: Time and SLA

Supply `slaHours` per process (otherwise every process gets the default, 24 hours).

| New field | Kind | Type | Rule (step) |
|---|---|---|---|
| `turnaround_sec` | calculated | long | Outcome time minus loaded time, for finished items (T14) |
| `item.sla_due_at` | calculated | date | Loaded time plus the process's SLA hours (T14) |
| `n.in_sla` | calculated | integer | 1 if completed by its SLA due time (T14) |

**Unlocks** within SLA, turnaround and first-time success on Process Analysis; waiting by age on Work in and out; past-SLA on Service.

### Stage 5: Value, onshore and offshore

Supply per process: SMV, grade and `offshoreShare` (0 = all onshore, default). Supply `gradeRates` (hourly cost per grade, dated; rows may carry `location: "Offshore"`; offshore falls back to the onshore rate).

| New field | Kind | Type | Rule (step) |
|---|---|---|---|
| `value.hourly_rate_gbp`, `value.hourly_rate_offshore_gbp` | looked up | double | Rate in force on the outcome date, onshore and offshore (T7, T17) |
| `value.hours_saved`, `value.benefit_gbp` | calculated | double | Completed: SMV ÷ 60 hours, priced at the rate (T8) |
| `value.rework_hours`, `value.rework_gbp` | calculated | double | Exception: SMV ÷ 60 hours handed back, priced at the rate (T8, T15) |
| `value.hours_saved_onshore` / `_offshore`, `value.benefit_onshore_gbp` / `_offshore_gbp` | calculated | double | Split by the offshore share; each part priced at its own rate; parts add up to the total (T17) |
| `value.rework_hours_onshore` / `_offshore`, `value.rework_onshore_gbp` / `_offshore_gbp` | calculated | double | Same split for work handed back (T17) |

**Done when** summing `value.benefit_gbp` for a month gives a believable figure, and onshore plus offshore equals the total on any item.

**Unlocks** benefit, colleague hours saved and handed back (onshore and offshore), rework exposure. FTE also needs stage 7.

### Stage 6: Multi-stage cases

For a process that runs as several queues in sequence, supply `stageOrder` on each queue and, optionally, `stageShare` (fractions adding up to 1).

| New field | Kind | Type | Rule (step) |
|---|---|---|---|
| `n.case_done` | calculated | integer | 1 on a completed final-stage item (every completed item for single-stage processes) (T13) |
| benefit fields above | calculated | double | A case earns its SMV once, split across stages by share, else at the final stage (T13) |

**Unlocks** cases completed, cost per case, and correct (not multiplied) benefit for staged processes.

### Stage 7: Cost pipelines (hardest)

Two scheduled Logstash pipelines, supplied, no other software. See [JOBS.md](JOBS.md).

| Pipeline | When | Reads | Writes |
|---|---|---|---|
| `ia-cost-daily.conf` | Daily, 01:30 UTC | Worktime totals per day and spoke from `ia-workqueue-items` | `ia-cost-daily` (one document per day per cost pool) and `ia-vdi-daily` (one per VDI per day) |
| `ia-cost-stamp.conf` | Daily, 02:00 UTC | Items from the last 14 whole days, and any not yet costed | The item's `cost.*` fields only |

Supply `peopleCostHistory` (annual team cost for the hub and each spoke), VDI costs and dates in `resources` and `vdiCostHistory`, and FTE assumptions in `estateCostHistory` (working days a year and productive hours a day, optionally separate for offshore).

| New field | Index | Kind | Rule |
|---|---|---|---|
| `cost.hub_people_gbp`, `cost.hub_infra_gbp`, `cost.spoke_people_gbp`, `cost.spoke_infra_gbp`, `cost.people_gbp`, `cost.infra_gbp`, `cost.estate_gbp`, `cost.stamped_at` | `ia-workqueue-items` | cost | The day's hub and own-spoke team and machine costs, shared across that day's items by worktime |
| `people_gbp`, `infra_gbp`, `total_gbp`, `worktime_sec`, `cost_per_bot_sec`, `working_days_per_year` (+ `_offshore`), `productive_hours_per_day` (+ `_offshore`) and others | `ia-cost-daily` | cost | One document per day per pool |
| `daily_cost_gbp`, `operating_hours`, `available` and others | `ia-vdi-daily` | cost | One document per VDI per day |

**Done when** a day's `cost.estate_gbp` summed over its items equals that day's pool totals; Value and Finance shows a waterfall from gross to net.

**Unlocks** every £ cost, net benefit, ROI, cost per item, FTE (onshore and offshore), licensed hours and utilisation, the Executive Summary and Value and Finance.

### Stage 8: Alerts (Kibana owner)

The import includes five Kibana rules (data arriving, cost up to date, all queues mapped, nothing past SLA, nothing stuck on a lock). They arrive disabled: attach a connector and enable them. The other four run-team checks show on the Service dashboard only. See [JOBS.md](JOBS.md).

## Which pages need which stage

✓ = the page needs that stage to be complete.

| Page | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Service | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| Process detail | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Overview | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Work in and out | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Process Analysis | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Exceptions | ✓ | ✓ | ✓ | | ✓ | | |
| VDI and Capacity | ✓ | ✓ | | | | | ✓ |
| Alerts | ✓ | ✓ | ✓ | | ✓ | | ✓ |
| Executive Summary | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |
| Value and Finance | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |

Pages show partial figures before all their stages are complete: counts and rates appear from stage 2, £ figures read zero until stage 7.

## Reference data: who supplies what

`logstash/reference.json` holds demonstration values today. Every £, FTE, SLA and target figure is only as real as this file.

| Item | Stage | Supplied by |
|---|---|---|
| `queueMap`, `spokes`, `propositions` | 2 | Automation team |
| `resources` (VDI names, owners, dates) | 2, 7 | Platform team |
| `exceptionPatterns`, `exceptionDisplayCodes` | 3 | Automation team |
| `processes`: `slaHours` | 4 | Process owners |
| `processes`: SMV, grade, `offshoreShare` | 5 | Process owners |
| `gradeRates` (onshore and offshore) | 5 | Finance |
| `queueMap` stage order and shares | 6 | Automation team |
| `peopleCostHistory`, `vdiCostHistory` | 7 | Finance |
| `estateCostHistory` (FTE assumptions, onshore and offshore) | 7 | Finance |
| `targets`, `financeTargets`, `releases` | dashboards | Automation lead, Finance |

## Open questions

Each needs an answer before the stage named.

**Blue Prism data (stage 0 to 1)**

1. What is the Blue Prism index name, and what are the 16 field names in it?
2. Are dates stored in UTC or local time? If local, summer items land an hour out until a timezone conversion is added.
3. Is Worktime in seconds or milliseconds?
4. Does the index hold one document per item or one per change, and is LastUpdatedDate reliable for picking up changes?
5. Does ExceptionReason start with "Business Exception" or "System Exception"? If not, stage 3 relies entirely on the patterns.

**Logstash platform (stage 0 and 7)**

6. Which Logstash version is in use, and may we install a Ruby filter script and a reference file on its host?
7. Does its Elasticsearch input plugin support `response_type => "aggregations"`? If not, the cost pipeline uses the supplied `http_poller` variant.
8. Is the Elasticsearch filter plugin (`logstash-filter-elasticsearch`) available? The cost stamp needs it.
9. Will the API key above be approved (cluster `monitor`, read on Blue Prism, read and write on `ia-*`)?
10. Who restarts or backfills the cost pipelines when reference costs change?

**Kibana (stage 0 and 8)**

11. Which Kibana version? The import is built for 8.15 and can be rebuilt for an older one.
12. Will Kibana accept the alert rules in the import, or should they be created by hand from the table in JOBS.md?
13. Which connector should alerts use (Teams, email, other), and should "data arriving" alert only during service hours (07:00 to 19:00 UTC)?
14. Is one alert level per rule enough, or do you want separate warning and action notifications?
15. Should each hub see only its own data (document-level security on `spoke.name`)?

**Business rules (stage 4 to 7)**

16. Who supplies the real reference data, and by when?
17. Onshore and offshore: is a fixed offshore share per process right, or does it vary by team or over time? What are the offshore grade rates and FTE assumptions?
18. Which processes run in stages, and how should their benefit be shared across stages?
19. Is the fiscal year start (April) and the service day (07:00 to 19:00 UTC) correct?
20. Is it acceptable that four checks (workers running, processes as usual, system exceptions normal, new exception reasons) show on the dashboard but do not send alerts?

**Go-live**

21. Nothing has yet run against the real Kibana and Logstash. Who will do the first load, and when? Expect one round of fixes.
22. On that first load, please confirm three plugin behaviours we could only check against documentation: the shape of the aggregation response from the Elasticsearch input, the cost stamp's scripted update (`params.event`), and environment-variable substitution inside the pipelines' query strings.
