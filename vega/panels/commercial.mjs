// Commercial Performance: cost per case, grade-based benefit and cumulative ROI.
// React source: src/pages/Commercial.tsx
import { C, FONT } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, kpiTiles, timeChart, PAD } from "../lib/kit.mjs";
import { dailyBlock, T, targetsBlock, globalTarget, seasonalForecast } from "../lib/blocks.mjs";

const kpis = () => {
  const cpc = `(${T("cur_c")} ? ${T("cur_ec")} / ${T("cur_c")} : 0)`;
  const cpcP = `(${T("prev_c")} ? ${T("prev_ec")} / ${T("prev_c")} : 0)`;
  return merge(dailyBlock({ keys: ["c", "gb", "ec"] }), targetsBlock(), {
    data: [
      {
        name: "tiles",
        values: [
          { i: 0, label: "Cost per completed case", accent: C.accent, deltaGood: "down" },
          { i: 1, label: "Estate cost", accent: C.system },
          { i: 2, label: "Gross benefit", accent: C.good },
          { i: 3, label: "Net benefit", accent: C.completed },
          { i: 4, label: "Return on automation", accent: C.business },
        ],
        transform: [
          { type: "formula", as: "value", expr: `[${F.money2(cpc)}, ${F.gbpc(T("cur_ec"))}, ${F.gbpc(T("cur_gb"))}, ${F.gbpc(`${T("cur_gb")} - ${T("cur_ec")}`)}, ${T("cur_ec")} ? format(${T("cur_gb")} / ${T("cur_ec")}, '.1f') + '×' : '–'][datum.i]` },
          { type: "formula", as: "delta", expr: `datum.i === 0 && ${cpcP} ? (${cpc} - ${cpcP}) / ${cpcP} : null` },
          { type: "formula", as: "sub", expr: "['vs prev. period', 'Teams + Machines, period', 'SMV × grade rate in force', 'benefit less cost', 'benefit per £1 spent'][datum.i]" },
          { type: "formula", as: "target", expr: `datum.i === 0 ? '≤ ' + ${F.money2(globalTarget("costPerCase"))} : ''` },
          { type: "formula", as: "met", expr: `${cpc} <= ${globalTarget("costPerCase")}` },
        ],
      },
    ],
  }, kpiTiles({ n: 5 }));
};

