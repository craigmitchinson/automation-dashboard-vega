// Overview: headline performance, outcome mix and the operational watchlist.
// React source: src/pages/Overview.tsx
import { C, FONT } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, kpiTiles, timeChart, hbars, segmented, PAD } from "../lib/kit.mjs";
import { dailyBlock, T, targetsBlock } from "../lib/blocks.mjs";
import { workingTime, fteExpr, processCatalogue, byProcess, addFilter, rateBandColor } from "../lib/common.mjs";

const kpis = () => {
  const cur = (k) => T(`cur_${k}`);
  const prev = (k) => T(`prev_${k}`);
  const ratio = (a, b) => `(${b} ? ${a} / ${b} : 0)`;
  const delta = (c, p) => `(${p} ? (${c} - ${p}) / ${p} : null)`;
  const compl = ratio(cur("c"), cur("a"));
  const complP = ratio(prev("c"), prev("a"));
  const cpc = ratio(cur("ec"), cur("c"));
  const cpcP = ratio(prev("ec"), prev("c"));
  const fte = fteExpr(cur("h"));
  return merge(
    dailyBlock({ keys: ["c", "b", "s", "e", "a", "h", "gb", "ec"] }),
    targetsBlock(),
    workingTime(),
    {
      data: [
        {
          name: "tiles",
          values: [
            { i: 0, label: "Completion rate", accent: C.good, deltaGood: "up" },
            { i: 1, label: "Cost per completed case", accent: C.accent, deltaGood: "down" },
            { i: 2, label: "Exceptions", accent: C.system, deltaGood: "down" },
            { i: 3, label: "Net/FTE value", accent: C.business, deltaGood: "up" },
            { i: 4, label: "Completed cases", accent: C.completed, deltaGood: "up" },
            { i: 5, label: "Colleague time saved", accent: C.accent, deltaGood: "up" },
          ],
          transform: [
            {
              type: "formula",
              as: "value",
              expr: `[${F.pct(compl)}, ${F.money2(cpc)}, ${F.compact(cur("e"))}, ${fte} > 0 ? ${F.moneyCompact(`(${cur("gb")} - ${cur("ec")}) / ${fte}`)} : '–', ${F.compact(cur("c"))}, ${F.compact(cur("h"))} + ' h'][datum.i]`,
            },
            { type: "formula", as: "delta", expr: `[${delta(compl, complP)}, ${delta(cpc, cpcP)}, ${delta(cur("e"), prev("e"))}, null, ${delta(cur("c"), prev("c"))}, ${delta(cur("h"), prev("h"))}][datum.i]` },
            { type: "formula", as: "sub", expr: `['straight-through', 'fully-loaded estate', 'vs prev. period', format(${fte}, '.1f') + ' FTE released', 'vs prev. period', 'vs prev. period'][datum.i]` },
            { type: "formula", as: "target", expr: `[ '≥ ' + ${F.pct("tgt_completionPct", 0)}, '≤ ' + ${F.money2("tgt_costPerCase")}, '', '', '', ''][datum.i]` },
            { type: "formula", as: "met", expr: `[${compl} >= tgt_completionPct, ${cpc} <= tgt_costPerCase, true, true, true, true][datum.i]` },
          ],
        },
        {
          name: "spark",
          source: "series",
          transform: [
            { type: "window", ops: ["row_number"], as: ["i"] },
            { type: "fold", fields: ["e", "c"], as: ["k", "v"] },
            { type: "formula", as: "tile", expr: "datum.k === 'e' ? 2 : 4" },
          ],
        },
      ],
    },
    kpiTiles({ n: 6, spark: "spark" }),
  );
};

