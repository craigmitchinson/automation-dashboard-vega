// Process Analysis: completion time, throughput and exception trends by process.
// React source: src/pages/ProcessAnalysis.tsx
import { C, FONT } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, timeChart, hbars, segmented, table, PAD } from "../lib/kit.mjs";
import { dailyBlock, targetsBlock } from "../lib/blocks.mjs";
import { processCatalogue, byProcess, addFilter, rateBandColor } from "../lib/common.mjs";
import { grainFlow } from "./input-outcome.mjs";

const performance = () => {
  const seg = segmented({
    signal: "metric",
    options: [
      { value: "time", label: "Avg completion time" },
      { value: "throughput", label: "Throughput" },
      { value: "exrate", label: "Exception rate" },
    ],
  });
  return merge(
    processCatalogue(),
    byProcess("bp", ["c", "a", "e", "cw"]),
    frame({
      title: "Process performance",
      subtitleSignal: "metric === 'time' ? 'Average digital-worker runtime per case, longest first' : metric === 'throughput' ? 'Completed cases per process' : 'Share of attempts ending in an exception'",
    }),
    {
      signals: [
        { name: "metric", value: "time", on: seg.on },
        { name: "pick", on: [{ events: "@hb_row:click", update: addFilter("process.name", "datum.label") }] },
      ],
      data: [
        {
          name: "bars",
          source: "bp",
          transform: [
            { type: "formula", as: "label", expr: "datum.name" },
            { type: "formula", as: "cycle", expr: "datum.c ? datum.cw / datum.c : 0" },
            { type: "formula", as: "rate", expr: "datum.a ? datum.e / datum.a * 100 : 0" },
            { type: "formula", as: "value", expr: "metric === 'time' ? datum.cycle : metric === 'throughput' ? datum.c : datum.rate" },
            { type: "formula", as: "display", expr: `metric === 'time' ? ${F.duration("datum.cycle")} : metric === 'throughput' ? ${F.compact("datum.c")} : format(datum.rate, '.1f') + '%'` },
            { type: "formula", as: "sub", expr: `metric === 'time' ? ${F.compact("datum.c")} + ' cases' : metric === 'exrate' ? ${F.int("datum.e")} + ' exc' : ''` },
            { type: "formula", as: "color", expr: `metric === 'exrate' ? '${C.system}' : '${C.completed}'` },
            { type: "collect", sort: { field: "value", order: "descending" } },
          ],
        },
      ],
      marks: seg.marks,
    },
    hbars({ data: "bars", labelW: 160, valueW: 70, rowH: 25, barH: 9, click: true }),
  );
};

const exceptionTrend = () => {
  const seg = segmented({ signal: "grain", options: [{ value: "daily", label: "Daily" }, { value: "monthly", label: "Monthly" }] });
  return merge(
    dailyBlock({ keys: ["b", "s"] }),
    frame({ title: "Exception time trend", subtitle: "Exception volume over time, system vs business", legend: [{ label: "System", color: C.system }, { label: "Business", color: C.business }], legendBelow: true }),
    { signals: [{ name: "grain", value: "daily", on: seg.on }], marks: seg.marks },
    grainFlow(["b", "s"]),
    timeChart({
      data: "flow",
      xFmt: (e) => `grain === 'monthly' ? ${F.month(e)} : ${F.day(e)}`,
      tipDateFmt: (e) => `grain === 'monthly' ? ${F.month(e)} : ${F.dayLong(e)}`,
      series: [
        { field: "s", name: "System exception", color: C.system, area: true },
        { field: "b", name: "Business exception", color: C.business },
      ],
    }),
  );
};

const league = () =>
  merge(
    processCatalogue(),
    targetsBlock(),
    byProcess("bp", ["c", "a", "e", "cw", "ec"]),
    frame({ title: "Process league table", subtitle: "Sorted by cost contribution · click a row to filter" }),
    {
      signals: [
        { name: "pick", on: [{ events: "@tb_row:click", update: addFilter("process.name", "datum.name") }] },
        { name: "wCycle", update: "length(data('lgsum')) ? data('lgsum')[0].wc / max(1, data('lgsum')[0].a) : 0" },
      ],
      data: [
        {
          name: "lg",
          source: "bp",
          transform: [
            { type: "formula", as: "cycle", expr: "datum.c ? datum.cw / datum.c : 0" },
            { type: "formula", as: "rate", expr: "datum.a ? datum.e / datum.a : 0" },
            { type: "formula", as: "wc", expr: "datum.cycle * datum.a" },
            { type: "collect", sort: { field: "ec", order: "descending" } },
          ],
        },
        { name: "lgsum", source: "lg", transform: [{ type: "aggregate", ops: ["sum", "sum"], fields: ["wc", "a"], as: ["wc", "a"] }] },
      ],
      marks: [
        { type: "text", encode: { update: { x: { value: PAD + 2 }, y: { signal: "height - 22" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12.5 }, fill: { value: C.inkSoft }, text: { value: "Weighted avg cycle time" } } } },
        { type: "text", encode: { update: { x: { signal: `width - ${PAD}` }, y: { signal: "height - 22" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 12.5 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { signal: F.duration("wCycle") } } } },
      ],
    },
    table({
      data: "lg",
      rowH: 24,
      headH: 26,
      height: "ch - 30",
      band: false,
      rowClick: true,
      columns: [
        { label: "Process", text: "datum.name", swatch: "datum.spokeColor" },
        { label: "Cycle", w: 70, align: "right", font: "mono", text: F.duration("datum.cycle") },
        { label: "Exc %", w: 62, align: "right", font: "mono", text: F.pct("datum.rate"), color: rateBandColor("datum.rate", "tgt_exceptionRate") },
        { label: "Cost", w: 84, align: "right", font: "mono", bold: true, text: F.money("datum.ec") },
      ],
    }),
  );

export const dashboard = {
  id: "process-analysis",
  title: "IA · Process Analysis",
  description: "Completion time, throughput and exception trends by process",
  time: { from: "now-89d/d", to: "now" },
  panels: [
    { id: "performance", title: "Process performance", grid: { x: 0, y: 0, w: 48, h: 16 }, build: performance },
    { id: "exception-trend", title: "Exception time trend", grid: { x: 0, y: 16, w: 28, h: 18 }, build: exceptionTrend },
    { id: "league", title: "Process league table", grid: { x: 28, y: 16, w: 20, h: 18 }, build: league },
  ],
};
