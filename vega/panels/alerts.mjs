// Alerts: performance against target. Breaches and early warnings over the
// trailing 7 days, ranked by money at stake. Operational problems (data,
// queues, workers) are on the Service dashboard.
// React source: src/alerts/AlertsPage.tsx + engine.ts
// Acknowledge / snooze are state the React app kept per user; in Kibana that
// job belongs to alerting rules (publish/docs/KIBANA.md), so this register is
// read-only.
import { C, FONT } from "../lib/tokens.mjs";
import { merge, frame, kpiTiles, emptyNote, PAD } from "../lib/kit.mjs";
import { F } from "../lib/fmt.mjs";
import { targetsBlock, spokeColours, spokeColorExpr } from "../lib/blocks.mjs";
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
      { type: "text", encode: { update: { x: { value: PAD + 240 }, y: { value: 26 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12.5 }, fill: { value: C.inkSoft }, text: { signal: "'All scopes below, trailing ' + alWindow + (oneSpoke ? ' · estate plus ' + oneSpoke : ' · estate-wide, ignores dashboard filters other than a single spoke')" } } } },
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

// The register's rows, scoped as the register scopes them (a single selected
// spoke shows the estate plus that spoke).
const scoped = { name: "al_sc", source: "alerts", transform: [{ type: "filter", expr: "!oneSpoke || datum.kind === 'estate' || datum.spoke === oneSpoke" }] };

const kpis = () =>
  merge(processCatalogue(), targetsBlock(), alertsRows(), {
    data: [
      scoped,
      // one row per scope: its worst severity and its money at stake, counted once
      {
        name: "al_scope",
        source: "al_sc",
        transform: [
          { type: "formula", as: "sr", expr: "datum.metric === 'costPerCase' ? 0 : datum.atStake" },
          { type: "formula", as: "sc", expr: "datum.metric === 'costPerCase' ? datum.atStake : 0" },
          { type: "aggregate", groupby: ["kind", "label"], ops: ["min", "max", "max"], fields: ["sevOrder", "sr", "sc"], as: ["sev", "sr", "sc"] },
          { type: "formula", as: "pb", expr: "datum.kind === 'process' && datum.sev === 0 ? 1 : 0" },
          { type: "formula", as: "pw", expr: "datum.kind === 'process' && datum.sev === 1 ? 1 : 0" },
          { type: "formula", as: "sb", expr: "datum.kind === 'spoke' && datum.sev === 0 ? 1 : 0" },
          { type: "formula", as: "vb", expr: "datum.kind === 'vdi' && datum.sev === 0 ? 1 : 0" },
          { type: "formula", as: "money", expr: "datum.kind === 'process' ? datum.sr + datum.sc : 0" },
          { type: "aggregate", ops: ["sum", "sum", "sum", "sum", "sum"], fields: ["pb", "pw", "sb", "vb", "money"], as: ["pb", "pw", "sb", "vb", "money"] },
        ],
      },
      {
        name: "tiles",
        values: [
          { i: 0, label: "Processes off target" },
          { i: 1, label: "Processes close to target" },
          { i: 2, label: "Money at stake, 7 days" },
          { i: 3, label: "Hubs off target" },
          { i: 4, label: "Workers outside the band" },
        ],
        transform: [
          { type: "formula", as: "t", expr: "length(data('al_scope')) ? data('al_scope')[0] : {pb: 0, pw: 0, sb: 0, vb: 0, money: 0}" },
          { type: "formula", as: "value", expr: `['' + datum.t.pb, '' + datum.t.pw, ${F.gbp("datum.t.money")}, '' + datum.t.sb, '' + datum.t.vb][datum.i]` },
          { type: "formula", as: "sub", expr: "['breaching at least one target', 'within 10% of a target, processes only', 'rework plus cost above target', 'at hub level', 'utilisation below the floor or above the ceiling'][datum.i]" },
          { type: "formula", as: "delta", expr: "null" },
          { type: "formula", as: "target", expr: "''" },
          { type: "formula", as: "met", expr: "true" },
        ],
      },
    ],
  }, kpiTiles({ n: 5 }));

