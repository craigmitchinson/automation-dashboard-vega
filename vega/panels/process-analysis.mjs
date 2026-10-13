// Process Analysis: how each process performs for the people waiting on it
// (turnaround, SLA, first-time success) and for the estate (runtime,
// throughput, exceptions, cost).
// React source: src/pages/ProcessAnalysis.tsx, plus turnaround and SLA
// (DATA-CONTRACT T14), which the React app did not have.
import { C } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, timeChart, hbars, segmented, table, PAD } from "../lib/kit.mjs";
import { sums } from "../lib/es.mjs";
import { dailyBlock, targetsBlock, grainFlow, releasesBlock, T, MIN_VOLUME } from "../lib/blocks.mjs";
import { processCatalogue, byProcess, addFilter, rateBandColor } from "../lib/common.mjs";

const hrs = (sec) => `(${sec} < 3600 ? round(${sec} / 60) + ' min' : format(${sec} / 3600, '.1f') + ' h')`;

const performance = () => {
  const seg = segmented({
    signal: "metric",
    y: 40,
    options: [
      { value: "sla", label: "Missed SLA" },
      { value: "turn", label: "Turnaround" },
      { value: "first", label: "Needed a retry" },
      { value: "time", label: "Bot runtime" },
      { value: "throughput", label: "Throughput" },
      { value: "exrate", label: "Exception rate" },
    ],
  });
  const sub = {
    sla: "Completed outside SLA, worst first",
    turn: "Loaded to outcome, longest first",
    first: "Not done first time, worst first",
    time: "Bot runtime per completed item",
    throughput: "Items completed",
    exrate: "Attempts ending in an exception",
  };
  return merge(
    processCatalogue(),
    byProcess("bp", ["c", "a", "e", "cw", "ta", "sl", "f1", "fo"]),
    frame({ title: "Process performance", subtitleSignal: `(${JSON.stringify(sub).replace(/"/g, "'")})[metric]` }),
    {
      signals: [
        { name: "metric", value: "sla", on: seg.on },
        { name: "pick", on: [{ events: "@hb_row:click", update: addFilter("process.name", "datum.label") }] },
      ],
      data: [
        {
          name: "bars",
          source: "bp",
          transform: [
            { type: "formula", as: "label", expr: "datum.name" },
            { type: "formula", as: "cycle", expr: "datum.c ? datum.cw / datum.c : 0" },
            { type: "formula", as: "turn", expr: "datum.a ? datum.ta / datum.a : 0" },
            // shown as the failure share, so the bar length is the problem
            { type: "formula", as: "slaP", expr: "datum.c ? 1 - datum.sl / datum.c : null" },
            { type: "formula", as: "firstP", expr: "datum.f1 ? 1 - datum.fo / datum.f1 : null" },
            { type: "formula", as: "rate", expr: "datum.a ? datum.e / datum.a * 100 : 0" },
            {
              type: "formula",
              as: "value",
              expr: "metric === 'sla' ? datum.slaP : metric === 'turn' ? datum.turn : metric === 'first' ? datum.firstP : metric === 'time' ? datum.cycle : metric === 'throughput' ? datum.c : datum.rate",
            },
            {
              type: "formula",
              as: "display",
              expr: `metric === 'sla' ? ${F.pct("datum.slaP")} : metric === 'turn' ? ${hrs("datum.turn")} : metric === 'first' ? ${F.pct("datum.firstP")} : metric === 'time' ? ${F.duration("datum.cycle")} : metric === 'throughput' ? ${F.compact("datum.c")} : format(datum.rate, '.1f') + '%'`,
            },
            { type: "formula", as: "sub", expr: `metric === 'sla' ? 'SLA ' + datum.slaHours + ' h' : metric === 'time' || metric === 'turn' ? ${F.compact("datum.c")} + ' items' : metric === 'exrate' ? ${F.int("datum.e")} + ' exc' : ''` },
            { type: "formula", as: "color", expr: `metric === 'exrate' || metric === 'sla' ? '${C.system}' : metric === 'first' ? '${C.business}' : '${C.completed}'` },
            { type: "collect", sort: { field: ["value", "label"], order: ["descending", "ascending"] } },
          ],
        },
      ],
      marks: seg.marks,
    },
    hbars({ data: "bars", labelW: 170, valueW: 64, rowH: 25, barH: 9, click: true, subInBar: false, top: "top + 34", height: "ch - 34" }),
  );
};

