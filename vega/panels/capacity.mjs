// VDI & Capacity: digital-worker utilisation, idle time and estate cost.
// React source: src/pages/Capacity.tsx
import { C, FONT, IDX } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, kpiTiles, table, PAD } from "../lib/kit.mjs";
import { targetsBlock, spokeColours, spokeColorExpr } from "../lib/blocks.mjs";
import { ctx, plain, MAPPED } from "../lib/es.mjs";

// One row per digital worker: activity on the filtered work, licensed hours
// in the window, utilisation. Signals: nActive, nAll, sumAvail, sumActive,
// sumIdle, avgUtil, sumCost.
export function vdiBlock() {
  return {
    data: [
      ctx("act_raw", {
        body: {
          aggs: {
            m: {
              filter: { bool: { filter: [MAPPED, { exists: { field: "resource.name" } }] } },
              aggs: { r: { terms: { field: "resource.name", size: 500 }, aggs: { w: { sum: { field: "worktime_sec" } }, ec: { sum: { field: "cost.estate_gbp" } }, np: { cardinality: { field: "process.name" } } } } },
            },
          },
        },
        property: "aggregations.m.r.buckets",
      }),
      ctx("scope_all", { body: { aggs: { m: { filter: MAPPED, aggs: { s: { terms: { field: "spoke.name", size: 100 } } } } } }, property: "aggregations.m.s.buckets" }),
      plain("avail_raw", {
        index: IDX.vdiDaily,
        body: {
          query: { range: { "@timestamp": { "%timefilter%": true } } },
          aggs: { r: { terms: { field: "resource.name", size: 500 }, aggs: { h: { sum: { field: "operating_hours" } }, o: { terms: { field: "resource.owner_spoke", size: 1 } } } } },
        },
        property: "aggregations.r.buckets",
      }),
      plain("ref_spoke_count", { index: IDX.ref, body: { size: 0, query: { term: { doc_type: "spoke" } } }, property: "hits.total" }),
      {
        name: "vdis",
        source: "avail_raw",
        transform: [
          { type: "formula", as: "name", expr: "datum.key" },
          { type: "formula", as: "spoke", expr: "datum.o.buckets[0].key" },
          { type: "formula", as: "availableHours", expr: "datum.h.value" },
          { type: "lookup", from: "act_raw", key: "key", fields: ["key"], as: ["a"] },
          { type: "formula", as: "cases", expr: "datum.a ? datum.a.doc_count : 0" },
          { type: "formula", as: "activeHours", expr: "datum.a ? datum.a.w.value / 3600 : 0" },
          { type: "formula", as: "cost", expr: "datum.a ? datum.a.ec.value : 0" },
          { type: "formula", as: "processes", expr: "datum.a ? datum.a.np.value : 0" },
          { type: "formula", as: "idleHours", expr: "max(0, datum.availableHours - datum.activeHours)" },
          { type: "formula", as: "idlePct", expr: "datum.availableHours ? datum.idleHours / datum.availableHours : 0" },
          { type: "formula", as: "utilPct", expr: "datum.availableHours ? min(1, datum.activeHours / datum.availableHours) : 0" },
          // React shows every worker when no spoke is selected, otherwise the
          // selected spoke's own workers plus any that ran the filtered work.
          {
            type: "filter",
            expr: "(datum.availableHours > 0 || datum.cases > 0) && (datum.cases > 0 || allSpokes || indexof(pluck(data('scope_all'), 'key'), datum.spoke) >= 0)",
          },
        ],
      },
      {
        name: "vdi_tot",
        source: "vdis",
        transform: [
          { type: "formula", as: "on", expr: "datum.cases > 0 ? 1 : 0" },
          { type: "formula", as: "av", expr: "datum.cases > 0 ? datum.availableHours : 0" },
          { type: "formula", as: "ac", expr: "datum.cases > 0 ? datum.activeHours : 0" },
          { type: "formula", as: "id", expr: "datum.cases > 0 ? datum.idleHours : 0" },
          { type: "aggregate", ops: ["sum", "count", "sum", "sum", "sum", "sum"], fields: ["on", "name", "av", "ac", "id", "cost"], as: ["nActive", "nAll", "sumAvail", "sumActive", "sumIdle", "sumCost"] },
        ],
      },
    ],
    signals: [
      { name: "allSpokes", update: "length(data('scope_all')) >= (length(data('ref_spoke_count')) ? data('ref_spoke_count')[0].value : 99)" },
      ...["nActive", "nAll", "sumAvail", "sumActive", "sumIdle", "sumCost"].map((k) => ({ name: k, update: `length(data('vdi_tot')) ? data('vdi_tot')[0].${k} : 0` })),
      { name: "avgUtil", update: "sumAvail ? sumActive / sumAvail : 0" },
    ],
  };
}
const utilColor = (u) => `(${u} >= tgt_utilMax ? '${C.bad}' : ${u} >= tgt_utilMin ? '${C.good}' : '${C.business}')`;

