# Part 3: Scheduled Logstash pipelines and Kibana alerts

Two things run on a schedule, and both live inside the Elastic stack: the daily cost, as two scheduled Logstash pipelines beside the Part 2 pipeline, and five Kibana alerting rules that watch the data. Nothing else is needed: no scripts, no cron, no other host.

1. The daily cost pipelines, below.
2. [Service checks and Kibana alerts](#service-checks-and-kibana-alerts), further down.

## The daily cost pipelines

| Pipeline | File | Does | Default schedule |
|---|---|---|---|
| Cost pools | `ia-cost-daily.conf` with `ia-cost.rb` | Totals worktime per day, works out the cost pools, writes `ia-cost-daily` and `ia-vdi-daily` | 01:30 UTC daily |
| Cost stamp | `ia-cost-stamp.conf` with `ia-cost.rb` | Stamps `cost.*` onto each item from its day's pools | 02:00 UTC daily |

Without them, £ figures show £0 and Value & Finance is empty; everything else works.

## Setting it up

1. Copy `ia-cost-daily.conf`, `ia-cost-stamp.conf` and `ia-cost.rb` to the Logstash host beside the Part 2 files (`/etc/logstash/ia/`). `ia-cost.rb` reads the same `reference.json`, reloaded every five minutes.
2. Fill in the `<placeholders>` (the cluster URL) in both `.conf` files and register them as two more pipelines in `pipelines.yml`, for example ids `ia-cost-daily` and `ia-cost-stamp`, each with `pipeline.workers: 1`.
3. Settings are environment variables, set where the Logstash service reads them, each with a default:

| Variable | Default | Meaning |
|---|---|---|
| `IA_ES_API_KEY` | none | API key, see below |
| `IA_COST_SCHEDULE` | `30 1 * * * UTC` | cron for the pools pipeline |
| `IA_COST_STAMP_SCHEDULE` | `0 2 * * * UTC` | cron for the stamp pipeline; keep it after the pools by longer than they take |
| `IA_COST_LOOKBACK_DAYS` | `14` | whole days recalculated each run, ending yesterday UTC. Set it the same for both pipelines |

4. Backfill. The first scheduled run only covers the lookback, so for history set `IA_COST_LOOKBACK_DAYS` to cover it (for example `730`) and the two schedules to a time a few minutes ahead (pools first, stamp about ten minutes later). Restart Logstash, watch `ia-cost-daily` fill in Discover, then put all three back and restart. Any mapped item with no stamp is picked up whatever its age, as long as its day exists in `ia-cost-daily`.
5. Check in Discover: `ia-cost-daily` has a HUB doc and one per spoke for every day, including days with no work; `ia-vdi-daily` has one per VDI per day; items in `ia-workqueue-items*` carry `cost.estate_gbp` and `cost.stamped_at`.

**API key privileges.** One key can serve all pipelines, or give each its own. All need the cluster privilege `monitor` (the plugins call `GET /` to check the Elasticsearch version). Index privileges per pipeline:

| Pipeline | Index | Privileges |
|---|---|---|
| Part 2 `ia-workqueue` | the Blue Prism index | `read`, `view_index_metadata` |
| | `ia-workqueue-items*` | `write`, `create_index` (creates and updates items) |
| `ia-cost-daily` | `ia-workqueue-items*` | `read`, `view_index_metadata` |
| | `ia-cost-daily*`, `ia-vdi-daily*` | `write`, `create_index` |
| `ia-cost-stamp` | `ia-workqueue-items*` | `read`, `view_index_metadata`, `write` (scripted update) |
| | `ia-cost-daily*` | `read` |

**Plugin versions.**
- The pools pipeline reads one aggregation. `response_type => "aggregations"` on the elasticsearch input needs a **logstash-input-elasticsearch version that supports `response_type`** (check the plugin docs for your Logstash; `bin/logstash-plugin update logstash-input-elasticsearch` may bring it). Otherwise swap the input for the `http_poller` block commented at the foot of `ia-cost-daily.conf`. It posts the same aggregation to `_search` on the same schedule, and `ia-cost.rb` accepts both response shapes, so nothing else changes.
- The stamp pipeline uses **logstash-filter-elasticsearch** for the pool lookups (bundled). `api_key` needs a recent version; on an older one use `user` and `password` instead.
- The `.conf` files use only `${VAR:default}` substitution, `schedule` and standard options.

## Why two pipelines

An item's cost is its share of the day's cost pools, by worktime. That needs the whole day's worktime first, which a per-item filter cannot know. So the pools pipeline totals the day with one aggregation, and the stamp pipeline then costs each item against the finished pools. Pools are looked up per item (two small searches of `ia-cost-daily`) rather than held in memory, so the stamp always uses exactly what is in the index and can be re-run alone.

## What each run does

Each run covers the last `IA_COST_LOOKBACK_DAYS` days (14 by default), so late or changed items are picked up. The stamp pipeline also takes any mapped item that has no stamp yet. Only whole past days are costed (today, UTC, is excluded, so no item is stamped against a partial day), so today's items show £0 until the first run after midnight UTC. An item whose day has no pool docs yet is left and retried on the next run.

For each day:

1. **Worktime totals**: `worktime_sec` summed estate-wide over all items (unmapped included), and per spoke.
2. **Pools**:
   - hub pool per day = the HUB `peopleCostHistory` row in force / 365.25, plus the daily cost of every hub-owned VDI;
   - spoke pool per day = that spoke's `peopleCostHistory` row / 365.25, plus the daily cost of its VDIs;
   - a VDI's daily cost: renewal cycles repeat every 365 days from `renewalDate`. A cycle's window is cut short by `licenseExpiryDate` and by `activeTo` on a retired VDI, and never starts before `activeFrom`. Inside the window, cost = annual cost / days in the window, where annual cost is `annualCostGBP` if set, else the `vdiCostHistory` class rate in force at the cycle start (spoke rate before universal). Outside it the VDI costs £0 and has no capacity.
3. **Writes** one `ia-cost-daily` document per pool and one `ia-vdi-daily` document per VDI, for every day in the lookback.
4. **Stamps** each mapped item that day:
   - `cost.hub_people_gbp` = worktime × hub people per day ÷ estate worktime;
   - `cost.hub_infra_gbp` = worktime × hub infra per day ÷ estate worktime;
   - `cost.spoke_people_gbp` = worktime × own spoke people per day ÷ spoke worktime;
   - `cost.spoke_infra_gbp` = worktime × own spoke infra per day ÷ spoke worktime;
   - `people_gbp`, `infra_gbp` and `estate_gbp` are the sums, and `stamped_at` the time.

A pool on a day with no worktime goes unattributed: it stays in `ia-cost-daily` and shows as a memo on Value & Finance, never folded into net benefit.

When rates or costs in reference.json change, run both pipelines with `IA_COST_LOOKBACK_DAYS` covering the affected days (as in the backfill). A late item for a day older than the lookback is stamped from that day's existing pools, which do not yet include its worktime; recalculate the day to correct the shares.

The stamp is a scripted update that sets only `cost` on the item. The Part 2 pipeline updates the same documents every 15 minutes without touching `cost`, so the stamp survives.

**ia-cost-daily** (`_id` = date|pool): `@timestamp`, `date`, `pool` (HUB or spoke), `pool_type`, `spoke.name`, `people_gbp`, `infra_gbp`, `total_gbp`, `worktime_sec`, `estate_worktime_sec`, `cost_per_bot_sec`, `working_days_per_year`, `productive_hours_per_day` (used for FTE), and **new** `working_days_per_year_offshore`, `productive_hours_per_day_offshore` (the offshore assumptions for the day: the latest `estateCostHistory` row with `location: Offshore` in force, else the location-less row the other two come from).

**ia-vdi-daily** (`_id` = date|resource): `@timestamp`, `date`, `resource.name`, `bot`, `owner_spoke`, `cost_class`, `status`, `available`, `daily_cost_gbp`, `operating_hours`.

## Service checks and Kibana alerts

The Service dashboard runs nine checks live whenever it is open. Five of them are also Kibana alerting rules, so the run team can be told rather than watch a page. The other four are dashboard-only.

| Check | Alert | What the rule counts |
|---|---|---|
| Data arriving | Kibana rule | Items updated in the last hour |
| Cost pipelines up to date | Kibana rule | `ia-cost-daily` documents from the last 2 days |
| All queues mapped | Kibana rule | Unmapped items in the last 24 hours |
| Nothing past its SLA | Kibana rule | Waiting items past `item.sla_due_at` |
| No items stuck on a lock | Kibana rule | Waiting items locked over 60 minutes |
| Workers running | Dashboard only | |
| Processes running as usual | Dashboard only | |
| System exceptions normal | Dashboard only | |
| No new exception reasons | Dashboard only | |

**Four checks are dashboard-only: workers running, processes running as usual, system exceptions normal and no new exception reasons.** Each compares the last 24 hours with a "usual" (the mean of the same 24 hours one to four weeks earlier, or the previous 28 days). A Kibana rule is a count of documents against a fixed threshold and cannot compare against a 4-week usual. These four show on the Service dashboard and in its "What to do now" list, and nobody is notified for them, so someone on watch should look at the dashboard.

### The checks

| Check | Warning | Action | First step (also in the alert) |
|---|---|---|---|
| **Data arriving**: minutes since any item was updated | over 60 | over 180, or nothing in 7 days | Check the Logstash pipeline is running and can reach the Blue Prism data. If Blue Prism has stopped, raise it with platform support. |
| **Cost pipelines up to date**: days since the last costed day (`ia-cost-daily`) | 2 | 4 | Check the `ia-cost-daily` Logstash pipeline ran (01:30 UTC by default) and read the Logstash log for the failing day. Re-run it, then `ia-cost-stamp`. |
| **All queues mapped**: items in 24 hours from queues missing from reference data | any | | Add the queue to queueMap in reference.json (or retire it). |
| **Nothing past its SLA**: waiting items against `item.sla_due_at` | any due within 2 h | any past SLA | Open the queue in Control Room; check its schedule and worker; prioritise items closest to SLA or add capacity. |
| **No items stuck on a lock**: pending items locked over 60 minutes | | any | A session probably died holding the lock. Confirm nothing is working the item, then unlock it. |
| **Workers running**: per digital worker | under 50% of usual, or no item for 2 h while the estate is working | under 25%, or no item for 4 h | Log on to the VDI. Check the runtime resource is up, nothing is stuck on a dialog and the schedule fired. |
| **Processes running as usual**: attempts per process | under 50% of usual | under 25% | Check the schedule fired and items were loaded upstream. |
| **System exceptions normal**: per process against its 28-day rate | 5+ and over 2x usual | 10+ and over 3x | Read the top reason; pause the schedule if items are failing in bulk. |
| **No new exception reasons**: seen 3+ times in 24 hours, not in the previous 28 days | any | | Usually a change in the target system; check with its owners. |

To avoid false alarms on the dashboard: service hours are 07:00 to 19:00 UTC, and outside them "Data arriving" shows Out of hours and worker gaps aren't judged. A worker gap is measured from its last item (or the start of service hours) to the estate's latest item, and only counts if its usual rate says 5 or more items should have been worked. "Usual" must be at least 10 items before silence counts. Workers marked retired in reference data are excluded. SLA hours come from each process's `slaHours`, else 24; set real ones before go-live.

### The five Kibana rules

These are Elasticsearch query rules (Query DSL). A rule has no warning level, so each fires at the Warning threshold above, except SLA, which fires only once an item is past its SLA.

| # | Rule name | Index | Time field and window | Query | Fires when the count is | Check every |
|---|---|---|---|---|---|---|
| 1 | IA · Data arriving | `ia-workqueue-items*` | `item.last_updated_at`, last 60 minutes | `{"query":{"match_all":{}}}` | below 1 | 15 minutes |
| 2 | IA · Cost pipelines up to date | `ia-cost-daily*` | `@timestamp`, last 2 days | `{"query":{"match_all":{}}}` | below 1 | 1 hour |
| 3 | IA · All queues mapped | `ia-workqueue-items*` | `@timestamp`, last 24 hours | `{"query":{"term":{"mapped":false}}}` | above 0 | 1 hour |
| 4 | IA · Nothing past its SLA | `ia-workqueue-items*` | `item.sla_due_at`, last 120 days | `{"query":{"bool":{"filter":[{"term":{"mapped":true}},{"term":{"n.pending":1}}],"must_not":[{"range":{"item.deferred_at":{"gt":"now"}}}]}}}` | above 0 | 15 minutes |
| 5 | IA · Nothing stuck on a lock | `ia-workqueue-items*` | `item.locked_at`, last 120 days | `{"query":{"bool":{"filter":[{"term":{"mapped":true}},{"term":{"n.pending":1}},{"range":{"item.locked_at":{"lte":"now-60m"}}}]}}}` | above 0 | 15 minutes |

All five: size 100, count over all documents (no grouping), and "exclude matches from previous run" off. The time window works on the time field, which is how rules 4 and 5 look at an item's own SLA and lock times instead of its `@timestamp`. Rule 4 looks back 120 days, as the dashboard does.

Limitations:

- **Service hours (rule 1).** A query rule has no "only during these hours" setting, and nothing arrives overnight or at weekends, so rule 1 goes active every night. Limit its connector action to 07:00 to 19:00 UTC (step 4 below). That is as close as a rule gets to the dashboard's Out of hours state: the rule still goes active outside the hours, it just does not notify.
- **No Action level.** The dashboard has Warning and Action (for example data over 180 minutes old). Each rule fires once, at the Warning threshold. For a louder second alert on "Data arriving", copy rule 1 and set its window to 180 minutes.
- **Cost pipelines (rule 2).** It fires when no `ia-cost-daily` document is dated in the last 2 days, which is when the latest costed day is two or more days behind, as the dashboard's Warning is.
- **Queues mapped (rule 3).** Unmapped items have no spoke, so this is estate-wide.
- **Spoke control.** Rules ignore the dashboard's Spoke control and watch the whole estate.

### Setting up the rules

1. Create a connector under Stack Management > Connectors: Teams, Slack, email or webhook.
2. Import `kibana/ia-dashboards.ndjson` (Part 1, step 2). It includes five rules named "IA · ...". **They arrive disabled and with no connector**, because a connector and an API key belong to the cluster, not to a file.
3. Open Stack Management > Rules. For each of the five "IA · " rules, choose Edit, then add an action using the connector.
   - Run when: "Query matched". Add a second action on "Recovered" if you want a message when it clears.
   - Action frequency: "On status change", so it notifies once, not at every check.
   - Message: the rule name, the link `{{kibanaBaseUrl}}/app/dashboards#/view/ia-service`, and the first step from the table above.
4. Rule 1 only: in its action, turn on "If alert matches a query" / "On selected days and hours" and set every day, 07:00 to 19:00 UTC. Do the same on the others if you want nothing overnight.
5. Save, then switch each rule on with its toggle. Kibana may ask to regenerate the rule's API key; accept.

Acknowledge, snooze and mute on the rule in Kibana.

**If the import refuses the rules**, or they do not appear, create the five by hand from the table above. The table is the authoritative definition. Stack Management > Rules > Create rule > Elasticsearch query > Query DSL; enter the index, time field, window, query, size 100 and threshold; set "Check every"; then add the connector as in steps 3 and 4. The saved-object form of a rule follows what Kibana 8.15 exports, but it is the least certain part of the import and has not been tried against a live Kibana. The republished file can be built without the rules (`NO_RULES=1 npm run build` on the source branch) if the import must be clean.

To prove it end to end, stop the Logstash pipeline in service hours and wait an hour for rule 1, or send a test item from a queue that is not in `queueMap` for rule 3.
