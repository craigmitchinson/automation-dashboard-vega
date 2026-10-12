# Data contract: what the ETL must produce

This is the brief for whoever builds the Logstash side. The dashboards read four Elasticsearch indices. If the indices hold the fields below, calculated as described, every panel works without any change to the Vega specs.

You don't have to work from prose alone. Every rule here also exists as runnable code that reproduces the React dashboard's figures to the penny, and the Logstash and Python starters are tested against it:

| Rule set | Executable reference | Starter you would deploy | Test |
|---|---|---|---|
| Stage 1, per item | `etl/reference-impl/pipeline.mjs` `enrichItem()` | `etl/logstash/ia-enrich.rb` + `ia-workqueue.conf` | Ruby and JS give identical documents for 20,000 mock rows |
| Stage 2, per day | `etl/reference-impl/pipeline.mjs` `costDay()` | `etl/cost-job/stamp_costs.py` | Python matches every pool, VDI and stamped cost on the mock data |
| Reference index | `etl/reference-impl/pipeline.mjs` `referenceDocs()` | `etl/reference-impl/reference-ndjson.mjs` | |

`npm run mock` turns a Blue Prism work-queue CSV into all four indices as `_bulk` files, so you can load a dev cluster and see the dashboards working before writing any Logstash.

## 1. The shape

```
Blue Prism work-queue items          reference.json (team-owned)
(already landing in Elastic)                 │
          │                                  │
          ▼                                  ▼
  Stage 1: Logstash  ───────────────►  ia-workqueue-items   one doc per item, keyed by item ID
  (per item: outcome, process,                │
   spoke, benefit, exception type)            │ every item for a day
                                              ▼
  Stage 2: scheduled cost job ─────►  ia-cost-daily        one doc per day per cost pool
  (per day: pools, shares,            ia-vdi-daily         one doc per day per VDI
   cost stamped back onto items)      ia-workqueue-items   cost.* filled in
                                      
  reference loader ────────────────►  ia-reference         targets, finance targets, process catalogue
```

Why two stages: the per-item transformations can be done one record at a time, so they belong in Logstash. Cost cannot. An item's cost is its share of the day's pools, by bot worktime. That needs the day's total worktime first, which only exists once every item for that day has landed. A scheduled job handles it after ingest and re-runs for any day that gets a late or changed item.

Create the four index templates in `etl/index-templates/` before loading anything (`PUT _index_template/<name>` with each file). The items template uses `"dynamic": "strict"`, so a misspelt field fails loudly rather than appearing as a silent new field.

## 2. Inputs

**Work-queue items.** These are the 16 columns of a Blue Prism `BPAWorkQueueItem` export. Your Elastic copy will have its own field names, so map them once in `SOURCE_FIELDS` at the top of `ia-enrich.rb`:

`ID, KeyValue, Priority, Status, Tags, Resource, Attempt, LoadedDate, LastUpdatedDate, DeferredDate, LockedDate, CompletedDate, Worktime, ExceptionDate, ExceptionReason, QueueName`

Check these against the real source before trusting any number:

1. **Timezone.** All dates are treated as UTC. If Blue Prism logs local time (BST), summer rows land an hour out and can fall on the wrong day.
2. **Worktime units.** These must be whole seconds. If your Elastic copy holds milliseconds, set `WORKTIME_DIVISOR = 1000` in the Ruby.
3. **One item, one document.** The same item ID arrives more than once as it changes state. The pipeline writes with `document_id = item ID`, so the latest state replaces the earlier one.
4. **Queue names must match `queueMap`** in reference.json, or the item counts for resource activity only and is excluded from every process, spoke and £ figure (`mapped: false`).
5. **Resource names must match `resources`** in reference.json, or the item cannot be tied to a VDI's capacity and cost.

**Reference data.** This is `etl/reference/reference.json`: spokes, propositions, processes (SMV, grade and optional `slaHours`), the queue-to-process map, `slaHoursDefault`, `releases` (changes to mark on the charts), the dated grade rate card, VDIs with renewal and licence dates, VDI class rates, people costs, exception-classification patterns and targets. It is the same file the React app uses. The Logstash host and the cost job each need a copy. When it changes, reload `ia-reference` and re-run the cost job over the affected days.