const kpis = () =>
  merge(targetsBlock(), vdiBlock(), {
    data: [
      {
        name: "tiles",
        values: [
          { i: 0, label: "Active digital workers", accent: C.ink },
          { i: 1, label: "Average utilisation" },
          { i: 2, label: "Spare capacity", accent: C.business },
          { i: 3, label: "Estate cost (period)", accent: C.system },
        ],
        transform: [
          { type: "formula", as: "accent", expr: `datum.i === 1 ? ${utilColor("avgUtil")} : datum.accent` },
          { type: "formula", as: "value", expr: `['' + nActive, ${F.pct("avgUtil", 0)}, ${F.compact("sumIdle")}, ${F.gbp("sumCost")}][datum.i]` },
          { type: "formula", as: "sub", expr: `['of ' + nAll + ' in the estate', ${F.compact("sumActive")} + ' of ' + ${F.compact("sumAvail")} + ' hrs', 'hours available for new automations', 'Teams + Machines, apportioned'][datum.i]` },
          { type: "formula", as: "delta", expr: "null" },
          { type: "formula", as: "target", expr: `datum.i === 1 ? ${F.pct("tgt_utilMin", 0)} + '–' + ${F.pct("tgt_utilMax", 0)} : ''` },
          { type: "formula", as: "met", expr: "avgUtil >= tgt_utilMin && avgUtil <= tgt_utilMax" },
        ],
      },
    ],
  }, kpiTiles({ n: 4 }));

