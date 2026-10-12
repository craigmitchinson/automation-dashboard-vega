// Unit economics charts, shown on Value & Finance: cost per completed item
// and cumulative benefit against cost, each with a 14-day forecast.
// React source: src/pages/Commercial.tsx (the page itself was retired: its
// KPIs repeated Value & Finance, and its what-if slider could only move its
// own panel in Kibana).
import { C } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, timeChart } from "../lib/kit.mjs";
import { dailyBlock, targetsBlock, globalTarget, seasonalForecast } from "../lib/blocks.mjs";

const D = 86400000;
export const costPerCase = () =>
  merge(
    dailyBlock({ keys: ["c", "a", "ec"] }),
    targetsBlock(),
    frame({ title: "Cost per completed item over time", subtitle: "Apportioned estate cost ÷ completed items, by day, with a 14-day forecast (same-weekday average of the last four weeks)" }),
    {
      data: [
        {
          name: "cpp",
          source: "series",
          transform: [
            { type: "filter", expr: "datum.a > 0" },
            { type: "formula", as: "v", expr: "datum.ec / max(datum.c, datum.a * 0.5)" },
          ],
        },
      ],
    },
    seasonalForecast({ src: "cpp", field: "v", out: "cpp_fc" }),
    timeChart({
      data: "cpp",
      series: [{ field: "v", name: "Cost / item", color: C.accent, area: true }],
      forecast: { start: "hi + 43200000", fields: ["hi"], series: [{ point: "point", lo: "lo", hi: "hi", color: C.accent }] },
      yFmt: (e) => `'£' + format(${e}, '.2f')`,
      tipFmt: (e) => `'£' + format(${e}, '.2f')`,
      refLines: [{ value: globalTarget("costPerCase"), label: `'Target £' + format(${globalTarget("costPerCase")}, '.2f')`, color: C.business }],
    }),
  );

export const cumulative = () =>
  merge(
    dailyBlock({ keys: ["gb", "ec", "a"] }),
    frame({
      title: "Cumulative benefit vs cost",
      subtitle: "Value released against estate cost, accruing, with a 14-day forecast",
      legend: [
        { label: "Cumulative benefit", color: C.good },
        { label: "Cumulative cost", color: C.system },
      ],
      legendBelow: true,
    }),
    {
      data: [
        {
          name: "cum",
          source: "series",
          transform: [
            { type: "window", sort: { field: "t" }, ops: ["sum", "sum"], fields: ["gb", "ec"], as: ["cb", "cc"], frame: [null, 0] },
          ],
        },
        { name: "act", source: "series", transform: [{ type: "filter", expr: "datum.a > 0" }] },
      ],
      signals: [
        { name: "lastCb", update: "length(data('cum')) ? data('cum')[length(data('cum')) - 1].cb : 0" },
        { name: "lastCc", update: "length(data('cum')) ? data('cum')[length(data('cum')) - 1].cc : 0" },
      ],
    },
    seasonalForecast({ src: "act", field: "gb", out: "fb" }),
    seasonalForecast({ src: "act", field: "ec", out: "fcst" }),
    {
      data: [
        {
          name: "cum_fc",
          source: "fb",
          transform: [
            { type: "lookup", from: "fcst", key: "k", fields: ["k"], as: ["c"] },
            { type: "formula", as: "cp", expr: "datum.c.point" },
            { type: "formula", as: "cl", expr: "datum.c.lo" },
            { type: "formula", as: "chh", expr: "datum.c.hi" },
            { type: "window", sort: { field: "k" }, ops: ["sum", "sum", "sum", "sum", "sum", "sum"], fields: ["point", "lo", "hi", "cp", "cl", "chh"], as: ["sbp", "sbl", "sbh", "scp", "scl", "sch"], frame: [null, 0] },
            { type: "formula", as: "bP", expr: "lastCb + datum.sbp" },
            { type: "formula", as: "bL", expr: "lastCb + datum.sbl" },
            { type: "formula", as: "bH", expr: "lastCb + datum.sbh" },
            { type: "formula", as: "cP", expr: "lastCc + datum.scp" },
            { type: "formula", as: "cL", expr: "lastCc + datum.scl" },
            { type: "formula", as: "cH", expr: "lastCc + datum.sch" },
          ],
        },
      ],
    },
    timeChart({
      data: "cum",
      series: [
        { field: "cb", name: "Cumulative benefit", color: C.good, area: true },
        { field: "cc", name: "Cumulative cost", color: C.system },
      ],
      forecast: {
        start: "hi + 43200000",
        fields: ["bH", "cH"],
        series: [
          { point: "bP", lo: "bL", hi: "bH", color: C.good },
          { point: "cP", lo: "cL", hi: "cH", color: C.system },
        ],
      },
      yFmt: F.gbpc,
      tipFmt: F.gbp,
      name: "cumc",
    }),
  );

