# Part 2: Logstash

The pipeline reads the Blue Prism work-queue items already in Elastic, adds the calculated fields below, and writes one document per item to `ia-workqueue-items`. If that index holds these fields, calculated as described, every panel works unchanged.

```
Blue Prism items (already in Elastic) ─► Logstash: ia-enrich.rb ─► ia-workqueue-items ─► dashboards
reference.json ─────────────────────────┘                                ▲
                                          daily cost job (Part 3) ─ cost ┘
```

## Setting it up

1. Copy `logstash/ia-enrich.rb` and `logstash/reference.json` to the Logstash host (`/etc/logstash/ia/`).
2. In `ia-enrich.rb`, point `SOURCE_FIELDS` at your Blue Prism field names (right-hand side only), and set `WORKTIME_DIVISOR = 1000` if worktime is held in milliseconds.
3. Fill in the `<placeholders>` in `logstash/ia-workqueue.conf` and start the pipeline. It needs an API key with read on the Blue Prism index and write on `ia-workqueue-items`.
4. Check in Discover (data view `ia-workqueue-items*`):
   - items arrive with `outcome`, `process.name`, `spoke.name`, `value.benefit_gbp` and `item.sla_due_at` filled in;
   - `mapped: false` is rare (each is a queue missing from `queueMap`);
   - a pending item becomes Completed in place when it finishes (same `_id`), not a second document;
   - times are UTC: compare a few against Control Room.

The `ia-workqueue-items` template is strict, so a misspelt field fails loudly rather than appearing as a new field.

## Inputs

**Blue Prism fields** (the `BPAWorkQueueItem` columns): `ID, KeyValue, Priority, Status, Tags, Resource, Attempt, LoadedDate, LastUpdatedDate, DeferredDate, LockedDate, CompletedDate, Worktime, ExceptionDate, ExceptionReason, QueueName`.

Check before trusting any number:

1. **Timezone.** Dates are treated as UTC. If Blue Prism logs local time, summer items land an hour out.
2. **Worktime** must be whole seconds.
3. **One item, one document.** An item arrives again each time it changes; writing with `document_id` = item ID makes the latest state replace the earlier one.
4. **Queue names must match `queueMap`** in reference.json, or the item is excluded from every process, spoke and £ figure (`mapped: false`).
5. **Resource names must match `resources`**, or the item can't be tied to a VDI's capacity and cost.

**reference.json** holds spokes, propositions, processes (SMV, grade, optional `slaHours`), the queue-to-process map, `slaHoursDefault`, releases, the dated grade rate card, VDIs and their rates, people costs, exception patterns and targets. The filter reloads it every five minutes.

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
| T13 | `n.case_done`, benefit | A multi-stage process (queueMap rows sharing a processId with `stageOrder`) earns benefit and hours saved once per case, at its final stage. Earlier stages still count as items, worktime and cost. `n.case_done` = 1 on a completed final-stage item (every completed item for single-stage processes). |
| T14 | `turnaround_sec`, `item.sla_due_at`, `n.in_sla` | Turnaround = outcome time − loaded time, in seconds, for completed and exception items. SLA hours = the process's `slaHours`, else `slaHoursDefault` (24). `sla_due_at` = loaded + SLA hours, on every mapped item. `n.in_sla` = 1 for a completed item within SLA. |
| T15 | `n.first`, `n.first_ok`, `value.rework_hours` | `first` = 1 for an attempt with Attempt 1 (blank counts as 1); `first_ok` = 1 if it also completed. `rework_hours` = SMV / 60 on an exception. |
| | `cost` | Write null; the cost job fills it. |

## ia-workqueue-items fields

One document per work item, `_id` = item ID.

| Field | Type | Notes |
|---|---|---|
| `@timestamp` | date | outcome time (T3); the dashboards' time field |
| `outcome_date` | date (yyyy-MM-dd) | the UTC day the cost job keys on |
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
| `value.hourly_rate_gbp`, `hours_saved`, `benefit_gbp`, `rework_gbp`, `rework_hours` | double | |
| `cost.*` | double, date | written by the cost job (JOBS.md) |

## Checking the numbers

In Dev Tools, sum `value.benefit_gbp` where `mapped: true` over a period and compare it with the React app on the same extract. Gross benefit should match apart from multi-stage processes (T13). If it is out, check T3, T7 and T13 first, then the field mapping.