const utilBars = () =>
  merge(targetsBlock(), vdiBlock(), spokeColours(), frame({ title: "Utilisation by digital worker", subtitle: "Active runtime against licensed operating hours, grouped by owning spoke" }), {
    signals: [{ name: "rowH", value: 26 }, { name: "headH", value: 30 }],
    data: [
      {
        name: "ub",
        source: "vdis",
        transform: [
          { type: "collect", sort: { field: ["spoke", "utilPct"], order: ["ascending", "descending"] } },
          { type: "window", ops: ["row_number"], as: ["r"] },
          { type: "window", ops: ["dense_rank"], sort: { field: "spoke" }, as: ["g"] },
          { type: "formula", as: "y", expr: "(datum.r - 1) * rowH + datum.g * headH" },
        ],
      },
      { name: "ugroups", source: "ub", transform: [{ type: "aggregate", groupby: ["spoke", "g"], ops: ["min"], fields: ["y"], as: ["y"] }] },
    ],
    marks: [
      {
        type: "group",
        from: { data: "ugroups" },
        encode: { update: { x: { value: PAD }, y: { signal: "top + datum.y - headH + 8" }, width: { signal: "cw" }, height: { value: 20 } } },
        marks: [
          { type: "rect", encode: { update: { x: { value: 0 }, y: { value: 5 }, width: { value: 10 }, height: { value: 10 }, cornerRadius: { value: 2 }, fill: { signal: spokeColorExpr("parent.spoke") } } } },
          { type: "text", encode: { update: { x: { value: 17 }, y: { value: 10 }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fontWeight: { value: "bold" }, fill: { value: C.inkSoft }, text: { signal: "upper(parent.spoke)" } } } },
        ],
      },
      {
        type: "group",
        from: { data: "ub" },
        encode: { update: { x: { value: PAD }, y: { signal: "top + datum.y" }, width: { signal: "cw" }, height: { signal: "rowH" } } },
        marks: [
          { type: "text", encode: { update: { x: { value: 0 }, y: { signal: "rowH / 2" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 11.5 }, fill: { value: C.ink }, text: { signal: "replace(parent.name, 'VDI-RPA-', '')" }, limit: { value: 84 } } } },
          { type: "rect", encode: { update: { x: { value: 94 }, y: { signal: "rowH / 2 - 9" }, width: { signal: "cw - 150" }, height: { value: 18 }, cornerRadius: { value: 5 }, fill: { value: C.track } } } },
          {
            type: "rect",
            encode: {
              update: {
                x: { value: 94 },
                y: { signal: "rowH / 2 - 9" },
                width: { signal: "max(4, (cw - 150) * parent.utilPct)" },
                height: { value: 18 },
                cornerRadius: { value: 5 },
                fill: { signal: utilColor("parent.utilPct") },
                tooltip: { signal: `{'Worker': parent.name, 'Owner': parent.spoke, 'Utilisation': ${F.pct("parent.utilPct")}, 'Active hours': ${F.int("parent.activeHours")}, 'Licensed hours': ${F.int("parent.availableHours")}}` },
              },
            },
          },
          { type: "text", encode: { update: { x: { signal: "cw" }, y: { signal: "rowH / 2" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 12 }, fontWeight: { value: "bold" }, fill: { value: C.ink }, text: { signal: F.pct("parent.utilPct", 0) } } } },
        ],
      },
      {
        type: "text",
        encode: {
          update: {
            x: { value: PAD },
            y: { signal: "height - 30" },
            font: { value: FONT.body },
            fontSize: { value: 12 },
            fill: { value: C.inkSoft },
            text: { value: ["Low utilisation is spare capacity for new automations; high utilisation flags a worker at risk of", "becoming a bottleneck. Each spoke runs on its own VDIs, so a spoke filter shows the machines it pays for."] },
            lineHeight: { value: 16 },
          },
        },
      },
    ],
  });

const vdiTable = () =>
  merge(targetsBlock(), vdiBlock(), frame({ title: "VDI capacity table", subtitle: "Click a column to sort; default by utilisation" }),
    table({
      data: "vdis",
      rowH: 27,
      sort: { key: "utilPct", dir: "descending" },
      columns: [
        { label: "Digital worker", sortKey: "name", text: "datum.name", bold: true, tip: "datum.name + ' · ' + datum.spoke" },
        { label: "Owner", sortKey: "spoke", w: 120, font: "mono", size: 10.5, text: "datum.spoke", color: `'${C.inkSoft}'` },
        { label: "Processes", sortKey: "processes", w: 80, align: "right", text: "'' + datum.processes" },
        { label: "Items", sortKey: "cases", w: 70, align: "right", text: F.int("datum.cases") },
        { label: "Active hrs", sortKey: "activeHours", w: 80, align: "right", text: F.compact("datum.activeHours") },
        { label: "Idle %", sortKey: "idlePct", w: 64, align: "right", text: F.pct("datum.idlePct", 0), color: `datum.idlePct > 0.9 ? '${C.bad}' : '${C.ink}'` },
        { label: "Utilisation", sortKey: "utilPct", w: 140, bar: "datum.utilPct", barColor: utilColor("datum.utilPct"), align: "right", text: F.pct("datum.utilPct", 0), size: 11 },
        { label: "Cost share", sortKey: "cost", w: 90, align: "right", text: F.gbp("datum.cost") },
      ],
    }),
  );