const slaTrend = () => {
  const seg = segmented({ signal: "grain", options: [{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }] });
  return merge(
    dailyBlock({ keys: ["c", "a", "sl", "ta", "f1", "fo"] }),
    releasesBlock(),
    frame({
      title: "SLA and first time",
      subtitleSignal: `${F.pct(`${T("cur_sl")} / max(1, ${T("cur_c")})`)} + ' in SLA · ' + ${hrs(`${T("cur_ta")} / max(1, ${T("cur_a")})`)} + ' turnaround · ' + ${F.pct(`${T("cur_fo")} / max(1, ${T("cur_f1")})`)} + ' first time'`,
      legend: [
        { label: "Within SLA", color: C.completed },
        { label: "First-time success", color: C.business },
      ],
      legendBelow: true,
    }),
    { signals: [{ name: "grain", value: "weekly", on: seg.on }], marks: seg.marks },
    grainFlow(["c", "a", "sl", "f1", "fo"]),
    {
      data: [
        {
          name: "slaf",
          source: "flow",
          transform: [
            { type: "formula", as: "slaP", expr: "datum.c ? datum.sl / datum.c * 100 : null" },
            { type: "formula", as: "firstP", expr: "datum.f1 ? datum.fo / datum.f1 * 100 : null" },
          ],
        },
      ],
    },
    timeChart({
      data: "slaf",
      markers: "rel",
      yDomain: { signal: "[max(0, floor(min(extent(pluck(data('slaf'), 'slaP'))[0] || 0, extent(pluck(data('slaf'), 'firstP'))[0] || 0) / 5) * 5 - 5), 100]" },
      yFmt: (e) => `format(${e}, '.0f') + '%'`,
      tipFmt: (e) => `format(${e}, '.1f') + '%'`,
      xFmt: (e) => `grain === 'monthly' ? ${F.month(e)} : ${F.day(e)}`,
      tipDateFmt: (e) => `grain === 'monthly' ? ${F.month(e)} : grain === 'weekly' ? 'w/c ' + ${F.dayLong(e)} : ${F.dayLong(e)}`,
      series: [
        { field: "slaP", name: "Within SLA", color: C.completed, area: true },
        { field: "firstP", name: "First-time success", color: C.business },
      ],
    }),
  );
};