## 3. Stage 1: per-item transformations (Logstash)

| # | Output field(s) | Rule |
|---|---|---|
| T1 | `item.*_at` | Parse every Blue Prism date as UTC. Blank or unparseable becomes null. `last_updated_at` falls back to completed, then exception, then locked, then loaded date. |
| T2 | `outcome` | `Completed` if CompletedDate is set, otherwise `Exception` if ExceptionDate is set, otherwise `Pending`. Never use the Status text. |
| T3 | `@timestamp`, `outcome_date` | The outcome timestamp is CompletedDate, else ExceptionDate, else LoadedDate. `outcome_date` is its UTC day. **Every dashboard buckets on this**, not on the loaded date. |
| T4 | `queue.*`, `process.*`, `proposition.name`, `spoke.*`, `mapped` | Look up QueueName in `queueMap`, then process, then proposition, then spoke. `mapped` is false when the queue is unknown. |
| T5 | `exception.type` | If the reason starts "Business Exception" or "System Exception" (any case), trust it. Otherwise use the first `exceptionPatterns` entry whose text (with `%` removed) appears in the reason, case-insensitive, ordered by priority descending and then pattern length descending. Otherwise use `Business`. |
| T6 | `exception.reason_display`, `exception.code` | Strip the "Business/System Exception:" prefix. Blank becomes "(no reason recorded)". The code comes from `exceptionDisplayCodes`, else the first letters of up to three words. |
| T7 | `value.hourly_rate_gbp` | The process grade's rate **in force on the outcome date**: the latest `gradeRates` row with `effectiveFrom <= outcome_date`. A row carrying the process's spokeId always beats a universal row. A pay award never re-values history. |
| T8 | `value.benefit_gbp`, `value.rework_gbp`, `value.hours_saved` | Completed items: benefit = SMV minutes × hourly rate / 60, and hours saved = SMV / 60. Exceptions: rework = the same SMV × rate / 60 (an upper bound, as in the React app). Everything else is 0. |
| T9 | `n.completed`, `n.exception`, `n.business`, `n.system`, `n.pending`, `n.attempt`, `worktime_sec`, `worktime_completed_sec` | 0/1 flags and worktime copies, so every count is a plain `sum` in Elasticsearch. `attempt` = completed + exception (pending items are not attempts). |
| T10 | `resource.owner_spoke` | The VDI's owning spoke name from `resources`, or `Hub` for a hub-owned machine. |
| | `cost` | Write null. Stage 2 fills it. |
| T11 | (whole document) | Re-read items that change, not just new ones: poll on `LastUpdated` and write with `_id` = item ID, so a pending item becomes Completed or Exception in place. Without this the Service dashboard sees every in-flight item as a growing backlog. |
| T12 | `item.locked_at` | Blue Prism `LockedDate`: set while a session holds the item, null once released. The Service "stuck on a lock" check counts pending items locked for over an hour. |
| T13 | `n.case_done`, benefit | A multi-stage process (queueMap rows sharing a processId with `stageOrder`) earns benefit and hours saved once per case, on completion at its **final** stage (highest `stageOrder`). Earlier stages still count as items, worktime and cost. `n.case_done` = 1 on a completed final-stage item (single-stage processes: every completed item). The React app earns benefit at every stage; on the mock data that is £369,759.87 of Pension Transfers benefit counted twice. |
| T14 | `turnaround_sec`, `item.sla_due_at`, `n.in_sla` | Turnaround = outcome time minus loaded time, in whole seconds, for completed and exception items (0 otherwise). SLA hours = the process's `slaHours`, else `slaHoursDefault` (24). `sla_due_at` = loaded + SLA hours (mapped items, every status, so the Service check can see waiting items approaching it). `n.in_sla` = 1 for a completed item whose turnaround is within SLA. |
| T15 | `n.first`, `n.first_ok`, `value.rework_hours` | `first` = 1 for an attempt (completed or exception) with Attempt 1 (blank counts as 1); `first_ok` = 1 if it also completed. `rework_hours` = SMV / 60 on an exception: the colleague time it may hand back. |