const summary = () =>
  merge(targetsBlock(), vdiBlock(), frame({ title: "Capacity & cost summary", subtitle: "Utilisation against the healthy band, and where the spend goes" }), {
    signals: [
      { name: "gR", update: "min(58, ch * 0.62)" },
      { name: "gx", update: `${PAD} + gR + 6` },
      { name: "gy", update: "top + ch * 0.5 + gR * 0.55" },
      { name: "toA", expr: "", update: "0" },
    ].filter((s) => s.name !== "toA"),
    marks: [
      { type: "arc", encode: { update: { x: { signal: "gx" }, y: { signal: "gy" }, startAngle: { value: -Math.PI / 2 }, endAngle: { value: Math.PI / 2 }, innerRadius: { signal: "gR - 10" }, outerRadius: { signal: "gR" }, cornerRadius: { value: 5 }, fill: { value: C.track } } } },
      { type: "arc", encode: { update: { x: { signal: "gx" }, y: { signal: "gy" }, startAngle: { signal: "-PI / 2 + PI * tgt_utilMin" }, endAngle: { signal: "-PI / 2 + PI * tgt_utilMax" }, innerRadius: { signal: "gR - 10" }, outerRadius: { signal: "gR" }, fill: { value: C.good }, fillOpacity: { value: 0.22 } } } },
      { type: "arc", encode: { update: { x: { signal: "gx" }, y: { signal: "gy" }, startAngle: { value: -Math.PI / 2 }, endAngle: { signal: "-PI / 2 + PI * clamp(avgUtil, 0.005, 1)" }, innerRadius: { signal: "gR - 10" }, outerRadius: { signal: "gR" }, cornerRadius: { value: 5 }, fill: { signal: utilColor("avgUtil") } } } },
      { type: "rule", encode: { update: { x: { signal: "gx + sin(-PI / 2 + PI * tgt_utilMax) * (gR - 16)" }, y: { signal: "gy - cos(-PI / 2 + PI * tgt_utilMax) * (gR - 16)" }, x2: { signal: "gx + sin(-PI / 2 + PI * tgt_utilMax) * (gR + 6)" }, y2: { signal: "gy - cos(-PI / 2 + PI * tgt_utilMax) * (gR + 6)" }, stroke: { value: C.ink }, strokeWidth: { value: 2 } } } },
      { type: "text", encode: { update: { x: { signal: "gx" }, y: { signal: "gy - 14" }, align: { value: "center" }, font: { value: FONT.display }, fontSize: { value: 22 }, fontWeight: { value: "bold" }, fill: { value: C.ink }, text: { signal: F.pct("avgUtil", 0) } } } },
      { type: "text", encode: { update: { x: { signal: "gx" }, y: { signal: "gy + 2" }, align: { value: "center" }, font: { value: FONT.mono }, fontSize: { value: 9.5 }, fill: { value: C.inkSoft }, text: { value: "UTILISATION" } } } },
      ...[
        ["Licensed capacity", `${F.compact("sumAvail")} + ' h'`],
        ["Productive bot time", `${F.compact("sumActive")} + ' h'`],
        ["Estate cost, apportioned", F.gbp("sumCost")],
      ].flatMap(([k, v], i) => [
        ...(i ? [{ type: "rule", encode: { update: { x: { signal: "gx + gR + 24" }, x2: { signal: `width - ${PAD}` }, y: { signal: `top + 4 + ${i} * (ch - 8) / 3` }, stroke: { value: C.rule } } } }] : []),
        { type: "text", encode: { update: { x: { signal: "gx + gR + 24" }, y: { signal: `top + 4 + (${i} + 0.5) * (ch - 8) / 3` }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fill: { value: C.inkSoft }, text: { value: k } } } },
        { type: "text", encode: { update: { x: { signal: `width - ${PAD}` }, y: { signal: `top + 4 + (${i} + 0.5) * (ch - 8) / 3` }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 13.5 }, fontWeight: { value: "bold" }, fill: { value: C.ink }, text: { signal: v } } } },
      ]),
    ],
  });

export const dashboard = {
  id: "capacity",
  title: "IA · VDI & Capacity",
  description: "Digital-worker utilisation, idle time and estate cost",
  time: { from: "now-89d/d", to: "now" },
  states: ["spoke"],
  panels: [
    { id: "kpis", title: "Capacity KPIs", grid: { x: 0, y: 0, w: 48, h: 5 }, build: kpis },
    { id: "utilisation", title: "Utilisation by digital worker", grid: { x: 0, y: 5, w: 22, h: 24 }, build: utilBars },
    { id: "vdi-table", title: "VDI capacity table", grid: { x: 22, y: 5, w: 26, h: 16 }, build: vdiTable },
    { id: "summary", title: "Capacity & cost summary", grid: { x: 22, y: 21, w: 26, h: 8 }, build: summary },
  ],
};
