// Alerts: performance against target. Breaches and early warnings over the
// trailing 7 days, ranked by money at stake. Operational problems (data,
// queues, workers) are on the Service dashboard.
// React source: src/alerts/AlertsPage.tsx + engine.ts
// Acknowledge / snooze are state the React app kept per user; in Kibana that
// job belongs to alerting rules (docs/KIBANA-SETUP.md), so this register is
// read-only.
import { C, FONT } from "../lib/tokens.mjs";
import { merge, PAD } from "../lib/kit.mjs";
import { F } from "../lib/fmt.mjs";
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
        // one row per process, spoke or worker, listing every metric it breaches,
        // so the money at stake is counted once. Processes first: they are what
        // someone can act on; spoke and estate rows summarise them.
        name: "shown",
        source: "alerts",
        transform: [
          { type: "filter", expr: "!oneSpoke || datum.kind === 'estate' || datum.spoke === oneSpoke" },
          { type: "formula", as: "short", expr: "datum.metricName + ' ' + datum.vText + (datum.direction === 'min' ? ' (floor ' : ' (ceiling ') + datum.thText + ')'" },
          { type: "formula", as: "sr", expr: "datum.metric === 'costPerCase' ? 0 : datum.atStake" },
          { type: "formula", as: "sc", expr: "datum.metric === 'costPerCase' ? datum.atStake : 0" },
          { type: "aggregate", groupby: ["kind", "label", "spoke"], ops: ["min", "max", "max", "values"], fields: ["sevOrder", "sr", "sc", "short"], as: ["sevOrder", "sr", "sc", "items"] },
          { type: "formula", as: "severity", expr: "datum.sevOrder === 0 ? 'breach' : 'warn'" },
          { type: "formula", as: "atStake", expr: "datum.sr + datum.sc" },
          { type: "formula", as: "stakeKind", expr: "datum.sr && datum.sc ? 'REWORK + COST ABOVE TARGET' : datum.sc ? 'COST ABOVE TARGET' : 'REWORK EXPOSURE'" },
          { type: "formula", as: "id", expr: "datum.items[0].id" },
          { type: "formula", as: "headline", expr: "(datum.kind === 'estate' ? 'Estate' : datum.label)" },
          { type: "formula", as: "context", expr: "join(pluck(datum.items, 'short'), ' · ') + (datum.kind === 'process' ? ' · ' + datum.spoke : '')" },
          { type: "formula", as: "scopeOrder", expr: "indexof(['process', 'spoke', 'estate', 'vdi'], datum.kind)" },
          { type: "collect", sort: { field: ["sevOrder", "scopeOrder", "atStake", "label"], order: ["ascending", "ascending", "descending", "ascending"] } },
          { type: "window", ops: ["row_number"], as: ["n"] },
          { type: "formula", as: "group", expr: "(datum.severity === 'breach' ? 'BREACHES' : 'WARNINGS') + ' · ' + ({'estate': 'ESTATE', 'spoke': 'SPOKES', 'process': 'PROCESSES', 'vdi': 'DIGITAL WORKER UTILISATION'})[datum.kind]" },
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
      { type: "text", encode: { update: { x: { value: PAD }, y: { value: 26 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fontWeight: { value: 600 }, fill: { value: C.bad }, text: { signal: "'▲ ' + (indexof(pluck(data('sev'), 'severity'), 'breach') >= 0 ? data('sev')[indexof(pluck(data('sev'), 'severity'), 'breach')].n : 0) + ' in breach'" } } } },
      { type: "text", encode: { update: { x: { value: PAD + 120 }, y: { value: 26 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fontWeight: { value: 600 }, fill: { value: C.warn }, text: { signal: "'△ ' + (indexof(pluck(data('sev'), 'severity'), 'warn') >= 0 ? data('sev')[indexof(pluck(data('sev'), 'severity'), 'warn')].n : 0) + ' near a limit'" } } } },
      { type: "text", encode: { update: { x: { value: PAD + 240 }, y: { value: 26 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12.5 }, fill: { value: C.inkSoft }, text: { signal: "'Trailing ' + alWindow + (oneSpoke ? ' · estate plus ' + oneSpoke : ' · estate-wide, ignores dashboard filters other than a single spoke')" } } } },
      ...["process", "spoke", "estate", "vdi"].flatMap((k, i) => [
        { type: "rect", encode: { update: { x: { value: PAD + 70 + i * 104 }, y: { value: 46 }, width: { value: 96 }, height: { value: 24 }, cornerRadius: { value: 14 }, fill: { value: C.band }, stroke: { value: C.rule } } } },
        { type: "text", encode: { update: { x: { value: PAD + 70 + i * 104 + 48 }, y: { value: 58 }, align: { value: "center" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { signal: `'${k.toUpperCase()} · ' + (indexof(pluck(data('counts'), 'kind'), '${k}') >= 0 ? data('counts')[indexof(pluck(data('counts'), 'kind'), '${k}')].n : 0)` } } } },
      ]),
      { type: "text", encode: { update: { x: { value: PAD }, y: { value: 58 }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: "SCOPE" } } } },
      { type: "rule", encode: { update: { x: { value: PAD }, x2: { signal: `width - ${PAD}` }, y: { value: 84 }, stroke: { value: C.rule } } } },
      {
        type: "text",
        from: { data: "grpPos" },
        encode: { update: { x: { value: PAD }, y: { signal: "listTop + datum.y - 12" }, baseline: { value: "bottom" }, font: { value: FONT.mono }, fontSize: { value: 11 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { signal: "datum.group + ' · ' + datum.count" } } },
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
          { type: "text", encode: { update: { x: { value: 0 }, y: { value: 10 }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { signal: `parent.severity === 'breach' ? '${C.bad}' : '${C.warn}'` }, text: { signal: "parent.severity === 'breach' ? '⚠ BREACH' : '△ WARNING'" } } } },
          { type: "text", encode: { update: { x: { value: 0 }, y: { value: 30 }, baseline: { value: "middle" }, font: { value: FONT.display }, fontSize: { value: 15 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { field: { parent: "headline" } }, limit: { signal: "item.mark.group.width - 140" } } } },
          { type: "text", encode: { update: { x: { value: 0 }, y: { value: 46 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 11.5 }, fill: { value: C.inkSoft }, text: { field: { parent: "context" } }, limit: { signal: "item.mark.group.width - 260" } } } },
          { type: "text", encode: { update: { x: { signal: "item.mark.group.width - 124" }, y: { value: 24 }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.display }, fontSize: { value: 15 }, fontWeight: { value: 600 }, fill: { signal: `parent.severity === 'breach' ? '${C.bad}' : '${C.warn}'` }, text: { signal: `parent.atStake >= 1 ? ${F.gbpc("parent.atStake")} : ''` } } } },
          { type: "text", encode: { update: { x: { signal: "item.mark.group.width - 124" }, y: { value: 42 }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 9.5 }, fill: { value: C.inkSoft }, text: { signal: "parent.atStake >= 1 ? parent.stakeKind : ''" } } } },
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
      { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "height - 14" }, font: { value: FONT.body }, fontSize: { value: 11.5 }, fill: { value: C.inkSoft }, text: { value: "Ranked by money at stake over the 7 days: rework exposure for rate breaches, cost above target for cost per item. Click a spoke or process to filter to it." } } } },
    ],
  });

export const dashboard = {
  id: "alerts",
  title: "IA · Alerts",
  description: "Performance against target, trailing 7 days, ranked by money at stake",
  time: { from: "now-89d/d", to: "now" },
  states: ["spoke"],
  panels: [{ id: "register", title: "Alert register", grid: { x: 0, y: 0, w: 48, h: 40 }, build: register }],
};