const league = () =>
  merge(
    processCatalogue(),
    targetsBlock(),
    byProcess("bp", ["c", "a", "e", "cw", "ec", "ta", "sl", "f1", "fo"]),
    frame({ title: "Process league table", subtitle: "Sorted by cost contribution · click a heading to sort, a row to filter" }),
    {
      signals: [{ name: "pick", on: [{ events: "@tb_row:click", update: addFilter("process.name", "datum.name") }] }],
      data: [
        {
          name: "lg",
          source: "bp",
          transform: [
            { type: "formula", as: "cycle", expr: "datum.c ? datum.cw / datum.c : 0" },
            { type: "formula", as: "turn", expr: "datum.a ? datum.ta / datum.a : 0" },
            { type: "formula", as: "slaP", expr: "datum.c ? datum.sl / datum.c : 0" },
            { type: "formula", as: "firstP", expr: "datum.f1 ? datum.fo / datum.f1 : 0" },
            { type: "formula", as: "rate", expr: "datum.a ? datum.e / datum.a : 0" },
            { type: "formula", as: "thin", expr: `datum.a < ${MIN_VOLUME}` },
          ],
        },
      ],
    },
    table({
      data: "lg",
      rowTip: `{'Process': datum.name, 'Hub': datum.spoke, 'Queue': datum.queue, 'Items completed': ${F.int("datum.c")}, 'Attempts': ${F.int("datum.a")}, 'SLA': datum.slaHours + ' h', 'Within SLA': ${F.pct("datum.slaP")}, 'First time': ${F.pct("datum.firstP")}, 'Bot runtime per item': ${F.duration("datum.cycle")}, 'Exception rate': ${F.pct("datum.rate")}, 'Estate cost': ${F.gbp("datum.ec")}, 'Cost per item': ${F.money2("datum.c ? datum.ec / datum.c : null")}, '': 'click to filter to this process'}`,
      rowH: 26,
      rowClick: true,
      sort: { key: "ec" },
      columns: [
        { label: "Process", text: "datum.name", swatch: "datum.spokeColor", tip: "datum.thin ? 'Fewer than " + MIN_VOLUME + " attempts: rates are indicative' : datum.spoke" },
        { label: "Items", w: 70, align: "right", font: "mono", text: F.int("datum.c"), sortKey: "c" },
        { label: "SLA", w: 56, align: "right", font: "mono", text: "datum.slaHours + ' h'", color: `'${C.inkSoft}'` },
        { label: "Within SLA", w: 92, align: "right", font: "mono", text: F.pct("datum.slaP"), sortKey: "slaP", color: `datum.slaP < 0.9 ? '${C.bad}' : datum.slaP < 0.97 ? '${C.business}' : '${C.ink}'` },
        { label: "Turnaround", w: 92, align: "right", font: "mono", text: hrs("datum.turn"), sortKey: "turn" },
        { label: "First time", w: 86, align: "right", font: "mono", text: F.pct("datum.firstP"), sortKey: "firstP" },
        { label: "Runtime", w: 76, align: "right", font: "mono", text: F.duration("datum.cycle"), sortKey: "cycle" },
        { label: "Exc %", w: 66, align: "right", font: "mono", text: F.pct("datum.rate"), sortKey: "rate", color: rateBandColor("datum.rate", "tgt_exceptionRate") },
        { label: "Cost", w: 86, align: "right", font: "mono", bold: true, text: F.money("datum.ec"), sortKey: "ec" },
      ],
    }),
  );

// Bot time lost to exceptions: robot time and cost spent on items that then
// failed, per process, with the reason that cost most. Where to fix first.
const lost = () =>
  merge(
    processCatalogue(),
    byProcess("bl", ["w", "cw", "e", "a"], {
      extraAggs: { xe: { filter: { term: { "n.exception": 1 } }, aggs: { ...sums("ec", "rw"), r: { terms: { field: "exception.reason_display", size: 1, order: { w: "desc" } }, aggs: { w: { sum: { field: "worktime_sec" } } } } } } },
    }),
    frame({ title: "Bot time lost to exceptions", subtitle: "Robot time and cost spent on items that then failed, worst first · the reason that cost most · click a row to filter" }),
    {
      data: [
        {
          name: "lt",
          source: "bl",
          transform: [
            { type: "formula", as: "lostH", expr: "(datum.w - datum.cw) / 3600" },
            { type: "filter", expr: "datum.lostH > 0" },
            { type: "formula", as: "share", expr: "datum.w ? (datum.w - datum.cw) / datum.w : 0" },
            { type: "formula", as: "lostGbp", expr: "datum.xe.ec.value" },
            { type: "formula", as: "rework", expr: "datum.xe.rw.value" },
            { type: "formula", as: "why", expr: "length(datum.xe.r.buckets) ? datum.xe.r.buckets[0].key : ''" },
            { type: "formula", as: "whyShare", expr: "length(datum.xe.r.buckets) && datum.w - datum.cw ? datum.xe.r.buckets[0].w.value / (datum.w - datum.cw) : 0" },
            { type: "collect", sort: { field: "lostGbp", order: "descending" } },
          ],
        },
        { name: "lt_tot", source: "lt", transform: [{ type: "aggregate", ops: ["sum", "sum", "sum", "sum"], fields: ["lostH", "lostGbp", "rework", "w"], as: ["h", "g", "r", "w"] }] },
      ],
      signals: [
        { name: "ltT", update: "length(data('lt_tot')) ? data('lt_tot')[0] : {h: 0, g: 0, r: 0, w: 0}" },
        { name: "pickLt", on: [{ events: "@lt_row:click", update: addFilter("process.name", "datum.name") }] },
      ],
    },
    table({
      data: "lt",
      name: "lt",
      rowH: 27,
      rowClick: true,
      columns: [
        { label: "Process", text: "datum.name", bold: true, swatch: "datum.spokeColor" },
        { label: "Exceptions", w: 92, align: "right", font: "mono", text: F.int("datum.e") },
        { label: "Bot hours lost", w: 110, align: "right", font: "mono", text: "format(datum.lostH, ',.1f')" },
        { label: "Share of its bot time", w: 170, bar: "datum.share / 0.3", barColor: `'${C.system}'`, align: "right", font: "mono", text: F.pct("datum.share"), size: 11 },
        { label: "Cost of lost time", w: 120, align: "right", font: "mono", bold: true, text: F.gbp("datum.lostGbp"), color: `'${C.system}'` },
        { label: "Rework exposure", w: 120, align: "right", font: "mono", text: F.gbp("datum.rework") },
        { label: "Costliest reason", w: 300, text: "datum.why ? datum.why + ' (' + format(datum.whyShare * 100, '.0f') + '%)' : ''", color: `'${C.inkSoft}'`, tip: "datum.why" },
      ],
      totals: [
        "'All processes'",
        null,
        "format(ltT.h, ',.1f')",
        `${F.pct("ltT.w ? ltT.h * 3600 / ltT.w : 0")} + ' of all bot time'`,
        F.gbp("ltT.g"),
        F.gbp("ltT.r"),
        null,
      ],
    }),
  );