const dailyFlow = () => {
  const seg = segmented({ signal: "smooth", options: [{ value: "off", label: "Daily" }, { value: "on", label: "7-day avg" }] });
  const legend = [
    { label: "Completed", color: C.completed },
    { label: "Business exception", color: C.business },
    { label: "System exception", color: C.system },
  ];
  return merge(
    dailyBlock({ keys: ["c", "b", "s"] }),
    frame({ title: "Daily case flow", subtitle: "Cases processed per day by outcome", legend, legendBelow: true }),
    {
      signals: [{ name: "smooth", value: "off", on: seg.on }],
      data: [
        {
          name: "flow",
          source: "series",
          transform: [
            { type: "window", ops: ["mean", "mean", "mean"], fields: ["c", "b", "s"], as: ["c7", "b7", "s7"], frame: [-6, 0] },
            { type: "formula", as: "yc", expr: "smooth === 'on' && ndays >= 60 ? datum.c7 : datum.c" },
            { type: "formula", as: "yb", expr: "smooth === 'on' && ndays >= 60 ? datum.b7 : datum.b" },
            { type: "formula", as: "ys", expr: "smooth === 'on' && ndays >= 60 ? datum.s7 : datum.s" },
          ],
        },
      ],
      marks: seg.marks,
    },
    timeChart({
      data: "flow",
      weekends: true,
      series: [
        { field: "yc", name: "Completed", color: C.completed, area: true },
        { field: "yb", name: "Business exception", color: C.business },
        { field: "ys", name: "System exception", color: C.system },
      ],
    }),
  );
};

const watchlist = () =>
  merge(
    processCatalogue(),
    targetsBlock(),
    byProcess("bp", ["a", "e", "ec"]),
    frame({ title: "Watchlist", subtitle: "Highest exception rate · click a row to filter to that process" }),
    {
      data: [
        {
          name: "watch",
          source: "bp",
          transform: [
            { type: "filter", expr: "datum.a > 0" },
            { type: "formula", as: "rate", expr: "datum.e / datum.a" },
            { type: "collect", sort: { field: "rate", order: "descending" } },
            { type: "window", ops: ["row_number"], as: ["rank"] },
            { type: "filter", expr: "datum.rank <= 5" },
          ],
        },
      ],
      signals: [{ name: "pick", on: [{ events: "@wl_row:click", update: addFilter("process.name", "datum.name") }] }],
      marks: [
        {
          type: "group",
          name: "wl_row",
          from: { data: "watch" },
          encode: {
            update: {
              x: { value: PAD },
              y: { signal: "top + (datum.rank - 1) * max(44, ch / 5)" },
              width: { signal: "cw" },
              height: { signal: "max(44, ch / 5)" },
              fill: { value: "transparent" },
              cursor: { value: "pointer" },
            },
            hover: { fill: { value: C.band } },
          },
          marks: [
            { type: "rule", encode: { update: { x: { value: 0 }, x2: { signal: "cw" }, y: { value: 0 }, stroke: { value: C.rule }, opacity: { signal: "parent.rank > 1 ? 1 : 0" } } } },
            {
              type: "text",
              encode: { update: { x: { value: 0 }, y: { signal: "item.mark.group.height / 2 - 2" }, baseline: { value: "bottom" }, font: { value: FONT.body }, fontSize: { value: 13.5 }, fontWeight: { value: "bold" }, fill: { value: C.ink }, text: { field: { parent: "name" } }, limit: { signal: "cw - 150" } } },
            },
            {
              type: "text",
              encode: { update: { x: { value: 0 }, y: { signal: "item.mark.group.height / 2 + 2" }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 11 }, fill: { value: C.inkSoft }, text: { signal: `parent.queue + ' · ' + ${F.int("parent.e")} + ' exceptions'` }, limit: { signal: "cw - 150" } } },
            },
            {
              type: "text",
              encode: { update: { x: { signal: "cw - 66" }, y: { signal: "item.mark.group.height / 2" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 11.5 }, fill: { value: C.inkSoft }, text: { signal: F.gbp("parent.ec") } } },
            },
            {
              type: "text",
              encode: {
                update: {
                  x: { signal: "cw" },
                  y: { signal: "item.mark.group.height / 2" },
                  align: { value: "right" },
                  baseline: { value: "middle" },
                  font: { value: FONT.mono },
                  fontSize: { value: 14 },
                  fontWeight: { value: "bold" },
                  fill: { signal: rateBandColor("parent.rate", "tgt_exceptionRate") },
                  text: { signal: F.pct("parent.rate") },
                },
              },
            },
          ],
        },
      ],
    },
  );