// The React slider re-values benefit at a flat £/h across every page. A Vega
// panel cannot reach other panels, so the what-if lives here with its results.
const humanCost = () =>
  merge(dailyBlock({ keys: ["h", "gb", "ec"] }), frame({ title: "Human cost assumption (SMV valuation)", subtitle: "Benefit uses the grade rate in force on the day the work completed. Drag the what-if slider below the panel to test a flat rate; the results show here." }), {
    signals: [
      { name: "rateOverride", value: 0, bind: { input: "range", min: 0, max: 60, step: 1, name: "What-if £/hr (0 = grade rates) " } },
      { name: "blended", update: `${T("cur_h")} ? ${T("cur_gb")} / ${T("cur_h")} : 0` },
      { name: "wiRate", update: "rateOverride > 0 ? rateOverride : blended" },
      { name: "wiGross", update: `${T("cur_h")} * wiRate` },
      { name: "wiNet", update: `wiGross - ${T("cur_ec")}` },
      { name: "wiRoi", update: `${T("cur_ec")} ? wiGross / ${T("cur_ec")} : 0` },
      { name: "sx0", update: `${PAD} + 190` },
      { name: "sx1", update: "width - 470" },
    ],
    marks: [
      { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "top + 18" }, baseline: { value: "alphabetic" }, font: { value: FONT.display }, fontSize: { value: 22 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { signal: "'£' + format(wiRate, '.2f')" } } } },
      { type: "text", encode: { update: { x: { value: PAD + 92 }, y: { signal: "top + 18" }, font: { value: FONT.mono }, fontSize: { value: 12 }, fill: { value: C.inkSoft }, text: { value: "/hr" } } } },
      { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "top + 36" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fontWeight: { value: 600 }, fill: { signal: `rateOverride > 0 ? '${C.business}' : '${C.positive}'` }, text: { signal: "rateOverride > 0 ? 'FLAT WHAT-IF OVERRIDE' : 'GRADE RATE CARD (BLENDED)'" } } } },
      { type: "rect", encode: { update: { x: { signal: "sx0" }, x2: { signal: "sx1" }, y: { signal: "top + 9" }, height: { value: 5 }, cornerRadius: { value: 3 }, fill: { value: C.track } } } },
      { type: "rect", encode: { update: { x: { signal: "sx0" }, x2: { signal: "sx0 + (sx1 - sx0) * clamp((wiRate - 15) / 45, 0, 1)" }, y: { signal: "top + 9" }, height: { value: 5 }, cornerRadius: { value: 3 }, fill: { signal: `rateOverride > 0 ? '${C.business}' : '${C.ink}'` } } } },
      { type: "symbol", encode: { update: { x: { signal: "sx0 + (sx1 - sx0) * clamp((wiRate - 15) / 45, 0, 1)" }, y: { signal: "top + 11.5" }, size: { value: 150 }, fill: { signal: `rateOverride > 0 ? '${C.business}' : '${C.ink}'` } } } },
      { type: "symbol", encode: { update: { x: { signal: "sx0 + (sx1 - sx0) * clamp((blended - 15) / 45, 0, 1)" }, y: { signal: "top + 24" }, shape: { value: "triangle-up" }, size: { value: 40 }, fill: { value: C.inkSoft }, opacity: { signal: "rateOverride > 0 ? 1 : 0" } } } },
      { type: "text", encode: { update: { x: { signal: "sx0" }, y: { signal: "top + 34" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fill: { value: C.inkSoft }, text: { value: "£15" } } } },
      { type: "text", encode: { update: { x: { signal: "sx1" }, y: { signal: "top + 34" }, align: { value: "right" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fill: { value: C.inkSoft }, text: { value: "£60" } } } },
      ...[
        ["Gross at this rate", F.gbpc("wiGross")],
        ["Net at this rate", F.gbpc("wiNet")],
        ["ROI at this rate", "format(wiRoi, '.1f') + '×'"],
      ].flatMap(([k, v], i) => [
        { type: "text", encode: { update: { x: { signal: `width - 440 + ${i * 145}` }, y: { signal: "top + 6" }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: k.toUpperCase() } } } },
        { type: "text", encode: { update: { x: { signal: `width - 440 + ${i * 145}` }, y: { signal: "top + 34" }, font: { value: FONT.display }, fontSize: { value: 18 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { signal: v } } } },
      ]),
    ],
  });

const D = 86400000;
const costPerCase = () =>
  merge(
    dailyBlock({ keys: ["c", "a", "ec"] }),
    targetsBlock(),
    frame({ title: "Cost per completed case over time", subtitle: "Apportioned estate cost ÷ completed cases, by day, with a 14-day forecast (same-weekday average of the last four weeks)" }),
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
      series: [{ field: "v", name: "Cost / case", color: C.accent, area: true }],
      forecast: { start: "hi + 43200000", fields: ["hi"], series: [{ point: "point", lo: "lo", hi: "hi", color: C.accent }] },
      yFmt: (e) => `'£' + format(${e}, '.2f')`,
      tipFmt: (e) => `'£' + format(${e}, '.2f')`,
      refLines: [{ value: globalTarget("costPerCase"), label: `'Target £' + format(${globalTarget("costPerCase")}, '.2f')`, color: C.business }],
    }),
  );

const cumulative = () =>
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

export const dashboard = {
  id: "commercial",
  title: "IA · Commercial Performance",
  description: "Cost per case, grade-based benefit and cumulative ROI",
  time: { from: "now-89d/d", to: "now" },
  panels: [
    { id: "kpis", title: "Commercial KPIs", grid: { x: 0, y: 0, w: 48, h: 5 }, build: kpis },
    { id: "human-cost", title: "Human cost assumption", grid: { x: 0, y: 5, w: 48, h: 4 }, build: humanCost },
    { id: "cost-per-case", title: "Cost per completed case over time", grid: { x: 0, y: 9, w: 24, h: 18 }, build: costPerCase },
    { id: "cumulative", title: "Cumulative benefit vs cost", grid: { x: 24, y: 9, w: 24, h: 18 }, build: cumulative },
  ],
};