## 4. Stage 2: the cost job (scheduled, after ingest)

For each day that needs it (the last 14 days, plus any day holding a mapped item whose `cost` is null):

1. **Worktime totals.** Sum `worktime_sec` for the day, estate-wide over **all** items (unmapped included), and per spoke.
2. **Pools for the day.**
   - Hub pool/day = the HUB `peopleCostHistory` row in force / 365.25, plus the daily cost of every hub-owned VDI.
   - Spoke pool/day = that spoke's own `peopleCostHistory` row in force / 365.25, plus the daily cost of that spoke's VDIs.
   - VDI daily cost: renewal cycles repeat every 365 days from `renewalDate`, both forwards and backwards. A cycle's coverage window is cut short by `licenseExpiryDate` and by `activeTo` on a retired VDI, and never starts before `activeFrom`. Inside the window, cost = annual cost / days in the window. Annual cost is `annualCostGBP` if set, otherwise the `vdiCostHistory` class rate in force at the cycle start (spoke rate before universal). Outside the window the VDI costs £0 **and has no capacity that day**.
3. **Write** one `ia-cost-daily` document per pool (`_id = date|pool`) and one `ia-vdi-daily` document per VDI (`_id = date|resource`).
4. **Stamp** each mapped item that day:
   - `cost.hub_people_gbp` = worktime × hub people/day ÷ estate worktime
   - `cost.hub_infra_gbp` = worktime × hub infra/day ÷ estate worktime
   - `cost.spoke_people_gbp` = worktime × own spoke people/day ÷ spoke worktime
   - `cost.spoke_infra_gbp` = worktime × own spoke infra/day ÷ spoke worktime
   - `people_gbp`, `infra_gbp` and `estate_gbp` are the sums.

   A pool on a day with no worktime goes unattributed. That cost is kept in `ia-cost-daily` and shown as a memo on Value & Finance, never folded into net benefit (same as the React app).

`stamp_costs.py` does all of this through the REST API. It needs an API key with read on `ia-workqueue-items` and write on all three indices. Run it every 15 to 60 minutes, after the Logstash schedule. `--dry-run` computes without writing.

If you'd rather keep everything inside Logstash, the alternative is to compute cost at query time in each Vega panel from `ia-cost-daily` plus worktime totals. It works, but it triples the queries on every money panel and puts the apportionment rule in 15 places instead of one. That's why it isn't the recommended route.

## 5. The indices

### ia-workqueue-items (one document per work item, `_id` = item ID)

| Field | Type | Notes |
|---|---|---|
| `@timestamp` | date | outcome timestamp (T3); the dashboards' time field |
| `outcome_date` | date (yyyy-MM-dd) | the UTC day the cost job keys on |
| `item.id`, `item.key_value`, `item.status`, `item.tags` | keyword | `key_value` is the case reference |
| `item.priority`, `item.attempt` | integer | |
| `item.loaded_at`, `last_updated_at`, `completed_at`, `exception_at`, `locked_at`, `deferred_at`, `sla_due_at` | date | |
| `queue.name`, `queue.stage` / `queue.stage_order` | keyword / integer | |
| `resource.name`, `resource.bot`, `resource.owner_spoke` | keyword | |
| `outcome` | keyword | Completed, Exception, Pending |
| `exception.type`, `reason`, `reason_display`, `code` | keyword | null unless outcome is Exception |
| `worktime_sec`, `worktime_completed_sec`, `turnaround_sec` | long | seconds |
| `mapped` | boolean | queue known to reference data |
| `n.completed`, `n.exception`, `n.business`, `n.system`, `n.pending`, `n.attempt`, `n.case_done`, `n.first`, `n.first_ok`, `n.in_sla` | integer | 0/1 |
| `process.id`, `name`, `acronym`, `tags[]`, `grade`, `grade_name` | keyword | |
| `process.smv_minutes` | double | |
| `proposition.name`, `spoke.id`, `spoke.name`, `spoke.short` | keyword | |
| `value.hourly_rate_gbp`, `hours_saved`, `benefit_gbp`, `rework_gbp`, `rework_hours` | double | |
| `cost.estate_gbp`, `people_gbp`, `infra_gbp`, `hub_people_gbp`, `hub_infra_gbp`, `spoke_people_gbp`, `spoke_infra_gbp` | double | stage 2 |
| `cost.stamped_at` | date | stage 2 |

