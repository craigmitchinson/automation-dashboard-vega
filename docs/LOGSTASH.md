# Part 2: Logstash

The pipeline reads the Blue Prism work-queue items already in Elastic, adds the calculated fields below, and writes one document per item to `ia-workqueue-items`. If that index holds these fields, calculated as described, every panel works unchanged.

```
Blue Prism items (already in Elastic) ─► Logstash: ia-enrich.rb ─► ia-workqueue-items ─► dashboards
reference.json ─────────────────────────┘                                ▲
                                    daily cost pipelines (Part 3) ─ cost ┘
```

## Setting it up

1. Copy `logstash/ia-enrich.rb` and `logstash/reference.json` to the Logstash host (`/etc/logstash/ia/`).
2. In `ia-enrich.rb`, point `SOURCE_FIELDS` at your Blue Prism field names (right-hand side only), and set `WORKTIME_DIVISOR = 1000` if worktime is held in milliseconds.
3. Fill in the `<placeholders>` in `logstash/ia-workqueue.conf` and start the pipeline. It needs an API key with read on the Blue Prism index and write on `ia-workqueue-items`. The daily cost pipelines (`ia-cost-daily.conf`, `ia-cost-stamp.conf`, `ia-cost.rb`) are set up in Part 3.
4. Check in Discover (data view `ia-workqueue-items*`):
   - items arrive with `outcome`, `process.name`, `spoke.name`, `value.benefit_gbp` and `item.sla_due_at` filled in;
   - `mapped: false` is rare (each is a queue missing from `queueMap`);
   - a pending item becomes Completed in place when it finishes (same `_id`), not a second document;
   - times are UTC: compare a few against Control Room.

The `ia-workqueue-items` template is strict, so a misspelt field fails loudly rather than appearing as a new field. The pipeline removes `@version`, which the template does not map.

**The write is an update, not a replace.** The output uses `action => "update"` with `doc_as_upsert => true` and `document_id` = item ID. A new item is created; a changed one is merged field by field. This keeps one document per item and, because `ia-enrich.rb` never writes `cost`, leaves the `cost.*` fields that the cost pipeline stamped (Part 3). Every field the filter does write is written on every pass (a nested object such as `exception` or `process` is written whole, or as null), so no stale value from an earlier state survives. If an item later becomes unmapped (its queue leaves `queueMap`), its old `cost` stays until the cost pipeline's lookback no longer reaches it; the dashboards sum `cost` over mapped items only.

## Inputs

**Blue Prism fields** (the `BPAWorkQueueItem` columns): `ID, KeyValue, Priority, Status, Tags, Resource, Attempt, LoadedDate, LastUpdatedDate, DeferredDate, LockedDate, CompletedDate, Worktime, ExceptionDate, ExceptionReason, QueueName`.

Check before trusting any number:

1. **Timezone.** Dates are treated as UTC. If Blue Prism logs local time, summer items land an hour out.
2. **Worktime** must be whole seconds.
3. **One item, one document.** An item arrives again each time it changes; writing with `document_id` = item ID makes the latest state replace the earlier one.
4. **Queue names must match `queueMap`** in reference.json, or the item is excluded from every process, spoke and £ figure (`mapped: false`).
5. **Resource names must match `resources`**, or the item can't be tied to a VDI's capacity and cost.

**reference.json** holds spokes, propositions, processes (SMV, grade, optional `slaHours` and `offshoreShare`), the queue-to-process map (with stage order and optional `stageShare`), `slaHoursDefault`, releases, the dated grade rate card (rows may carry a `location`), the FTE working assumptions (`estateCostHistory`, also by `location`), VDIs and their rates, people costs, exception patterns and targets. The filter reloads it every five minutes.

**Onshore and offshore (new).** Three optional additions, all backward compatible (without them everything is onshore):

