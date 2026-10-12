// VDI & Capacity: digital-worker utilisation, idle time and estate cost.
// React source: src/pages/Capacity.tsx
import { C, FONT, IDX } from "../lib/tokens.mjs";
import { whenHeatmap } from "../lib/when.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, kpiTiles, table, timeChart, segmented, emptyNote, PAD } from "../lib/kit.mjs";
import { targetsBlock, spokeColours, spokeColorExpr, dailyBlock, T } from "../lib/blocks.mjs";
import { ctx, plain, MAPPED, DAY_MS } from "../lib/es.mjs";

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
  merge(targetsBlock(), vdiBlock(), dailyBlock({ keys: ["a", "w"] }), {
    signals: [
      // spare hours turned into work: at the current average runtime per item, per 30-day month
      { name: "secPerItem", update: `${T("cur_a")} ? ${T("cur_w")} / ${T("cur_a")} : 0` },
      { name: "spareItems", update: "secPerItem && ndays ? sumIdle * 3600 / secPerItem / ndays * 30.44 : 0" },
    ],
    data: [
      {
        name: "tiles",
        values: [
          { i: 0, label: "Active digital workers", accent: C.ink },
          { i: 1, label: "Average utilisation" },
          { i: 2, label: "Room for more work", accent: C.business },
          { i: 3, label: "Estate cost (period)", accent: C.system },
        ],
        transform: [
          { type: "formula", as: "accent", expr: `datum.i === 1 ? ${utilColor("avgUtil")} : datum.accent` },
          { type: "formula", as: "value", expr: `['' + nActive, ${F.pct("avgUtil", 0)}, ${F.compact("spareItems")} + ' items/mo', ${F.gbp("sumCost")}][datum.i]` },
          { type: "formula", as: "sub", expr: `['of ' + nAll + ' in the estate', ${F.compact("sumActive")} + ' of ' + ${F.compact("sumAvail")} + ' hrs', '≈' + ${F.compact("sumIdle")} + ' idle hours at ' + ${F.duration("secPerItem")} + ' an item', 'Teams + Machines, apportioned'][datum.i]` },
          { type: "formula", as: "delta", expr: "null" },
          { type: "formula", as: "target", expr: `datum.i === 1 ? ${F.pct("tgt_utilMin", 0)} + '–' + ${F.pct("tgt_utilMax", 0)} : ''` },
          { type: "formula", as: "met", expr: "avgUtil >= tgt_utilMin && avgUtil <= tgt_utilMax" },
        ],
      },
    ],
  }, kpiTiles({ n: 4 }));

const vdiTable = () =>
  merge(targetsBlock(), vdiBlock(), spokeColours(), frame({ title: "VDI capacity table", subtitle: "Click a column to sort; default by utilisation" }),
    table({
      data: "vdis",
      rowH: 27,
      sort: { key: "utilPct", dir: "descending" },
      columns: [
        { label: "Digital worker", sortKey: "name", text: "datum.name", bold: true, tip: "datum.name + ' · ' + datum.spoke" },
        { label: "Owner", sortKey: "spoke", w: 220, size: 11.5, text: "datum.spoke", color: `'${C.inkSoft}'`, swatch: spokeColorExpr("datum.spoke") },
        { label: "Processes", sortKey: "processes", w: 80, align: "right", text: "'' + datum.processes" },
        { label: "Items", sortKey: "cases", w: 70, align: "right", text: F.int("datum.cases") },
        { label: "Active hrs", sortKey: "activeHours", w: 80, align: "right", text: F.compact("datum.activeHours") },
        { label: "Idle %", sortKey: "idlePct", w: 64, align: "right", text: F.pct("datum.idlePct", 0), color: `datum.idlePct > 0.9 ? '${C.bad}' : '${C.ink}'` },
        { label: "Utilisation", sortKey: "utilPct", w: 140, bar: "datum.utilPct", barColor: utilColor("datum.utilPct"), align: "right", text: F.pct("datum.utilPct", 0), size: 11 },
        { label: "Cost share", sortKey: "cost", w: 90, align: "right", text: F.gbp("datum.cost") },
      ],
    }),
  );