### ia-cost-daily (`_id` = date|pool)

`@timestamp`, `date`, `pool` (HUB or spoke name), `pool_type` (hub/spoke), `spoke.name`, `people_gbp`, `infra_gbp`, `total_gbp`, `worktime_sec` (the denominator used), `estate_worktime_sec`, `cost_per_bot_sec`, `working_days_per_year`, `productive_hours_per_day` (from `estateCostHistory` in force, used for FTE).

### ia-vdi-daily (`_id` = date|resource)

`@timestamp`, `date`, `resource.name`, `resource.bot`, `resource.owner_spoke`, `resource.cost_class`, `resource.status`, `available`, `daily_cost_gbp`, `operating_hours` (`vdiOperatingHoursPerDay` when available, else 0).

### ia-service-checks (written by etl/service-job, `_id` = run time|check)

One document per check per 15-minute run: `check.id`/`name`/`group`, `status` (ok, warn, act, quiet), `status_rank`, `alert_state` (status, with quiet carrying the last real state), `previous_state`, `changed`, `headline`, `detail`, `count`, `runbook`, `offenders[]`, `spokes[]`, `link`. Mapping in `etl/index-templates/ia-service-checks.json`; the job and the alert rules are described in docs/SERVICE.md.

### ia-reference (`doc_type` decides the shape)

| doc_type | Fields | Used for |
|---|---|---|
| `target` | `metric`, `scope` (global/spoke/process), `scope_id` (spoke name or process ID), `value` | target chips, reference lines, alert thresholds |
| `finance_target` | `spoke` ("ESTATE" or spoke name), `annual_net_benefit_target_gbp` | FY attainment, vs-target columns |
| `process` | `process.*` incl. description, current rate and `sla_hours`, `proposition.name`, `spoke.*` incl. colour, `queues[]`, `primary_queue` | process catalogue, colours, profile panel, SLA |
| `release` | `release.date`, `title`, `process` (null = estate-wide) | ◆ release markers on the time charts |
| `spoke` | `spoke.name`, `short`, `color` | spoke colours |
| `config` | `fiscal_year_start_month`, `vdi_operating_hours`, `warn_margin`, `min_alert_volume`, `alert_window_days` | |

Load it with `node etl/reference-impl/reference-ndjson.mjs > ref.ndjson` and then `_bulk`. Delete the index first so removed rows go too. reference.json has no finance targets today, so the target figures are hidden (Executive Summary shows cases completed and net per item in their place) until you add some (`financeTargets: [{ "spokeId": "ESTATE", "annualNetBenefitTargetGBP": 600000 }]`).

## 6. Checking your output

On the mock data (`npm run mock`), the reference implementation gives these totals (`npm test` checks them). They match the React app on the same CSV except for T13: add the earlier-stage benefit back and you get the React figures exactly (gross £2,880,767.34, net £526,213.24).

| Measure | Value |
|---|---|
| Items | 231,660 |
| Completed / exceptions | 211,972 / 19,413 (business 11,966, system 7,447) |
| Cases completed | 201,433 |
| Gross benefit | £2,511,007.48 |
| Estate cost | £2,354,554.10 |
| Net benefit | £156,453.38 |
| Earlier-stage benefit no longer counted (T13) | £369,759.87 |

Against real data, run the same sums in Dev Tools (`sum` of `value.benefit_gbp` and `cost.estate_gbp` where `mapped: true`). Compare them with the React app pointed at the same extract. If gross matches and cost doesn't, the problem is stage 2. If gross is out too, check T3, T7 and T13 first.
