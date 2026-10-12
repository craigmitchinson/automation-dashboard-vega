# Service: checks and alerts for the run team

The Service dashboard and the alerts come from one set of nine checks. Each check is **OK**, **Warning**, **Action** or **Out of hours**. A job runs them every 15 minutes and writes the result. Kibana alerting rules then notify the team when a check moves to Action, and again when it clears. Nobody has to watch a dashboard: the alert says what is wrong and what to do first, and links to the Service dashboard for the detail.

![Service](../previews/pages/01-service.png)

## The checks

"Usual" is the mean of the same 24 hours one, two, three and four weeks earlier, so the comparison is always like-for-like by weekday and time of day. "Last 24 hours" is rolling, not since midnight.

| Check | Warning | Action | First step (also in the alert) |
|---|---|---|---|
| **Data arriving**: minutes since any item was last updated | over 60 min | over 180 min, or nothing in 7 days | Check the Logstash pipeline is running and can reach the Blue Prism database. If Blue Prism itself has stopped, raise it with platform support. |
| **Cost job up to date**: days between today and the last day in `ia-cost-daily` | 2 days | 4 days | Re-run stamp_costs.py and read its log for the day that failed. |
| **All queues mapped**: items in the last 24 hours from queues missing from reference data (they drop out of every figure) | any | | Add the queue to queueMap in reference.json (or retire it) and reload. |
| **Nothing past its SLA**: waiting items against `item.sla_due_at` (items deferred to a future date don't count) | any due within 2 h | any past SLA | Open the queue in Control Room. Check its schedule is running and has a worker; prioritise the items closest to their SLA or add capacity. |
| **No items stuck on a lock**: pending items locked for over 60 minutes | | any | A session probably died holding the lock. Confirm nothing is running against the item, then unlock it. |
| **Workers running**: per digital worker | under 50% of usual items, or no item for 2 h while the estate is working | under 25% of usual, or no item for 4 h | Log on to the VDI. Check the runtime resource is up, the session isn't stuck on a dialog and the schedule fired. |
| **Processes running as usual**: attempts per process | under 50% of usual | under 25% of usual | Check the schedule fired and that items were loaded upstream. |
| **System exceptions normal**: per process, against its own rate over the previous 28 days | 5+ system exceptions and over 2× its usual rate | 10+ and over 3× | Read the top reason for the process; pause the schedule if items are failing in bulk. |
| **No new exception reasons**: reason codes seen 3+ times in 24 hours and not at all in the previous 28 days | any | | Usually a change in the target system. Check with its owners; add a pattern to reference data if the reason is genuine. |

Details that stop false alarms:

- **Service hours** are 07:00 to 19:00 UTC. Outside them, "Data arriving" shows Out of hours, and worker gaps aren't judged. Out of hours never triggers or clears an alert: the job carries the last real state through the night.
- **Worker gaps** are measured from the worker's last item, or from the start of today's service hours if that is later, to the estate's latest item. So a worker isn't flagged first thing in the morning or when the whole estate is idle (that is "Data arriving"'s job). A gap also needs the worker's usual rate to say at least 5 items should have been worked in it, so low-volume workers aren't flagged after two quiet hours.
- **"Usual" must be at least 10 items** before silence counts, so new and occasional processes are left alone.
- **SLA** comes from each process's `slaHours` in reference.json, else `slaHoursDefault` (24). Set real SLAs before go-live: with the default, the check only catches items a day old.
- **Retired workers** (`resource.status` in `ia-vdi-daily`) are excluded. A worker that stopped weeks ago but is still in "usual" shows as Action until reference data marks it retired. That is deliberate.

All thresholds live in `vega/lib/service.mjs` (`SERVICE`), except SLA hours, which are reference data. Change them there, run `npm run build`, re-import the dashboards and deploy the regenerated `etl/service-job/service-checks.json` with the job.

## The dashboard

| Panel | Shows |
|---|---|
| Service status | The verdict (All clear, Keep an eye on it, Action needed), the nine checks and where alerts go |
| What to do now | Checks that aren't OK, worst first, with the worst offenders and the first step |
| Last 24 hours | The job's results, worst status per hour per check, and when the job last ran. Turns red if the job has stopped, because then nothing can alert. |
| Activity, last 48 hours | Items worked per hour against the usual line and the 1-to-4-weeks-back range; system exceptions; out-of-hours shaded |
| Digital workers | Per worker: 24 one-hour cells of activity, last item, items in 24 hours against usual, status |
| Queues | Waiting, past SLA, due within 2 hours, oldest and locked per queue. Click a row to filter. |
| System exceptions by process | Last 24 hours against each process's 28-day rate. Click to filter. |
| Exception reasons | Last 24 hours, new reasons first |

The dashboard opens on the last 24 hours. Every check uses the **end** of the time picker as "now", so the picker's start doesn't matter and setting the end to a past time replays that moment. The Spoke, Process and Queue controls narrow the live panels; the job and the alerts are always estate-wide (each result lists the spokes affected, so a rule can be copied per spoke team with a `spokes` filter).

## Running it

1. **Index template.** `PUT _index_template/ia-service-checks` with `etl/index-templates/ia-service-checks.json`. Add an ILM policy that deletes after 90 days if you want one; the job writes about 860 small documents a day.
2. **The job.** Schedule `etl/service-job/service_checks.py` every 15 minutes, wherever the cost job runs. It needs `IA_ES_URL` and `IA_ES_API_KEY` (read on `ia-*`, write on `ia-service-checks`), and optionally `IA_KIBANA_URL` so alerts carry a link. Python 3.9+, standard library only. `--dry-run` prints the results without writing.
3. **Connector.** In Stack Management > Connectors, create a Teams, Slack, email or webhook connector, and note its id.
4. **Rules.** `IA_KIBANA_URL=... IA_KIBANA_API_KEY=... python3 etl/service-job/create_rules.py --connector <id> --connector-type teams`. Add `--warn-connector <id>` to send warnings to a quieter channel; without it, warnings are recorded in Kibana but nobody is notified. Re-running updates the rules in place.

The four rules are all the built-in Elasticsearch query type, so a Basic licence is enough:

| Rule | Fires when |
|---|---|
| IA service: action needed | a check's state changed to Action on the latest run |
| IA service: warning | a check's state changed to Warning |
| IA service: cleared | a check that was Action or Warning is OK again |
| IA service: check job down | no results in `ia-service-checks` for 45 minutes |

The job sets `changed: true` only on the run where a state moves, so each change is notified once, not every 15 minutes. Acknowledge, snooze and mute happen on the rule in Kibana, which is where they live.

## What the ETL must provide

The checks read fields stage 1 writes (including `item.sla_due_at`, T14), plus two things to confirm with the Logstash developer (docs/DATA-CONTRACT.md T11 and T12):

- Pending items must be **updated in place** when they complete or fail (`_id` = item ID, polled on `LastUpdated`), or they will look like a growing backlog.
- `item.locked_at` must be the Blue Prism `LockedDate` (set while a session is working the item), and must be cleared when the lock is released.

## How it is proved

- `tests/service.test.mjs` runs the checks in Vega and in the job at seven moments in the mock data: the preview's 15:00, overnight, a Sunday, and the four seeded incidents. Every check must give the same status, headline, detail and count in both, and between them the moments must reach OK, Warning, Action and Out of hours. An unmapped queue is injected to exercise that check, which the mock data never trips.
- `npm run mock:service` runs the real job, through HTTP, 97 times across the 24 hours before the preview's "now", against the mock indices. That fills the history panel and exercises the job's queries, its previous-state lookup and its bulk writes.

Not yet run against a real cluster: the rules API calls (`create_rules.py --dry-run` prints exactly what it will send).
