// Input & Outcome: case flow in and out, by outcome, daily or monthly.
// React source: src/pages/InputOutcome.tsx
import { C, FONT } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, kpiTiles, timeChart, segmented, PAD } from "../lib/kit.mjs";
import { dailyBlock, T, targetsBlock } from "../lib/blocks.mjs";

// Daily or monthly view of the zero-filled "series" dataset, as "flow".
export function grainFlow(keys, signal = "grain") {
  return {
    data: [
      {
        name: "flow",
        source: "series",
        transform: [
          { type: "formula", as: "g", expr: `${signal} === 'monthly' ? utc(utcyear(datum.t), utcmonth(datum.t), 1) : datum.t` },
          { type: "aggregate", groupby: ["g"], ops: keys.map(() => "sum"), fields: keys, as: keys },
          { type: "formula", as: "t", expr: "datum.g" },
          { type: "collect", sort: { field: "t" } },
        ],
      },
    ],
  };
}
const grainSeg = () => segmented({ signal: "grain", options: [{ value: "daily", label: "Daily" }, { value: "monthly", label: "Monthly" }] });
const xFmt = (e) => `grain === 'monthly' ? ${F.month(e)} : ${F.day(e)}`;
const tipDate = (e) => `grain === 'monthly' ? ${F.month(e)} : ${F.dayLong(e)}`;

const kpis = () =>
  merge(dailyBlock({ keys: ["c", "b", "s", "a"] }), {
    data: [
      {
        name: "tiles",
        values: [
          { i: 0, label: "Volume in", accent: C.accent },
          { i: 1, label: "Completed out", accent: C.completed },
          { i: 2, label: "Business exceptions", accent: C.business },
          { i: 3, label: "System exceptions", accent: C.system },
        ],
        transform: [
          { type: "formula", as: "value", expr: `[${F.compact(T("cur_a"))}, ${F.compact(T("cur_c"))}, ${F.compact(T("cur_b"))}, ${F.compact(T("cur_s"))}][datum.i]` },
          {
            type: "formula",
            as: "sub",
            expr: `['cases attempted', ${F.pct(`${T("cur_c")} / max(1, ${T("cur_a")})`)} + ' of intake', ${F.pct(`${T("cur_b")} / max(1, ${T("cur_a")})`)} + ' of intake', ${F.pct(`${T("cur_s")} / max(1, ${T("cur_a")})`)} + ' of intake'][datum.i]`,
          },
          { type: "formula", as: "delta", expr: "null" },
        ],
      },
    ],
  }, kpiTiles({ n: 4 }));

const caseFlow = () => {
  const seg = grainSeg();
  return merge(
    dailyBlock({ keys: ["c", "b", "s", "a"] }),
    frame({
      title: "Case flow — volume in and out by outcome".replace(" — ", ": "),
      subtitle: "Daily intake against the outcome it resolves to",
      legend: [
        { label: "Volume in (attempted)", color: C.accent, dashed: true },
        { label: "Completed", color: C.completed },
        { label: "Business exception", color: C.business },
        { label: "System exception", color: C.system },
      ],
      legendBelow: true,
    }),
    { signals: [{ name: "grain", value: "daily", on: seg.on }], marks: seg.marks },
    grainFlow(["c", "b", "s", "a"]),
    timeChart({
      data: "flow",
      xFmt,
      tipDateFmt: tipDate,
      series: [
        { field: "a", name: "Volume in", color: C.accent, dashed: true },
        { field: "c", name: "Completed", color: C.completed, area: true },
        { field: "b", name: "Business exception", color: C.business },
        { field: "s", name: "System exception", color: C.system },
      ],
    }),
  );
};

const split = () => {
  const seg = grainSeg();
  return merge(
    dailyBlock({ keys: ["c", "b", "s", "a"] }),
    targetsBlock(),
    frame({ title: "Outcome split over time", subtitleSignal: "(grain === 'monthly' ? 'Monthly' : 'Daily') + ' share of completed vs exceptions, against SLA targets'" }),
    { signals: [{ name: "grain", value: "daily", on: seg.on }], marks: seg.marks },
    grainFlow(["c", "b", "s", "a"]),
    {
      data: [
        {
          name: "share",
          source: "flow",
          transform: [
            { type: "formula", as: "cp", expr: "datum.a ? datum.c / datum.a * 100 : null" },
            { type: "formula", as: "ep", expr: "datum.a ? (datum.b + datum.s) / datum.a * 100 : null" },
          ],
        },
      ],
    },
    timeChart({
      data: "share",
      xFmt,
      tipDateFmt: tipDate,
      yDomain: [0, 100],
      yFmt: (e) => `format(${e}, '.0f') + '%'`,
      tipFmt: (e) => `format(${e}, '.1f') + '%'`,
      refLines: [
        { value: "tgt_completionPct * 100", label: `'Completion target ' + ${F.pct("tgt_completionPct", 0)}`, color: C.good },
        { value: "tgt_exceptionRate * 100", label: `'Exception ceiling ' + ${F.pct("tgt_exceptionRate", 0)}`, color: C.bad },
      ],
      series: [
        { field: "cp", name: "Completion %", color: C.completed, area: true },
        { field: "ep", name: "Exception %", color: C.system },
      ],
    }),
  );
};

const summary = () => {
  const rows = [
    ["Cases attempted", F.int(T("cur_a"))],
    ["Completed (straight-through)", F.int(T("cur_c"))],
    ["Business exceptions", F.int(T("cur_b"))],
    ["System exceptions", F.int(T("cur_s"))],
    ["Active days in range", "'' + length(data('days_cur'))"],
    ["Avg cases / day", F.int(`${T("cur_a")} / max(1, length(data('days_cur')))`)],
  ];
  return merge(
    dailyBlock({ keys: ["c", "b", "s", "a"] }),
    frame({ title: "Period summary", subtitle: "Across the current filters" }),
    {
      data: [{ name: "days_cur", source: "days", transform: [{ type: "filter", expr: "datum.key >= lo && datum.key <= hi && datum.a > 0" }] }],
      marks: rows.flatMap(([k, v], i) => [
        ...(i ? [{ type: "rule", encode: { update: { x: { value: PAD }, x2: { signal: `width - ${PAD}` }, y: { signal: `top + ${i * 40}` }, stroke: { value: C.rule } } } }] : []),
        { type: "text", encode: { update: { x: { value: PAD + 2 }, y: { signal: `top + ${i * 40 + 20}` }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fill: { value: C.inkSoft }, text: { value: k } } } },
        { type: "text", encode: { update: { x: { signal: `width - ${PAD} - 2` }, y: { signal: `top + ${i * 40 + 20}` }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 14 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { signal: v } } } },
      ]),
    },
  );
};

export const dashboard = {
  id: "input-outcome",
  title: "IA · Input & Outcome",
  description: "Case flow in and out, by outcome, daily or monthly",
  time: { from: "now-89d/d", to: "now" },
  panels: [
    { id: "kpis", title: "Input & Outcome KPIs", grid: { x: 0, y: 0, w: 48, h: 4 }, build: kpis },
    { id: "case-flow", title: "Case flow", grid: { x: 0, y: 4, w: 48, h: 15 }, build: caseFlow },
    { id: "outcome-split", title: "Outcome split over time", grid: { x: 0, y: 19, w: 24, h: 13 }, build: split },
    { id: "period-summary", title: "Period summary", grid: { x: 24, y: 19, w: 24, h: 13 }, build: summary },
  ],
};