const throughput = () =>
  merge(
    processCatalogue(),
    byProcess("bp", ["c"]),
    frame({ title: "Throughput by process", subtitle: "Completed cases · click a bar to filter every panel" }),
    {
      data: [
        {
          name: "bars",
          source: "bp",
          transform: [
            { type: "collect", sort: { field: "c", order: "descending" } },
            { type: "window", ops: ["row_number"], as: ["r"] },
            { type: "filter", expr: "datum.r <= 7" },
            { type: "formula", as: "label", expr: "datum.name" },
            { type: "formula", as: "value", expr: "datum.c" },
            { type: "formula", as: "display", expr: F.compact("datum.c") },
            { type: "formula", as: "color", expr: `'${C.completed}'` },
          ],
        },
      ],
      signals: [{ name: "pick", on: [{ events: "@hb_row:click", update: addFilter("process.name", "datum.label") }] }],
    },
    hbars({ data: "bars", labelW: 160, valueW: 48, rowH: 34, barH: 16, click: true, subInBar: false }),
  );

const outcomeMix = () => {
  const total = "max(1, " + T("cur_a") + ")";
  const items = [
    { k: "c", label: "Completed", color: C.completed },
    { k: "b", label: "Business exception", color: C.business },
    { k: "s", label: "System exception", color: C.system },
  ];
  return merge(
    dailyBlock({ keys: ["c", "b", "s", "a", "ec"] }),
    frame({ title: "Outcome mix", subtitleSignal: `${F.int(T("cur_a"))} + ' cases attempted'` }),
    {
      data: [
        {
          name: "mix",
          values: items.map((it, i) => ({ ...it, i })),
          transform: [
            { type: "formula", as: "v", expr: `[${T("cur_c")}, ${T("cur_b")}, ${T("cur_s")}][datum.i]` },
            { type: "formula", as: "share", expr: `datum.v / ${total}` },
            { type: "window", ops: ["sum"], fields: ["share"], as: ["cum"], frame: [null, 0] },
            { type: "formula", as: "x0", expr: "datum.cum - datum.share" },
          ],
        },
        {
          name: "strip",
          source: "series",
          transform: [
            { type: "formula", as: "tot", expr: "datum.c + datum.b + datum.s" },
            { type: "filter", expr: "datum.tot > 0" },
            { type: "fold", fields: ["c", "b", "s"], as: ["k", "v"] },
            { type: "formula", as: "share", expr: "datum.v / datum.tot" },
            { type: "formula", as: "order", expr: "indexof(['c','b','s'], datum.k)" },
            { type: "stack", groupby: ["t"], field: "share", sort: { field: "order" }, as: ["y0", "y1"] },
          ],
        },
      ],
      scales: [
        { name: "ox", type: "linear", domain: [0, 1], range: [0, { signal: "cw" }] },
        { name: "sx", type: "band", domain: { data: "strip", field: "t", sort: true }, range: [0, { signal: "cw" }], paddingInner: 0.15 },
        { name: "sy", type: "linear", domain: [0, 1], range: [{ signal: "stripH" }, 0] },
        { name: "oc", type: "ordinal", domain: ["c", "b", "s"], range: [C.completed, C.business, C.system] },
      ],
      signals: [{ name: "stripTop", update: "top + 6 + 26 + 12 + 3 * 26 + 10" }, { name: "stripH", update: "max(0, height - stripTop - 52)" }],
      marks: [
        {
          type: "rect",
          from: { data: "mix" },
          encode: {
            update: {
              x: { signal: `${PAD} + scale('ox', datum.x0)` },
              x2: { signal: `${PAD} + max(scale('ox', datum.x0) + (datum.v > 0 ? 2 : 0), scale('ox', datum.cum) - 2)` },
              y: { signal: "top + 6" },
              height: { value: 26 },
              fill: { field: "color" },
              cornerRadius: { value: 4 },
              tooltip: { signal: `{'Outcome': datum.label, 'Cases': ${F.int("datum.v")}, 'Share': ${F.pct("datum.share")}}` },
            },
          },
        },
        ...[
          { prop: "rect", enc: (y) => ({ x: { value: PAD }, y: { signal: `${y} - 5.5` }, width: { value: 11 }, height: { value: 11 }, cornerRadius: { value: 3 }, fill: { field: "color" } }) },
          { prop: "text", enc: (y) => ({ x: { value: PAD + 21 }, y: { signal: y }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fill: { value: C.ink }, text: { field: "label" } }) },
          { prop: "text", enc: (y) => ({ x: { signal: `width - ${PAD} - 62` }, y: { signal: y }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 13 }, fontWeight: { value: "bold" }, fill: { value: C.ink }, text: { signal: F.int("datum.v") } }) },
          { prop: "text", enc: (y) => ({ x: { signal: `width - ${PAD}` }, y: { signal: y }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 12 }, fill: { value: C.inkSoft }, text: { signal: F.pct("datum.share") } }) },
        ].map((m) => ({ type: m.prop, from: { data: "mix" }, encode: { update: m.enc("top + 6 + 26 + 12 + datum.i * 26 + 13") } })),
        {
          type: "group",
          encode: { update: { x: { value: PAD }, y: { signal: "stripTop" }, width: { signal: "cw" }, height: { signal: "stripH" }, opacity: { signal: "ndays > 14 && stripH > 30 ? 1 : 0" } } },
          marks: [
            {
              type: "rect",
              from: { data: "strip" },
              encode: {
                update: {
                  x: { scale: "sx", field: "t" },
                  width: { scale: "sx", band: 1 },
                  y: { scale: "sy", field: "y1" },
                  y2: { scale: "sy", field: "y0" },
                  fill: { scale: "oc", field: "k" },
                },
              },
            },
          ],
        },
        { type: "rule", encode: { update: { x: { value: PAD }, x2: { signal: `width - ${PAD}` }, y: { signal: "height - 40" }, stroke: { value: C.rule } } } },
        { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "height - 24" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fill: { value: C.inkSoft }, text: { value: "Estate cost (period, apportioned)" } } } },
        { type: "text", encode: { update: { x: { signal: `width - ${PAD}` }, y: { signal: "height - 24" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 13 }, fontWeight: { value: "bold" }, fill: { value: C.ink }, text: { signal: F.gbp(T("cur_ec")) } } } },
      ],
    },
  );
};

export const dashboard = {
  id: "overview",
  title: "IA · Overview",
  description: "Headline performance, outcome mix and the operational watchlist",
  time: { from: "now-89d/d", to: "now" },
  panels: [
    { id: "kpis", title: "Overview KPIs", grid: { x: 0, y: 0, w: 48, h: 5 }, build: kpis },
    { id: "daily-flow", title: "Daily case flow", grid: { x: 0, y: 5, w: 29, h: 13 }, build: dailyFlow },
    { id: "watchlist", title: "Watchlist", grid: { x: 29, y: 5, w: 19, h: 13 }, build: watchlist },
    { id: "throughput", title: "Throughput by process", grid: { x: 0, y: 18, w: 27, h: 12 }, build: throughput },
    { id: "outcome-mix", title: "Outcome mix", grid: { x: 27, y: 18, w: 21, h: 12 }, build: outcomeMix },
  ],
};
