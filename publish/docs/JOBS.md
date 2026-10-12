# Part 3: Scheduled jobs

Two Python scripts on any host that can reach Elasticsearch (the Logstash host is fine). Copy the `jobs/` folder and `logstash/reference.json` to `/opt/ia` and schedule them from `jobs/crontab.example`. Both use one API key: read on the Blue Prism index and `ia-*`, write on `ia-*`, set as `IA_ES_URL` and `IA_ES_API_KEY`.

| Job | Needed for | Schedule |
|---|---|---|
| `stamp_costs.py` | Every £ figure | Daily, after the overnight ingest |
| `service_checks.py` | Teams or email alerts for the run team (optional) | Every 15 minutes |

## The cost job

An item's cost is its share of the day's cost pools, by worktime. That needs the whole day's worktime first, which Logstash can't know while it processes one item at a time, so this runs once a day afterwards.

```bash
pip install requests
python3 stamp_costs.py --reference reference.json --dry-run   # computes and prints, writes nothing
python3 stamp_costs.py --reference reference.json             # the first run backfills every uncosted day
```

Each run covers the last 14 days plus any day with a mapped item still uncosted, so late or changed items are picked up. Today's items show £0 until the next run; run it more often if that matters. Without the job, £ figures show £0 and Value & Finance is empty; everything else works.

For each day:

1. **Worktime totals**: `worktime_sec` summed estate-wide over all items (unmapped included), and per spoke.
2. **Pools**:
   - hub pool per day = the HUB `peopleCostHistory` row in force / 365.25, plus the daily cost of every hub-owned VDI;
   - spoke pool per day = that spoke's `peopleCostHistory` row / 365.25, plus the daily cost of its VDIs;
   - a VDI's daily cost: renewal cycles repeat every 365 days from `renewalDate`. A cycle's window is cut short by `licenseExpiryDate` and by `activeTo` on a retired VDI, and never starts before `activeFrom`. Inside the window, cost = annual cost / days in the window, where annual cost is `annualCostGBP` if set, else the `vdiCostHistory` class rate in force at the cycle start (spoke rate before universal). Outside it the VDI costs £0 and has no capacity.
3. **Writes** one `ia-cost-daily` document per pool and one `ia-vdi-daily` document per VDI.
4. **Stamps** each mapped item that day:
   - `cost.hub_people_gbp` = worktime × hub people per day ÷ estate worktime;
   - `cost.hub_infra_gbp` = worktime × hub infra per day ÷ estate worktime;
   - `cost.spoke_people_gbp` = worktime × own spoke people per day ÷ spoke worktime;
   - `cost.spoke_infra_gbp` = worktime × own spoke infra per day ÷ spoke worktime;
   - `people_gbp`, `infra_gbp` and `estate_gbp` are the sums, and `stamped_at` the time.

A pool on a day with no worktime goes unattributed: it stays in `ia-cost-daily` and shows as a memo on Value & Finance, never folded into net benefit.

When rates or costs in reference.json change, re-run the job with `--lookback` covering the affected days.

**ia-cost-daily** (`_id` = date|pool): `@timestamp`, `date`, `pool` (HUB or spoke), `pool_type`, `spoke.name`, `people_gbp`, `infra_gbp`, `total_gbp`, `worktime_sec`, `estate_worktime_sec`, `cost_per_bot_sec`, `working_days_per_year`, `productive_hours_per_day` (used for FTE).

**ia-vdi-daily** (`_id` = date|resource): `@timestamp`, `date`, `resource.name`, `bot`, `owner_spoke`, `cost_class`, `status`, `available`, `daily_cost_gbp`, `operating_hours`.

## Service checks and alerts (optional)

The Service dashboard works without this job: it runs the nine checks live whenever it is open. The job runs the same checks every 15 minutes and records the result, so the run team can be alerted rather than watch a dashboard, and the dashboard's "Last 24 hours" panel has history to show. Leave it until everything else works.

### The checks

"Usual" is the mean of the same 24 hours one to four weeks earlier, so comparisons are like-for-like by weekday and time of day.

| Check | Warning | Action | First step (also in the alert) |
|---|---|---|---|
| **Data arriving**: minutes since any item was updated | over 60 | over 180, or nothing in 7 days | Check the Logstash pipeline is running and can reach the Blue Prism data. If Blue Prism has stopped, raise it with platform support. |
| **Cost job up to date**: days since the last costed day | 2 | 4 | Re-run stamp_costs.py and read its log for the failing day. |
| **All queues mapped**: items in 24 hours from queues missing from reference data | any | | Add the queue to queueMap in reference.json (or retire it). |
| **Nothing past its SLA**: waiting items against `item.sla_due_at` | any due within 2 h | any past SLA | Open the queue in Control Room; check its schedule and worker; prioritise items closest to SLA or add capacity. |
| **No items stuck on a lock**: pending items locked over 60 minutes | | any | A session probably died holding the lock. Confirm nothing is working the item, then unlock it. |
| **Workers running**: per digital worker | under 50% of usual, or no item for 2 h while the estate is working | under 25%, or no item for 4 h | Log on to the VDI. Check the runtime resource is up, nothing is stuck on a dialog and the schedule fired. |
| **Processes running as usual**: attempts per process | under 50% of usual | under 25% | Check the schedule fired and items were loaded upstream. |
| **System exceptions normal**: per process against its 28-day rate | 5+ and over 2× usual | 10+ and over 3× | Read the top reason; pause the schedule if items are failing in bulk. |
| **No new exception reasons**: seen 3+ times in 24 hours, not in the previous 28 days | any | | Usually a change in the target system; check with its owners. |

To avoid false alarms: service hours are 07:00 to 19:00 UTC, and outside them "Data arriving" shows Out of hours, worker gaps aren't judged, and nothing alerts or clears. A worker gap is measured from its last item (or the start of service hours) to the estate's latest item, and only counts if its usual rate says 5 or more items should have been worked. "Usual" must be at least 10 items before silence counts. Workers marked retired in reference data are excluded. SLA hours come from each process's `slaHours`, else 24; set real ones before go-live.

### Setting it up

1. Run `python3 service_checks.py --dry-run` once; it prints each check. Then schedule it every 15 minutes. Standard library only. Set `IA_KIBANA_URL` so alerts link to the dashboard.
2. Create a Teams, Slack, email or webhook connector under Stack Management > Connectors and note its id.
3. Create the four rules (needs a Kibana API key with Rules and Connectors in the space, as `IA_KIBANA_API_KEY`):

```bash
python3 create_rules.py --dry-run                                 # shows the four rules
python3 create_rules.py --connector <id> --connector-type teams   # creates or updates them
```

Add `--warn-connector <id>` to send warnings to a quieter channel; without it warnings are recorded but nobody is notified.

| Rule | Fires when |
|---|---|
| IA service: action needed | a check moves to Action |
| IA service: warning | a check moves to Warning |
| IA service: cleared | a check that was Action or Warning is OK again |
| IA service: check job down | no results for 45 minutes |

Each change is notified once, not every 15 minutes. Acknowledge, snooze and mute on the rule in Kibana. The job writes about 860 small documents a day to `ia-service-checks`; add an ILM policy to delete after 90 days if wanted.

To prove it end to end, stop the Logstash pipeline in service hours and wait for "Data arriving" to warn after an hour.
