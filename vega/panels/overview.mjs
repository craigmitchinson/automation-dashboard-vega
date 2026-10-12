// Overview: headline performance, outcome mix and the operational watchlist.
// React source: src/pages/Overview.tsx
import { C, FONT } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, kpiTiles, timeChart, segmented, table, PAD } from "../lib/kit.mjs";
import { wide, sums } from "../lib/es.mjs";
import { dailyBlock, T, targetsBlock, grainFlow, releasesBlock, MIN_VOLUME } from "../lib/blocks.mjs";
import { processCatalogue, byProcess, addFilter, rateBandColor } from "../lib/common.mjs";

const kpis = () => {
  const cur = (k) => T(`cur_${k}`);
  const prev = (k) => T(`prev_${k}`);
  const ratio = (a, b) => `(${b} ? ${a} / ${b} : 0)`;
  const delta = (c, p) => `(${p} ? (${c} - ${p}) / ${p} : null)`;
  const compl = ratio(cur("c"), cur("a"));
  const complP = ratio(prev("c"), prev("a"));
  const cpc = ratio(cur("ec"), cur("c"));
  const cpcP = ratio(prev("ec"), prev("c"));
  return merge(
    dailyBlock({ keys: ["c", "b", "s", "e", "a", "h", "ec", "cd"] }),
    targetsBlock(),
    {
      data: [
        {
          name: "tiles",
          values: [
            { i: 0, label: "Completion rate", accent: C.good, deltaGood: "up" },
            { i: 1, label: "Cost per completed item", accent: C.accent, deltaGood: "down" },
            { i: 2, label: "Exceptions", accent: C.system, deltaGood: "down" },
            { i: 3, label: "Cases completed", accent: C.business, deltaGood: "up" },
            { i: 4, label: "Items completed", accent: C.completed, deltaGood: "up" },
            { i: 5, label: "Colleague time saved", accent: C.accent, deltaGood: "up" },
          ],
          transform: [
            {
              type: "formula",
              as: "value",
              expr: `[${F.pct(compl)}, ${F.money2(cpc)}, ${F.compact(cur("e"))}, ${F.compact(cur("cd"))}, ${F.compact(cur("c"))}, ${F.compact(cur("h"))} + ' h'][datum.i]`,
            },
            { type: "formula", as: "delta", expr: `[${delta(compl, complP)}, ${delta(cpc, cpcP)}, ${delta(cur("e"), prev("e"))}, ${delta(cur("cd"), prev("cd"))}, ${delta(cur("c"), prev("c"))}, ${delta(cur("h"), prev("h"))}][datum.i]` },
            { type: "formula", as: "sub", expr: `['items completed of attempted', 'fully-loaded estate', 'vs prev. period', 'finished end to end, ' + format(${cur("c")} / max(1, ${cur("cd")}), '.2f') + ' items each', 'includes retries and stages', 'vs prev. period'][datum.i]` },
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
  const seg = segmented({ signal: "view", options: [{ value: "daily", label: "Daily" }, { value: "avg", label: "7-day avg" }, { value: "monthly", label: "Monthly" }] });
  const legend = [
    { label: "Completed", color: C.completed },
    { label: "Business exception", color: C.business },
    { label: "System exception", color: C.system },
  ];
  return merge(
    dailyBlock({ keys: ["c", "b", "s"] }),
    releasesBlock(),
    frame({ title: "Item flow", subtitleSignal: "(view === 'monthly' ? 'Items per month' : view === 'avg' ? 'Items per day, trailing 7-day average' : 'Items per day') + ' by outcome · ◆ marks a release or change'", legend, legendBelow: true }),
    { signals: [{ name: "view", value: "daily", on: seg.on }, { name: "grain", update: "view === 'monthly' ? 'monthly' : 'daily'" }], marks: seg.marks },
    grainFlow(["c", "b", "s"]),
    {
      data: [
        {
          name: "flow2",
          source: "flow",
          transform: [
            { type: "window", ops: ["mean", "mean", "mean"], fields: ["c", "b", "s"], as: ["c7", "b7", "s7"], frame: [-6, 0] },
            { type: "formula", as: "yc", expr: "view === 'avg' ? datum.c7 : datum.c" },
            { type: "formula", as: "yb", expr: "view === 'avg' ? datum.b7 : datum.b" },
            { type: "formula", as: "ys", expr: "view === 'avg' ? datum.s7 : datum.s" },
          ],
        },
      ],
    },
    timeChart({
      data: "flow2",
      markers: "rel",
      xFmt: (e) => `view === 'monthly' ? ${F.month(e)} : ${F.day(e)}`,
      tipDateFmt: (e) => `view === 'monthly' ? ${F.month(e)} : ${F.dayLong(e)}`,
      weekends: "view !== 'monthly'",
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
    frame({ title: "Watchlist", subtitle: `Highest exception rate, ${MIN_VOLUME}+ attempts · click a row to filter` }),
    {
      data: [
        {
          name: "watch",
          source: "bp",
          transform: [
            { type: "filter", expr: `datum.a >= ${MIN_VOLUME}` },
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
              encode: { update: { x: { value: 0 }, y: { signal: "item.mark.group.height / 2 - 2" }, baseline: { value: "bottom" }, font: { value: FONT.body }, fontSize: { value: 13.5 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { field: { parent: "name" } }, limit: { signal: "cw - 150" } } },
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
                  fontWeight: { value: 600 },
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

// What moved: each process this period against the equal period before, ranked
// by the change in net benefit, so the first rows are where to look.
const moved = () => {
  const K = ["a", "e", "c", "ec", "gb"];
  const pct = (x) => `(isValid(${x}) ? (${x} >= 0 ? '+' : '') + format(${x} * 100, '.0f') + '%' : '–')`;
  return merge(
    dailyBlock({ keys: ["a"] }),
    {
      data: [
        wide("mv_raw", {
          body: { aggs: { p: { terms: { field: "process.name", size: 25 }, aggs: { d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: sums(...K) } } } } },
          property: "aggregations.p.buckets",
        }),
        {
          name: "mv",
          source: "mv_raw",
          transform: [
            { type: "formula", as: "name", expr: "datum.key" },
            { type: "flatten", fields: ["d.buckets"], as: ["b"] },
            { type: "formula", as: "inC", expr: "datum.b.key >= lo && datum.b.key <= hi ? 1 : 0" },
            { type: "formula", as: "inP", expr: "datum.b.key >= plo && datum.b.key <= phi ? 1 : 0" },
            ...K.flatMap((k) => [
              { type: "formula", as: `c_${k}`, expr: `datum.inC * datum.b['${k}'].value` },
              { type: "formula", as: `p_${k}`, expr: `datum.inP * datum.b['${k}'].value` },
            ]),
            { type: "aggregate", groupby: ["name"], ops: K.flatMap(() => ["sum", "sum"]), fields: K.flatMap((k) => [`c_${k}`, `p_${k}`]), as: K.flatMap((k) => [`c_${k}`, `p_${k}`]) },
            { type: "filter", expr: `datum.c_a >= ${MIN_VOLUME} && datum.p_a >= ${MIN_VOLUME}` },
            { type: "formula", as: "dVol", expr: "(datum.c_a - datum.p_a) / datum.p_a" },
            { type: "formula", as: "rate", expr: "datum.c_e / datum.c_a" },
            { type: "formula", as: "dRate", expr: "datum.rate - datum.p_e / datum.p_a" },
            { type: "formula", as: "cpi", expr: "datum.c_c ? datum.c_ec / datum.c_c : null" },
            { type: "formula", as: "dCpi", expr: "datum.c_c && datum.p_c && datum.p_ec ? datum.cpi / (datum.p_ec / datum.p_c) - 1 : null" },
            { type: "formula", as: "dNet", expr: "(datum.c_gb - datum.c_ec) - (datum.p_gb - datum.p_ec)" },
            { type: "formula", as: "mag", expr: "abs(datum.dNet)" },
            { type: "collect", sort: { field: "mag", order: "descending" } },
          ],
        },
      ],
      signals: [{ name: "pickMv", on: [{ events: "@mv_row:click", update: addFilter("process.name", "datum.name") }] }],
    },
    frame({ title: "What moved", subtitle: `Each process against the previous equal period, biggest change in net benefit first · ${MIN_VOLUME}+ attempts in both · click a row to filter` }),
    table({
      data: "mv",
      name: "mv",
      rowH: 26,
      rowClick: true,
      columns: [
        { label: "Process", text: "datum.name", bold: true },
        { label: "Items", w: 66, align: "right", font: "mono", text: pct("datum.dVol"), color: `'${C.inkSoft}'` },
        { label: "Exception rate", w: 120, align: "right", font: "mono", text: `${F.pct("datum.rate")} + ' ' + (datum.dRate >= 0 ? '+' : '') + format(datum.dRate * 100, '.1f')`, color: `datum.dRate > 0.005 ? '${C.bad}' : datum.dRate < -0.005 ? '${C.good}' : '${C.ink}'`, tip: "'change in percentage points'" },
        { label: "Cost per item", w: 110, align: "right", font: "mono", text: `${F.money2("datum.cpi")} + ' ' + ${pct("datum.dCpi")}`, color: `datum.dCpi > 0.03 ? '${C.bad}' : datum.dCpi < -0.03 ? '${C.good}' : '${C.ink}'` },
        { label: "Net benefit change", w: 130, align: "right", font: "mono", bold: true, text: `(datum.dNet >= 0 ? '+' : '') + ${F.gbp("datum.dNet")}`, color: `datum.dNet < 0 ? '${C.bad}' : '${C.good}'` },
      ],
    }),
  );
};

const outcomeMix = () => {
  const total = "max(1, " + T("cur_a") + ")";
  const items = [
    { k: "c", label: "Completed", color: C.completed },
    { k: "b", label: "Business exception", color: C.business },
    { k: "s", label: "System exception", color: C.system },
  ];
  return merge(
    dailyBlock({ keys: ["c", "b", "s", "a", "ec"] }),
    frame({ title: "Outcome mix", subtitleSignal: `${F.int(T("cur_a"))} + ' items attempted'` }),
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
              tooltip: { signal: `{'Outcome': datum.label, 'Items': ${F.int("datum.v")}, 'Share': ${F.pct("datum.share")}}` },
            },
          },
        },
        ...[
          { prop: "rect", enc: (y) => ({ x: { value: PAD }, y: { signal: `${y} - 5.5` }, width: { value: 11 }, height: { value: 11 }, cornerRadius: { value: 3 }, fill: { field: "color" } }) },
          { prop: "text", enc: (y) => ({ x: { value: PAD + 21 }, y: { signal: y }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fill: { value: C.ink }, text: { field: "label" } }) },
          { prop: "text", enc: (y) => ({ x: { signal: `width - ${PAD} - 62` }, y: { signal: y }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 13 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { signal: F.int("datum.v") } }) },
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
        { type: "text", encode: { update: { x: { signal: `width - ${PAD}` }, y: { signal: "height - 24" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 13 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { signal: F.gbp(T("cur_ec")) } } } },
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
    { id: "daily-flow", title: "Item flow", grid: { x: 0, y: 5, w: 29, h: 13 }, build: dailyFlow },
    { id: "watchlist", title: "Watchlist", grid: { x: 29, y: 5, w: 19, h: 13 }, build: watchlist },
    { id: "moved", title: "What moved", grid: { x: 0, y: 18, w: 27, h: 12 }, build: moved },
    { id: "outcome-mix", title: "Outcome mix", grid: { x: 27, y: 18, w: 21, h: 12 }, build: outcomeMix },
  ],
};