| Field | Meaning |
|---|---|
| `processes[].offshoreShare` | 0 to 1, default 0. The share of the process's manual work that offshore colleagues would otherwise do. The rest is onshore. |
| `gradeRates[].location` | `Onshore` or `Offshore`. A location's rate is its latest row in force on the day carrying that location; if there is none, the latest location-less row. Within each of those, a spoke-specific row beats a universal one. |
| `estateCostHistory[].location` | The same for `workingDaysPerYear` and `productiveHoursPerDay`, which turn hours into FTE. Offshore falls back to the location-less row. |

Existing documents lack the new `value.*` fields until they are re-ingested (re-read the Blue Prism items, or run an update by query), so the offshore figures read as zero until then.

## The transformations

| # | Output field(s) | Rule |
|---|---|---|
| T1 | `item.*_at` | Parse every date as UTC; blank or unparseable becomes null. `last_updated_at` falls back to completed, then exception, then locked, then loaded date. |
| T2 | `outcome` | `Completed` if CompletedDate is set, else `Exception` if ExceptionDate is set, else `Pending`. Never the Status text. |
| T3 | `@timestamp`, `outcome_date` | Outcome time = CompletedDate, else ExceptionDate, else LoadedDate; `outcome_date` is its UTC day. Every dashboard buckets on this. |
| T4 | `queue.*`, `process.*`, `proposition.name`, `spoke.*`, `mapped` | QueueName → `queueMap` → process → proposition → spoke. `mapped` is false when the queue is unknown. |
| T5 | `exception.type` | A reason starting "Business Exception" or "System Exception" (any case) is trusted. Otherwise the first `exceptionPatterns` entry (with `%` removed) found in the reason, case-insensitive, by priority then pattern length descending. Otherwise `Business`. |
| T6 | `exception.reason_display`, `exception.code` | Strip the "Business/System Exception:" prefix; blank becomes "(no reason recorded)". Code from `exceptionDisplayCodes`, else the initials of up to three words. |
| T7 | `value.hourly_rate_gbp` | The grade's rate in force on the outcome date: the latest `gradeRates` row with `effectiveFrom` on or before it, a spoke-specific row beating a universal one. A pay award never revalues history. |
| T8 | `value.benefit_gbp`, `value.rework_gbp`, `value.hours_saved` | Completed: benefit = SMV × rate / 60, hours saved = SMV / 60. Exception: rework = SMV × rate / 60 (an upper bound). Otherwise 0. |
| T9 | `n.completed`, `n.exception`, `n.business`, `n.system`, `n.pending`, `n.attempt`, `worktime_sec`, `worktime_completed_sec` | 0/1 flags and worktime copies, so every count is a plain sum. Attempt = completed + exception. |
| T10 | `resource.owner_spoke` | The VDI's owning spoke from `resources`, or `Hub`. |
| T11 | (whole document) | Poll on `LastUpdated` and write with `_id` = item ID, so a pending item becomes Completed or Exception in place. Otherwise the Service page sees a growing backlog. |
| T12 | `item.locked_at` | `LockedDate`: set while a session holds the item, null once released. |
| T13 | `n.case_done`, benefit | A multi-stage process (queueMap rows sharing a processId with `stageOrder`) earns its SMV once per case. If its queueMap rows carry `stageShare` (fractions adding up to 1), each completed stage earns its share of the benefit and hours saved, so a case that fails at a later stage keeps credit for the stages it finished. Without shares, the final stage earns it all. Every stage still counts as items, worktime and cost. `n.case_done` = 1 on a completed final-stage item (every completed item for single-stage processes). |
| T14 | `turnaround_sec`, `item.sla_due_at`, `n.in_sla` | Turnaround = outcome time − loaded time, in seconds, for completed and exception items. SLA hours = the process's `slaHours`, else `slaHoursDefault` (24). `sla_due_at` = loaded + SLA hours, on every mapped item. `n.in_sla` = 1 for a completed item within SLA. |
| T15 | `n.first`, `n.first_ok`, `value.rework_hours` | `first` = 1 for an attempt with Attempt 1 (blank counts as 1); `first_ok` = 1 if it also completed. `rework_hours` = SMV / 60 on an exception. |
| T16 | `outcome_hour`, `outcome_weekday` | The outcome time's UTC hour (0 to 23) and ISO weekday (1 = Monday to 7 = Sunday), for "when the work runs". |
| T17 | `value.hours_saved_onshore` / `_offshore`, `value.benefit_onshore_gbp` / `_offshore_gbp`, `value.rework_hours_onshore` / `_offshore`, `value.rework_onshore_gbp` / `_offshore_gbp`, `value.hourly_rate_offshore_gbp` | **New.** Splits the T8, T13 and T15 figures by where the colleagues sit. With the process's `offshoreShare` s, the onshore part is (1 − s) of the figure and the offshore part is s, applied after the T13 stage share. Each part is priced at its own location's rate (the T7 rule, by location): onshore at `value.hourly_rate_gbp`, offshore at `value.hourly_rate_offshore_gbp`. The totals (`hours_saved`, `benefit_gbp`, `rework_gbp`, `rework_hours`) are exactly onshore + offshore. With no offshore share, offshore is 0 and nothing else changes. |
| | `cost` | Not written. The cost pipelines fill it (Part 3); the output update leaves it alone. |

