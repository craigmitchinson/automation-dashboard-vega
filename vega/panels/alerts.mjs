// Alerts: threshold breaches and early warnings across the estate.
// React source: src/alerts/AlertsPage.tsx + engine.ts
// Acknowledge / snooze are state the React app kept per user; in Kibana that
// job belongs to alerting rules (docs/KIBANA-SETUP.md), so this register is
// read-only.
import { C, FONT } from "../lib/tokens.mjs";
import { merge, PAD } from "../lib/kit.mjs";
import { targetsBlock } from "../lib/blocks.mjs";
import { processCatalogue, addFilter } from "../lib/common.mjs";
import { alertsRows } from "../lib/alerts.mjs";

const D = 86400000;

const register = () =>
  merge(processCatalogue(), targetsBlock(), alertsRows(), {
    signals: [
      { name: "rowH", value: 58 },
      { name: "secH", value: 36 },
      { name: "listTop", value: 92 },
      { name: "fitRows", update: "max(1, floor((height - listTop - 40) / rowH) - 4)" },
      { name: "pick", on: [{ events: "@al_row:click", update: "datum.kind === 'process' ? " + addFilter("process.name", "datum.label") + " : datum.kind === 'spoke' ? " + addFilter("spoke.name", "datum.label") + " : null" }] },
    ],
    data: [
      {
        name: "shown",
        source: "alerts",
        transform: [
          { type: "filter", expr: "!oneSpoke || datum.kind === 'estate' || datum.spoke === oneSpoke" },
          { type: "window", ops: ["row_number"], as: ["n"] },
          { type: "formula", as: "group", expr: "(datum.severity === 'breach' ? 'BREACHES' : 'WARNINGS') + ' · ' + (datum.kind === 'estate' ? 'ESTATE' : datum.kind === 'vdi' ? 'DIGITAL WORKERS' : upper(datum.kind === 'spoke' ? datum.label : datum.spoke))" },
        ],
      },
      {
        name: "grp",
        source: "shown",
        transform: [{ type: "aggregate", groupby: ["group"], ops: ["min", "count"], fields: ["n", "n"], as: ["first", "count"] }, { type: "collect", sort: { field: "first" } }, { type: "window", ops: ["row_number"], as: ["gi"] }],
      },
      {
        name: "rows",
        source: "shown",
        transform: [
          { type: "lookup", from: "grp", key: "group", fields: ["group"], values: ["gi"], as: ["gi"] },
          { type: "formula", as: "y", expr: "(datum.n - 1) * rowH + datum.gi * secH" },
          { type: "filter", expr: "datum.y + rowH <= height - listTop - 36" },
        ],
      },
      { name: "grpPos", source: "rows", transform: [{ type: "aggregate", groupby: ["group", "gi"], ops: ["min"], fields: ["y"], as: ["y"] }, { type: "lookup", from: "grp", key: "group", fields: ["group"], values: ["count"], as: ["count"] }] },
      {
        name: "counts",
        source: "shown",
        transform: [{ type: "aggregate", groupby: ["kind"], ops: ["count"], as: ["n"] }],
      },
      {
        name: "sev",
        source: "shown",
        transform: [{ type: "aggregate", groupby: ["severity"], ops: ["count"], as: ["n"] }],
      },
      {
        // per-day values for each visible alert's sparkline
        name: "spark",
        source: "al_days",
        transform: [
          { type: "formula", as: "completionPct", expr: "datum.a ? datum.c / datum.a : null" },
          { type: "formula", as: "exceptionRate", expr: "datum.a ? datum.e / datum.a : null" },
          { type: "formula", as: "systemRate", expr: "datum.a ? datum.s / datum.a : null" },
          { type: "formula", as: "costPerCase", expr: "datum.c ? datum.ec / datum.c : null" },
          { type: "fold", fields: ["completionPct", "exceptionRate", "systemRate", "costPerCase"], as: ["metric", "v"] },
          { type: "formula", as: "id", expr: "datum.kind + '|' + datum.label + '|' + datum.metric" },
          { type: "lookup", from: "rows", key: "id", fields: ["id"], values: ["y", "severity"], as: ["y", "sev"] },
          { type: "filter", expr: "isValid(datum.y) && isValid(datum.v)" },
          { type: "formula", as: "d", expr: `(datum.t - (ahi - ${6 * D})) / ${D}` },
        ],
      },
    ],
    marks: [
      { type: "text", encode: { update: { x: { value: PAD }, y: { value: 26 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fontWeight: { value: "bold" }, fill: { value: C.bad }, text: { signal: "'▲ ' + (indexof(pluck(data('sev'), 'severity'), 'breach') >= 0 ? data('sev')[indexof(pluck(data('sev'), 'severity'), 'breach')].n : 0) + ' breaches'" } } } },
      { type: "text", encode: { update: { x: { value: PAD + 120 }, y: { value: 26 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fontWeight: { value: "bold" }, fill: { value: C.warn }, text: { signal: "'△ ' + (indexof(pluck(data('sev'), 'severity'), 'warn') >= 0 ? data('sev')[indexof(pluck(data('sev'), 'severity'), 'warn')].n : 0) + ' warnings'" } } } },
      { type: "text", encode: { update: { x: { value: PAD + 240 }, y: { value: 26 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12.5 }, fill: { value: C.inkSoft }, text: { signal: "'Trailing ' + alWindow + (oneSpoke ? ' · estate plus ' + oneSpoke : ' · estate-wide, ignores dashboard filters other than a single spoke')" } } } },
      ...["estate", "spoke", "process", "vdi"].flatMap((k, i) => [
        { type: "rect", encode: { update: { x: { value: PAD + 70 + i * 104 }, y: { value: 46 }, width: { value: 96 }, height: { value: 24 }, cornerRadius: { value: 14 }, fill: { value: C.band }, stroke: { value: C.rule } } } },
        { type: "text", encode: { update: { x: { value: PAD + 70 + i * 104 + 48 }, y: { value: 58 }, align: { value: "center" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fontWeight: { value: "bold" }, fill: { value: C.inkSoft }, text: { signal: `'${k.toUpperCase()} · ' + (indexof(pluck(data('counts'), 'kind'), '${k}') >= 0 ? data('counts')[indexof(pluck(data('counts'), 'kind'), '${k}')].n : 0)` } } } },
      ]),
      { type: "text", encode: { update: { x: { value: PAD }, y: { value: 58 }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fontWeight: { value: "bold" }, fill: { value: C.inkSoft }, text: { value: "SCOPE" } } } },
      { type: "rule", encode: { update: { x: { value: PAD }, x2: { signal: `width - ${PAD}` }, y: { value: 84 }, stroke: { value: C.rule } } } },
      {
        type: "text",
        from: { data: "grpPos" },
        encode: { update: { x: { value: PAD }, y: { signal: "listTop + datum.y - 12" }, baseline: { value: "bottom" }, font: { value: FONT.mono }, fontSize: { value: 11 }, fontWeight: { value: "bold" }, fill: { value: C.inkSoft }, text: { signal: "datum.group + ' · ' + datum.count" } } },
      },
      {
        type: "group",
        name: "al_row",
        from: { data: "rows" },
        encode: {
          update: { x: { value: PAD }, y: { signal: "listTop + datum.y" }, width: { signal: `width - ${2 * PAD}` }, height: { signal: "rowH - 4" }, fill: { value: "transparent" }, cursor: { signal: "datum.kind === 'process' || datum.kind === 'spoke' ? 'pointer' : 'default'" } },
          hover: { fill: { value: C.band } },
        },
        marks: [
          { type: "rule", encode: { update: { x: { value: 0 }, x2: { signal: "item.mark.group.width" }, y: { signal: "rowH - 4" }, stroke: { value: C.rule } } } },
          { type: "text", encode: { update: { x: { value: 0 }, y: { value: 10 }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: "bold" }, fill: { signal: `parent.severity === 'breach' ? '${C.bad}' : '${C.warn}'` }, text: { signal: "parent.severity === 'breach' ? '⚠ BREACH' : '△ WARNING'" } } } },
          { type: "text", encode: { update: { x: { value: 0 }, y: { value: 30 }, baseline: { value: "middle" }, font: { value: FONT.display }, fontSize: { value: 15 }, fontWeight: { value: "bold" }, fill: { value: C.ink }, text: { field: { parent: "headline" } }, limit: { signal: "item.mark.group.width - 140" } } } },
          { type: "text", encode: { update: { x: { value: 0 }, y: { value: 46 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 11.5 }, fill: { value: C.inkSoft }, text: { field: { parent: "context" } } } } },
        ],
      },
      {
        type: "group",
        from: { facet: { data: "spark", name: "sp", groupby: ["id", "y", "sev"] } },
        encode: { update: { x: { signal: `width - ${PAD} - 110` }, y: { signal: "listTop + datum.y + 12" }, width: { value: 100 }, height: { value: 28 } } },
        scales: [
          { name: "spx", type: "linear", domain: [0, 6], range: [2, 98] },
          { name: "spy", type: "linear", domain: { data: "sp", field: "v" }, range: [26, 2], zero: false, padding: 2 },
        ],
        marks: [
          { type: "line", from: { data: "sp" }, encode: { update: { x: { scale: "spx", field: "d" }, y: { scale: "spy", field: "v" }, stroke: { signal: `parent.sev === 'breach' ? '${C.bad}' : '${C.warn}'` }, strokeWidth: { value: 1.6 } } } },
        ],
      },
      { type: "text", encode: { update: { x: { signal: `width - ${PAD}` }, y: { signal: "height - 14" }, align: { value: "right" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.inkSoft }, text: { signal: "length(data('shown')) > length(data('rows')) ? '+' + (length(data('shown')) - length(data('rows'))) + ' more: filter to a spoke, or make the panel taller' : ''" } } } },
      { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "height - 14" }, font: { value: FONT.body }, fontSize: { value: 11.5 }, fill: { value: C.inkSoft }, text: { value: "Click a spoke or process alert to filter to it. Acknowledge, snooze and notifications are handled by Kibana alerting rules." } } } },
    ],
  });

export const dashboard = {
  id: "alerts",
  title: "IA · Alerts",
  description: "Threshold breaches and early warnings across the estate",
  time: { from: "now-89d/d", to: "now" },
  states: ["spoke"],
  panels: [{ id: "register", title: "Alert register", grid: { x: 0, y: 0, w: 48, h: 40 }, build: register }],
};