// Licensed hours per day for the digital workers in scope (those vdiBlock
// shows), joined to the daily bot time and grouped by the chosen grain.
// Data "cap": t, w (bot seconds), lic (licensed hours), days; signal opH.
function capacitySeries(grain) {
  return merge(dailyBlock({ keys: ["w", "a"] }), {
    signals: [{ name: "opH", update: "length(data('ref_config')) ? data('ref_config')[0]._source.vdi_operating_hours : 20" }],
    data: [
      plain("lic_raw", {
        index: IDX.vdiDaily,
        body: { query: { range: { "@timestamp": { "%timefilter%": true } } }, aggs: { d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 0 }, aggs: { r: { terms: { field: "resource.name", size: 500 }, aggs: { h: { sum: { field: "operating_hours" } } } } } } } },
        property: "aggregations.d.buckets",
      }),
      {
        name: "lic",
        source: "lic_raw",
        transform: [
          { type: "flatten", fields: ["r.buckets"], as: ["g"] },
          { type: "filter", expr: "indexof(pluck(data('vdis'), 'name'), datum.g.key) >= 0" },
          { type: "formula", as: "h", expr: "datum.g.h.value" },
          { type: "aggregate", groupby: ["key"], ops: ["sum"], fields: ["h"], as: ["h"] },
        ],
      },
      {
        name: "cap",
        source: "series",
        transform: [
          { type: "lookup", from: "lic", key: "key", fields: ["t"], values: ["h"], as: ["lic"], default: 0 },
          { type: "formula", as: "g", expr: `${grain} === 'monthly' ? utc(utcyear(datum.t), utcmonth(datum.t), 1) : ${grain} === 'weekly' ? datum.t - ((utcday(datum.t) + 6) % 7) * ${DAY_MS} : datum.t` },
          { type: "aggregate", groupby: ["g"], ops: ["sum", "sum", "sum", "count"], fields: ["w", "a", "lic", "t"], as: ["w", "a", "lic", "days"] },
          { type: "formula", as: "t", expr: "datum.g" },
          { type: "formula", as: "util", expr: "datum.lic ? datum.w / 3600 / datum.lic * 100 : null" },
          { type: "formula", as: "need", expr: "datum.days ? datum.w / 3600 / (datum.days * opH) : 0" },
          { type: "formula", as: "have", expr: "datum.days ? datum.lic / (datum.days * opH) : 0" },
          { type: "collect", sort: { field: "t" } },
        ],
      },
    ],
  });
}
const grainSeg = () => segmented({ signal: "cgrain", options: [{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }] });
const xf = (e) => `cgrain === 'monthly' ? ${F.month(e)} : ${F.day(e)}`;
const tf2 = (e) => `cgrain === 'monthly' ? ${F.month(e)} : cgrain === 'weekly' ? 'w/c ' + ${F.dayLong(e)} : ${F.dayLong(e)}`;

const utilTrend = () => {
  const seg = grainSeg();
  return merge(
    targetsBlock(),
    vdiBlock(),
    capacitySeries("cgrain"),
    frame({ title: "Utilisation over time", subtitle: "Bot time against licensed hours, for the workers in view" }),
    { signals: [{ name: "cgrain", value: "weekly", on: seg.on }], marks: seg.marks },
    timeChart({
      data: "cap",
      name: "ut",
      xFmt: xf,
      tipDateFmt: tf2,
      weekends: "cgrain === 'daily'",
      yFmt: (e) => `format(${e}, '.0f') + '%'`,
      tipFmt: (e) => `format(${e}, '.1f') + '%'`,
      yMaxFloor: "tgt_utilMax * 100 + 5",
      refLines: [
        { value: "tgt_utilMax * 100", label: "'ceiling ' + format(tgt_utilMax * 100, '.0f') + '%'", color: C.bad },
        { value: "tgt_utilMin * 100", label: "'floor ' + format(tgt_utilMin * 100, '.0f') + '%'", color: C.business },
      ],
      series: [{ field: "util", name: "Utilisation", color: C.completed, area: true }],
    }),
  );
};

const needed = () => {
  const seg = grainSeg();
  return merge(
    targetsBlock(),
    vdiBlock(),
    capacitySeries("cgrain"),
    frame({
      title: "Digital workers needed",
      subtitleSignal: "'Bot time ÷ ' + opH + ' h a day, against licensed workers'",
      legend: [
        { label: "Needed", color: C.completed },
        { label: "Licensed", color: C.inkSoft, dashed: true },
      ],
      legendBelow: true,
    }),
    { signals: [{ name: "cgrain", value: "weekly", on: seg.on }], marks: seg.marks },
    timeChart({
      data: "cap",
      name: "nd",
      xFmt: xf,
      tipDateFmt: tf2,
      weekends: "cgrain === 'daily'",
      yFmt: (e) => `format(${e}, '.1f')`,
      tipFmt: (e) => `format(${e}, '.2f') + ' workers'`,
      series: [
        { field: "need", name: "Needed", color: C.completed, area: true },
        { field: "have", name: "Licensed", color: C.inkSoft, dashed: true },
      ],
    }),
  );
};

// When the work runs: bot hours by process and hour of day (or weekday).
const when = () =>
  whenHeatmap({
    title: "When the work runs",
    subtitle: "'Bot hours by process and ' + (whenBy === 'hour' ? 'hour of day (UTC)' : 'day of week') + ' · pick a worker in the Digital worker control to see its day'",
    rowField: "process.name",
    rowSize: 20,
    filterField: "process.name",
    sumField: "worktime_sec",
    scale: 1 / 3600,
    unit: "Bot hours",
    totalFmt: (x) => `format(${x}, ',.0f') + ' h'`,
    color: C.completed,
  });

export const dashboard = {
  id: "capacity",
  title: "IA · VDI & Capacity",
  description: "Digital-worker utilisation, idle time and estate cost",
  time: { from: "now-89d/d", to: "now" },
  states: ["spoke"],
  extraControls: [{ field: "resource.name", title: "Digital worker" }],
  panels: [
    { id: "kpis", title: "Capacity KPIs", grid: { x: 0, y: 0, w: 48, h: 5 }, build: kpis },
    { id: "util-trend", title: "Utilisation over time", grid: { x: 0, y: 5, w: 24, h: 11 }, build: utilTrend },
    { id: "needed", title: "Digital workers needed", grid: { x: 24, y: 5, w: 24, h: 11 }, build: needed },
    { id: "vdi-table", title: "VDI capacity table", grid: { x: 0, y: 16, w: 48, h: 15 }, build: vdiTable },
    { id: "when", title: "When the work runs", grid: { x: 0, y: 31, w: 48, h: 16 }, build: when },
  ],
};
