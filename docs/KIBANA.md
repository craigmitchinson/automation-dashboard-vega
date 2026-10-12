# Part 1: Kibana

All in the Kibana UI. No API keys, scripts or other software.

## 1. Indices and reference data

Open Dev Tools (main menu ☰ > Management > Dev Tools, Console tab). Check nothing already uses the names:

```
GET _cat/indices/ia-*
GET _index_template/ia-*
```

Both should come back empty. Then paste the whole of `kibana/devtools-setup.txt`, select all (Ctrl+A) and run (Ctrl+Enter). Expect `"acknowledged": true` nine times, a 404 on the `DELETE` the first time, and `"errors": false` on the bulk load. It is safe to re-run: the second time, the four index creations answer `resource_already_exists`, which is fine.

This creates five index templates, four empty indices for Logstash and the jobs to fill, and loads `ia-reference`. Everything it touches starts `ia-`, so nothing else in Elastic is affected. Run it before creating any panel: a panel whose index doesn't exist fails with "Cannot convert undefined or null to object". One set of indices covers every hub and spoke: each item carries `spoke.name`, decided by the queue mapping in `reference.json`.

## 2. Import the dashboards

Stack Management > Saved Objects > Import > `kibana/ia-dashboards.ndjson`, with "Automatically overwrite conflicts" ticked. It creates:

- the data view `ia-workqueue-items*` (time field `@timestamp`);
- one Vega visualisation per panel, titled "IA · dashboard · panel", plus a navigation strip;
- ten dashboards, each with Spoke, Proposition, Process, Queue and Tags controls (plus Exception reason on Exceptions, Digital worker on VDI & Capacity, and a single Hub control on Executive Summary).

To build a single panel by hand instead (or replace one), create a Vega visualisation and paste the matching file from `kibana/panels/<dashboard>/`, replacing everything in the editor.

The file is stamped for Kibana 8.15. If the import refuses it as newer than your Kibana, or rejects `controlGroupInput`, ask for it to be republished for your version (Help > About).

## 3. Settings

- **Light theme.** Stack Management > Advanced Settings > Dark mode off. The panels are designed for it.
- **Store URLs in session storage** (`state:storeInSessionStorage`), same page: on. The Vega panels are too large to fit in a URL, so without it Kibana refuses to open them in the editor ("The URL for this object is too long").
- **Controls**, only if the dashboards were republished without them: on one dashboard, Edit > Controls > Add options list for `spoke.name`, `proposition.name`, `process.name`, `queue.name` and `process.tags` (titled Spoke, Proposition, Process, Queue, Tags), then copy them to the others.
- **Links panel** (8.12 and later, recommended): replace the navigation strip on each dashboard with a Links panel to the ten dashboards, ticking "Use filters and query from origin dashboard" and "Use date range". This carries a clicked process through to Process detail. Without it, pin the filter instead (the pin on the filter pill).
- **Restricting a hub to its own data**, if wanted: document-level security on `spoke.name`, set per role by your Elastic admin.

The panels show zeros and empty charts until Logstash has run (Part 2).

## 4. First look

Open each dashboard on a 90-day window, then with one spoke selected, then on 12 months.

| Dashboard | Works when | If not |
|---|---|---|
| Service | A card per hub and nine checks with a status | All "Out of hours": service hours are 07:00 to 19:00 UTC |
| Process detail | Tiles to choose a process; clicking one fills the page | Data view title must be `ia-workqueue-items*` |
| Overview | Six tiles, item flow, watchlist | Blank: no mapped items yet (Part 2) |
| Work in & out | In against out, the flow from process to outcome, a row per month | "In" empty: `item.loaded_at` missing (Part 2, T1) |
| Process Analysis | Missed SLA bars, league table | Missed SLA all 0%: `item.sla_due_at` missing (Part 2) |
| Exceptions | Heatmap of process by reason | Few columns: exception patterns needed in reference.json |
| VDI & Capacity | Every VDI with utilisation; when the work runs | No VDIs: `resources` names must match Blue Prism's. Empty "when": `outcome_hour` missing (Part 2, T16) |
| Alerts | Rows per process ranked by money at stake | Everything breaching: targets need calibrating |
| Executive Summary | Fiscal year to date figures, health line | £0 everywhere: cost job (Part 3) |
| Value & Finance | Waterfall from gross to net | £0: cost job (Part 3) |

Other symptoms:

| Symptom | Likely cause |
|---|---|
| Red Vega error mentioning `%context%` | A panel was edited in Kibana to add a `query`; re-import |
| Clicking a bar does nothing | The data view `ia-workqueue-items*` is missing or renamed |
| Figures a day out against the React app | Kibana ends on today, the React app on its last day of data; set the picker end to match |
| Serif or Courier text | The panel was opened outside a Kibana page |

To report a problem: dashboard, panel, a screenshot, and for an error the panel's Inspect > Requests.

## Looking at it before access or data

`kibana/mock/` holds the same dashboards and panels with demonstration data (as at 14 July 2026) built into each panel, so they need no index, no Dev Tools and no Logstash. Two ways in:

- **Import**: Saved Objects > Import > `kibana/mock/ia-dashboards-mock.ndjson`. Ten dashboards titled "IA mock · …", alongside and separate from the real ones. Delete them (search "IA mock") once real data is flowing.
- **One panel at a time**, if you can create visualisations but not import: Visualize Library > Create visualization > Custom visualization (Vega), clear the editor, paste a file from `kibana/mock/panels/<dashboard>/` and Update. This needs "Store URLs in session storage" on (section 3).

The data is fixed, so the time picker, controls and click-to-filter don't change anything, and Process detail stays on its chooser. The Executive Summary panels are large (up to 1.5 MB), so paste those via import if you can.

## How it behaves

- **Time picker.** Dashboards open on the last 90 days. Executive Summary and Service use only the end of the picker: fiscal year to date, and "now", as at that moment. Setting the end in the past replays it.
- **Filtering.** Panels follow the controls, query bar and time picker. Clicking a process (or a spoke on Alerts) adds a dashboard filter; remove it from the filter bar.
- **One spoke** selected in the Spoke control gives the hub view on Executive Summary and spoke targets everywhere. Two or more count as the estate.
- **Panel height.** Panels are sized to fit; a table with more rows than fit says "+N more". Full screen (top right) gives every panel more room.
- **Don't edit a panel's Vega in Kibana.** The next import overwrites it.

## Sharing as PDF

Platinum includes PDF and PNG reports: Share > PDF reports on any dashboard, ticking "Optimize for printing" for A4 pages. Panels render exactly as on screen. To email one on a schedule on 8.x, use a watch with a `reporting` attachment (Elastic's "Automatically generate reports" guide).

## Alerting on targets

Service alerts are covered in [JOBS.md](JOBS.md). The Alerts dashboard is read-only; to be notified of a target breach, create an Elasticsearch query rule under Stack Management > Rules on `ia-workqueue-items*` (for example the count of `exception.type: System` over 7 days against a threshold). Acknowledge and snooze live on the rule.