// Bot time per item, completed against exception: a rise in either is a
// process slowing down or failing late (expensive, as the bot time is spent).
const runtime = () => {
  const seg = segmented({ signal: "grain", options: [{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }] });
  return merge(
    dailyBlock({ keys: ["c", "e", "w", "cw"] }),
    releasesBlock(),
    frame({
      title: "Bot time per item",
      subtitleSignal: `${F.duration(`${T("cur_cw")} / max(1, ${T("cur_c")})`)} + ' completed · ' + ${F.duration(`(${T("cur_w")} - ${T("cur_cw")}) / max(1, ${T("cur_e")})`)} + ' before an exception'`,
      legend: [
        { label: "Completed", color: C.completed },
        { label: "Exception", color: C.system },
      ],
      legendBelow: true,
    }),
    { signals: [{ name: "grain", value: "weekly", on: seg.on }], marks: seg.marks },
    grainFlow(["c", "e", "w", "cw"]),
    {
      data: [
        {
          name: "rtf",
          source: "flow",
          transform: [
            { type: "formula", as: "okT", expr: "datum.c ? datum.cw / datum.c : null" },
            { type: "formula", as: "exT", expr: "datum.e ? (datum.w - datum.cw) / datum.e : null" },
          ],
        },
      ],
    },
    timeChart({
      data: "rtf",
      markers: "rel",
      xFmt: (e) => `grain === 'monthly' ? ${F.month(e)} : ${F.day(e)}`,
      tipDateFmt: (e) => `grain === 'monthly' ? ${F.month(e)} : grain === 'weekly' ? 'w/c ' + ${F.dayLong(e)} : ${F.dayLong(e)}`,
      yFmt: F.duration,
      tipFmt: F.duration,
      series: [
        { field: "okT", name: "Completed", color: C.completed },
        { field: "exT", name: "Exception", color: C.system },
      ],
    }),
  );
};

export const dashboard = {
  id: "process-analysis",
  title: "IA · Process Analysis",
  description: "Turnaround, SLA, first-time success, runtime, throughput and cost by process",
  time: { from: "now-89d/d", to: "now" },
  panels: [
    { id: "service", title: "SLA and first time", grid: { x: 0, y: 0, w: 24, h: 12 }, build: slaTrend },
    { id: "runtime", title: "Bot time per item", grid: { x: 24, y: 0, w: 24, h: 12 }, build: runtime },
    { id: "performance", title: "Process performance", grid: { x: 0, y: 12, w: 19, h: 18 }, build: performance },
    { id: "league", title: "Process league table", grid: { x: 19, y: 12, w: 29, h: 18 }, build: league },
    { id: "lost", title: "Bot time lost to exceptions", grid: { x: 0, y: 30, w: 48, h: 14 }, build: lost },
  ],
};

