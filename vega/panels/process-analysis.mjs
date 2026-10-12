// Process Analysis: how each process performs for the people waiting on it
// (turnaround, SLA, first-time success) and for the estate (runtime,
// throughput, exceptions, cost).
// React source: src/pages/ProcessAnalysis.tsx, plus turnaround and SLA
// (DATA-CONTRACT T14), which the React app did not have.
import { C, FONT } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, timeChart, hbars, segmented, table, PAD } from "../lib/kit.mjs";
import { dailyBlock, targetsBlock, grainFlow, releasesBlock, T, MIN_VOLUME } from "../lib/blocks.mjs";
import { processCatalogue, byProcess, addFilter, rateBandColor } from "../lib/common.mjs";

const hrs = (sec) => `(${sec} < 3600 ? round(${sec} / 60) + ' min' : format(${sec} / 3600, '.1f') + ' h')`;

const performance = () => {
  const seg = segmented({
    signal: "metric",
    options: [
      { value: "sla", label: "Within SLA" },
      { value: "turn", label: "Turnaround" },
      { value: "first", label: "First-time success" },
      { value: "time", label: "Bot runtime" },
      { value: "throughput", label: "Throughput" },
      { value: "exrate", label: "Exception rate" },
    ],
  });
  const sub = {
    sla: "Share of completed items finished inside their SLA, lowest first",
    turn: "Average time from an item being loaded to its outcome, longest first",
    first: "Share of first attempts that completed without a retry, lowest first",
    time: "Average digital-worker runtime per completed item, longest first",
    throughput: "Items completed per process",
    exrate: "Share of attempts ending in an exception",
  };
  return merge(
    processCatalogue(),
    byProcess("bp", ["c", "a", "e", "cw", "ta", "sl", "f1", "fo"]),
    frame({ title: "Process performance", subtitleSignal: `(${JSON.stringify(sub).replace(/"/g, "'")})[metric] + ' · click a bar to filter'` }),
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
            { type: "formula", as: "slaP", expr: "datum.c ? datum.sl / datum.c : null" },
            { type: "formula", as: "firstP", expr: "datum.f1 ? datum.fo / datum.f1 : null" },
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
            { type: "formula", as: "color", expr: `metric === 'exrate' ? '${C.system}' : (metric === 'sla' || metric === 'first') && datum.value < 0.9 ? '${C.business}' : '${C.completed}'` },
            { type: "formula", as: "sortKey", expr: "metric === 'sla' || metric === 'first' ? -datum.value : datum.value" },
            { type: "collect", sort: { field: "sortKey", order: "descending" } },
          ],
        },
      ],
      marks: seg.marks,
    },
    hbars({ data: "bars", labelW: 180, valueW: 70, rowH: 25, barH: 9, click: true, subInBar: false }),
  );
};

const slaTrend = () => {
  const seg = segmented({ signal: "grain", options: [{ value: "daily", label: "Daily" }, { value: "monthly", label: "Monthly" }] });
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
    { signals: [{ name: "grain", value: "daily", on: seg.on }], marks: seg.marks },
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
      yDomain: { signal: "[max(0, floor(min(extent(pluck(data('slaf'), 'slaP'))[0] || 0, extent(pluck(data('slaf'), 'firstP'))[0] || 0) / 10) * 10 - 10), 100]" },
      yFmt: (e) => `format(${e}, '.0f') + '%'`,
      tipFmt: (e) => `format(${e}, '.1f') + '%'`,
      xFmt: (e) => `grain === 'monthly' ? ${F.month(e)} : ${F.day(e)}`,
      tipDateFmt: (e) => `grain === 'monthly' ? ${F.month(e)} : ${F.dayLong(e)}`,
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

export const dashboard = {
  id: "process-analysis",
  title: "IA · Process Analysis",
  description: "Turnaround, SLA, first-time success, runtime, throughput and cost by process",
  time: { from: "now-89d/d", to: "now" },
  panels: [
    { id: "performance", title: "Process performance", grid: { x: 0, y: 0, w: 48, h: 16 }, build: performance },
    { id: "service", title: "SLA and first time", grid: { x: 0, y: 16, w: 20, h: 18 }, build: slaTrend },
    { id: "league", title: "Process league table", grid: { x: 20, y: 16, w: 28, h: 18 }, build: league },
  ],
};

void FONT;
void PAD;