## ia-workqueue-items fields

One document per work item, `_id` = item ID.

| Field | Type | Notes |
|---|---|---|
| `@timestamp` | date | outcome time (T3); the dashboards' time field |
| `outcome_date` | date (yyyy-MM-dd) | the UTC day the cost pipelines key on |
| `outcome_hour`, `outcome_weekday` | byte | T16 |
| `item.id`, `key_value`, `status`, `tags` | keyword | `key_value` is the case reference |
| `item.priority`, `attempt` | integer | |
| `item.loaded_at`, `last_updated_at`, `completed_at`, `exception_at`, `locked_at`, `deferred_at`, `sla_due_at` | date | |
| `queue.name`, `queue.stage` / `queue.stage_order` | keyword / integer | |
| `resource.name`, `bot`, `owner_spoke` | keyword | |
| `outcome` | keyword | Completed, Exception, Pending |
| `exception.type`, `reason`, `reason_display`, `code` | keyword | null unless an exception |
| `worktime_sec`, `worktime_completed_sec`, `turnaround_sec` | long | seconds |
| `mapped` | boolean | queue known to reference data |
| `n.completed`, `exception`, `business`, `system`, `pending`, `attempt`, `case_done`, `first`, `first_ok`, `in_sla` | integer | 0/1 |
| `process.id`, `name`, `acronym`, `tags[]`, `grade`, `grade_name` | keyword | |
| `process.smv_minutes` | double | |
| `proposition.name`, `spoke.id`, `name`, `short` | keyword | |
| `value.hourly_rate_gbp`, `hours_saved`, `benefit_gbp`, `rework_gbp`, `rework_hours` | double | totals: onshore + offshore |
| `value.hourly_rate_offshore_gbp` | double | **new**: the offshore rate in force (T17) |
| `value.hours_saved_onshore`, `hours_saved_offshore` | double | **new**: T17 |
| `value.benefit_onshore_gbp`, `benefit_offshore_gbp` | double | **new**: T17 |
| `value.rework_hours_onshore`, `rework_hours_offshore` | double | **new**: T17 |
| `value.rework_onshore_gbp`, `rework_offshore_gbp` | double | **new**: T17 |
| `cost.*` | double, date | written by the cost pipelines (JOBS.md), not by this pipeline |

## Checking the numbers

In Dev Tools, sum `value.benefit_gbp` where `mapped: true` over a period and compare it with the React app on the same extract. Gross benefit should match apart from multi-stage processes (T13). On every item `benefit_onshore_gbp + benefit_offshore_gbp` should equal `benefit_gbp`, and the same holds for hours and rework. If it is out, check T3, T7 and T13 first, then the field mapping.
