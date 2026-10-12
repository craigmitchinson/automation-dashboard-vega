# Setting it up in Kibana 8

Target: Kibana 8.x with the Vega visualisation enabled (it is by default). The import file is written in the 8.15 saved-object format, and Kibana migrates older formats forward on import. Nothing here needs a plugin, a server or a licence above Basic.

## 1. Before the dashboards: the data

1. Create the index templates: in Dev Tools, run `PUT _index_template/ia-workqueue-items` with the body of `etl/index-templates/ia-workqueue-items.json`, and the same for the other three.
2. Load reference data: `node etl/reference-impl/reference-ndjson.mjs > ref.ndjson`, then `_bulk` it.
3. Either run the ETL (docs/DATA-CONTRACT.md) or, to see the dashboards first, run `npm run mock` and `_bulk` the four files in `mock/` (the items file is about 325 MB; split it or use `elasticsearch-loader` if your proxy limits request size).

## 2. Import

Go to Stack Management > Saved objects > Import, and choose `dist/kibana/ia-dashboards.ndjson`. It creates:

- the data view `ia-workqueue-items*` (time field `@timestamp`);
- 46 Vega visualisations, one per panel, titled "IA · <dashboard> · <panel>";
- a markdown navigation strip, grouped Run, Manage and Money;
- nine dashboards (`ia-service`, `ia-process-detail`, `ia-overview`, `ia-process-analysis`, `ia-exceptions`, `ia-capacity`, `ia-alerts`, `ia-exec`, `ia-value-finance`), each with Spoke, Proposition, Process, Queue and Tags controls and panel titles hidden.

If the import complains about the controls (their format changed several times across 8.x), delete `controlGroupInput` from the dashboard objects and add the five options-list controls by hand on one dashboard. Then copy that dashboard's controls to the others.

## 3. Things to set once

- **Light theme.** The panels use the Platform Health light palette (white surface, deep teal ink). Under Kibana's dark theme they read as light cards on a dark page, which works but isn't the design.
- **Links panel (8.12 and later).** Replace the markdown navigation strip with a Links panel that points at the nine dashboards, with "Use filters and query from origin dashboard" and "Use date range from origin dashboard" ticked. That is what lets a process clicked on Overview carry through to Process detail. The markdown strip keeps the time range but not the filters.
- **Pinned filters.** The alternative to the Links panel: pin a filter (the pin icon on the filter pill) and it follows you to every dashboard.
- **Time picker.** Dashboards open on `now-89d/d → now`, which matches the React app's "last 90 days". Executive Summary uses only the end of the picker: it always shows the fiscal year to date as at that day. Service opens on the last 24 hours and also uses only the end.

## 4. How the panels behave in Kibana

| React app | Kibana build |
|---|---|
| Slicer bar | Kibana controls plus the query bar. Every panel reads them through `%context%` or the `%dashboard_context-*%` clauses. |
| Click a bar or row to filter | Same: `kibanaAddFilter` adds a dashboard filter on `process.name` (or `spoke.name` from Alerts). Remove it from the filter bar. |
| Click through to Process detail | Click to filter, then the Links panel (or a pinned filter) carries it to Process detail. |
| Executive Summary hub switch | Pick one spoke in the Spoke control. Two or more spokes count as the estate view. |
| What-if rate slider | Dropped with the Commercial page: a Vega panel can only change itself. |
| Input & Outcome, Commercial pages | Retired: their charts are on Overview and Value & Finance. |
| Search box on Exception detail | Vega input, drawn by Kibana under the panel |
| Scrolling tables | Panels are sized to fit today's rows. If rows don't fit, the panel says "+N more"; make it taller in edit mode. |
| Acknowledge, snooze, alert bell | Not in Vega. Use alerting rules (section 5). |
| Saved views, command palette, accessibility panel, admin | Kibana's own saved queries, dashboard search and theme settings. Reference data is edited in reference.json. |

## 5. Alerting rules (the bell and acknowledge)

For the run team, use the Service checks instead of hand-built rules: a 15-minute job and four ready-made rules, set up in docs/SERVICE.md. What follows is for alerting on the performance thresholds on the Alerts dashboard.


The Alerts dashboard shows the same breaches and warnings as the React app, but it is read-only. For notifications, create Elasticsearch query rules under Stack Management > Rules. One per estate metric is enough to start, for example the completion floor:

- Index `ia-workqueue-items*`, time field `@timestamp`, window 7 days, check every hour.
- Query `mapped: true`. Use a threshold condition on a `sum` of `n.completed` against a `sum` of `n.attempt`. On Basic, a rule can only compare one aggregate with a constant, so either alert on the exception count, or add a scheduled transform that writes the daily rates.
- Acknowledging and snoozing then happen on the rule, which is where they live in Kibana.

## 6. Changing a panel

The specs are generated. Don't hand-edit the JSON inside Kibana, or the next import overwrites the change.

1. Edit `vega/panels/<dashboard>.mjs` (layout, measures, wording) or `vega/lib/tokens.mjs` (colours, fonts).
2. Run `npm run build`, then `npm test` (every spec parses; no duplicate datasets).
3. Run `npm run preview` (needs `npm run mock` once). It runs every query against the mock data and writes `docs/previews/*.png`.
4. Re-import `dist/kibana/ia-dashboards.ndjson` with "Overwrite" ticked. For a single panel, paste `dist/specs/<dashboard>/<panel>.vg.json` into that visualisation.

Colours, fonts and every number format live in `vega/lib/tokens.mjs` and `vega/lib/fmt.mjs`, so the look stays consistent across 46 panels.

## 7. If something is wrong

| Symptom | Likely cause |
|---|---|
| Panel shows a red Vega error mentioning `%context%` | The spec was edited to add `query` to a `%context%` body. Kibana allows one or the other. |
| Panel blank, no error | No mapped items in the window, or the index pattern in the spec doesn't match your index names (`vega/lib/tokens.mjs` `IDX`). |
| Money panels £0 | Stage 2 hasn't run. Check for `cost.estate_gbp` in Discover. |
| Clicking a bar does nothing | `kibanaAddFilter` needs the data view title `ia-workqueue-items*` to exist (it is created by the import). |
| Numbers a day out against the React app | Picker vs data end: the React app anchors on the last day with data, Kibana on today. Set the picker end to the last data day to compare. |
| Fonts look different | Specs follow Platform Health: Fraunces (falls back to Cambria/Georgia) for titles and figures, Inter (Kibana ships it) or Segoe UI for text, JetBrains Mono or Consolas for labels. |

## 8. Upgrading from the 11-dashboard import

`ia-input-outcome` and `ia-commercial` and their visualisations are no longer in the import. Re-importing with "Overwrite" updates everything else; delete those two dashboards and their `IA · Input & Outcome · …` and `IA · Commercial Performance · …` visualisations by hand under Saved objects.