// Hub by metric: where each hub is off target, and how many of its processes
// are behind it. Click a hub to filter.
const METRICS = [
  { k: "completionPct", label: "Completion" },
  { k: "exceptionRate", label: "Exception rate" },
  { k: "systemRate", label: "System exceptions" },
  { k: "costPerCase", label: "Cost per item" },
  { k: "utilisation", label: "Worker utilisation" },
];
const matrix = () =>
  merge(processCatalogue(), targetsBlock(), alertsRows(), spokeColours(), frame({ title: "Hubs against target", subtitle: "Trailing 7 days · the cell is the hub's own position; the count is how many of its processes or workers are off target on that measure · click a hub to filter" }), {
    data: [
      scoped,
      { name: "mx_hub", source: "al_sc", transform: [{ type: "filter", expr: "datum.kind === 'spoke'" }, { type: "formula", as: "key", expr: "datum.label + '|' + datum.metric" }] },
      {
        name: "mx_cnt",
        source: "al_sc",
        transform: [
          { type: "filter", expr: "datum.kind === 'process' || datum.kind === 'vdi'" },
          { type: "formula", as: "b", expr: "datum.sevOrder === 0 ? 1 : 0" },
          { type: "formula", as: "w", expr: "datum.sevOrder === 1 ? 1 : 0" },
          { type: "aggregate", groupby: ["spoke", "metric"], ops: ["sum", "sum"], fields: ["b", "w"], as: ["b", "w"] },
          { type: "formula", as: "key", expr: "datum.spoke + '|' + datum.metric" },
        ],
      },
      {
        name: "mx_rows",
        source: "spk",
        transform: [
          { type: "filter", expr: "!oneSpoke || datum.name === oneSpoke" },
          
          { type: "formula", as: "nb", expr: `${METRICS.map((m) => `(indexof(pluck(data('mx_cnt'), 'key'), datum.name + '|${m.k}') >= 0 ? data('mx_cnt')[indexof(pluck(data('mx_cnt'), 'key'), datum.name + '|${m.k}')].b : 0)`).join(" + ")}` },
          { type: "formula", as: "hb", expr: `${METRICS.map((m) => `(indexof(pluck(data('mx_hub'), 'key'), datum.name + '|${m.k}') >= 0 && data('mx_hub')[indexof(pluck(data('mx_hub'), 'key'), datum.name + '|${m.k}')].sevOrder === 0 ? 1 : 0)`).join(" + ")}` },
          { type: "collect", sort: { field: ["hb", "nb", "name"], order: ["descending", "descending", "ascending"] } },
          { type: "window", ops: ["row_number"], as: ["r"] },
        ],
      },
      {
        name: "mx",
        source: "mx_rows",
        transform: [
          { type: "formula", as: "ms", expr: `[${METRICS.map((m, i) => `{k: '${m.k}', i: ${i}}`).join(", ")}]` },
          { type: "flatten", fields: ["ms"], as: ["m"] },
          { type: "formula", as: "key", expr: "datum.name + '|' + datum.m.k" },
          { type: "lookup", from: "mx_hub", key: "key", fields: ["key"], values: ["severity", "vText", "thText"], as: ["hs", "hv", "ht"] },
          { type: "lookup", from: "mx_cnt", key: "key", fields: ["key"], values: ["b", "w"], as: ["cb", "cw"], default: 0 },
          { type: "formula", as: "st", expr: "datum.hs === 'breach' ? 'act' : datum.hs === 'warn' || datum.cb > 0 ? 'warn' : 'ok'" },
          {
            type: "formula",
            as: "txt",
            expr: "(datum.hs ? datum.hv + ' vs ' + datum.ht : (datum.m.k === 'utilisation' ? 'In band' : 'On target')) + (datum.cb ? ' · ' + datum.cb + ' off' : '') + (datum.cw ? ' · ' + datum.cw + ' close' : '')",
          },
        ],
      },
    ],
    signals: [
      { name: "mxLabelW", update: "clamp(cw * 0.2, 170, 280)" },
      { name: "mxColW", update: `(cw - mxLabelW) / ${METRICS.length}` },
      { name: "mxRowH", update: "clamp((ch - 24) / max(1, length(data('mx_rows'))), 26, 46)" },
      { name: "pickMx", on: [{ events: "@mx_label:click", update: addFilter("spoke.name", "datum.name") }] },
    ],
    marks: [
      ...METRICS.map((m, i) => ({ type: "text", encode: { update: { x: { signal: `${PAD} + mxLabelW + ${i} * mxColW + 10` }, y: { signal: "top + 8" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: m.label.toUpperCase() } } } })),
      { type: "rect", from: { data: "mx_rows" }, encode: { update: { x: { value: PAD }, y: { signal: "top + 24 + (datum.r - 1) * mxRowH + mxRowH / 2 - 6" }, width: { value: 4 }, height: { value: 12 }, cornerRadius: { value: 2 }, fill: { signal: spokeColorExpr("datum.name") } } } },
      { type: "text", name: "mx_label", from: { data: "mx_rows" }, encode: { update: { x: { value: PAD + 12 }, y: { signal: "top + 24 + (datum.r - 0.5) * mxRowH" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { field: "name" }, limit: { signal: "mxLabelW - 20" }, cursor: { value: "pointer" } } } },
      {
        type: "rect",
        from: { data: "mx" },
        encode: {
          update: {
            x: { signal: `${PAD} + mxLabelW + datum.m.i * mxColW + 2` },
            width: { signal: "mxColW - 4" },
            y: { signal: "top + 24 + (datum.r - 1) * mxRowH + 2" },
            height: { signal: "mxRowH - 4" },
            cornerRadius: { value: 6 },
            fill: { signal: `datum.st === 'act' ? '${C.badFill}' : datum.st === 'warn' ? '${C.warnFill}' : '${C.goodFill}'` },
            tooltip: { signal: "{'Hub': datum.name, 'Measure': datum.m.k, 'Position': datum.txt}" },
          },
        },
      },
      {
        type: "text",
        from: { data: "mx" },
        interactive: false,
        encode: {
          update: {
            x: { signal: `${PAD} + mxLabelW + datum.m.i * mxColW + 12` },
            y: { signal: "top + 24 + (datum.r - 0.5) * mxRowH" },
            baseline: { value: "middle" },
            font: { value: FONT.mono },
            fontSize: { value: 11 },
            fontWeight: { signal: "datum.st === 'ok' ? 'normal' : 600" },
            fill: { signal: `datum.st === 'act' ? '${C.bad}' : datum.st === 'warn' ? '${C.warn}' : '${C.good}'` },
            text: { field: "txt" },
            limit: { signal: "mxColW - 22" },
          },
        },
      },
      emptyNote("!length(data('mx_rows'))", "No hubs in this selection"),
    ],
  });

export const dashboard = {
  id: "alerts",
  title: "IA · Alerts",
  description: "Performance against target, trailing 7 days, ranked by money at stake",
  time: { from: "now-89d/d", to: "now" },
  states: ["spoke"],
  panels: [
    { id: "kpis", title: "Alert KPIs", grid: { x: 0, y: 0, w: 48, h: 5 }, build: kpis },
    { id: "matrix", title: "Hubs against target", grid: { x: 0, y: 5, w: 48, h: 12 }, build: matrix },
    { id: "register", title: "Alert register", grid: { x: 0, y: 17, w: 48, h: 36 }, build: register },
  ],
};
