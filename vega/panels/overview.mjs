// Overview: headline performance, outcome mix and the operational watchlist.
// React source: src/pages/Overview.tsx
import { C, FONT } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, kpiTiles, timeChart, segmented, table, wash, PAD } from "../lib/kit.mjs";
import { wide, sums } from "../lib/es.mjs";
import { dailyBlock, T, targetsBlock, grainFlow, releasesBlock, spokeColours, spokeColorExpr, MIN_VOLUME } from "../lib/blocks.mjs";
import { workingTime, fteExpr } from "../lib/common.mjs";
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
    { signals: [{ name: "view", value: "avg", on: seg.on }, { name: "grain", update: "view === 'monthly' ? 'monthly' : 'daily'" }], marks: seg.marks },
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

// Hub scorecard: every hub on the same measures, against its own targets and
// the previous equal period. Click a hub to filter.
const hubScore = () => {
  const K = ["a", "c", "e", "s", "sl", "ec", "gb", "h"];
  const tgt = (m) => `(indexof(pluck(data('tg'), 'k'), 'spoke|' + datum.name + '|${m}') >= 0 ? data('tg')[indexof(pluck(data('tg'), 'k'), 'spoke|' + datum.name + '|${m}')].v : (indexof(pluck(data('tg'), 'k'), 'global|${m}') >= 0 ? data('tg')[indexof(pluck(data('tg'), 'k'), 'global|${m}')].v : null))`;
  const dlt = (x) => `(isValid(${x}) ? (${x} >= 0 ? ' ▲' : ' ▼') + format(abs(${x}) * 100, '.0f') + '%' : '')`;
  return merge(
    dailyBlock({ keys: ["a"] }),
    targetsBlock(),
    spokeColours(),
    workingTime(),
    {
      data: [
        wide("hs_raw", {
          body: { aggs: { p: { terms: { field: "spoke.name", size: 50 }, aggs: { d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: sums(...K) } } } } },
          property: "aggregations.p.buckets",
        }),
        {
          name: "hs",
          source: "hs_raw",
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
            { type: "filter", expr: "datum.c_a > 0" },
            { type: "formula", as: "dVol", expr: "datum.p_a ? datum.c_a / datum.p_a - 1 : null" },
            { type: "formula", as: "compl", expr: "datum.c_c / datum.c_a" },
            { type: "formula", as: "tC", expr: tgt("completionPct") },
            { type: "formula", as: "exr", expr: "datum.c_e / datum.c_a" },
            { type: "formula", as: "sysr", expr: "datum.c_s / datum.c_a" },
            { type: "formula", as: "tS", expr: tgt("systemRate") },
            { type: "formula", as: "sla", expr: "datum.c_c ? datum.c_sl / datum.c_c : null" },
            { type: "formula", as: "cpi", expr: "datum.c_c ? datum.c_ec / datum.c_c : null" },
            { type: "formula", as: "dCpi", expr: "datum.c_c && datum.p_c && datum.p_ec ? datum.cpi / (datum.p_ec / datum.p_c) - 1 : null" },
            { type: "formula", as: "tCost", expr: tgt("costPerCase") },
            { type: "formula", as: "net", expr: "datum.c_gb - datum.c_ec" },
            { type: "formula", as: "dNet", expr: "datum.net - (datum.p_gb - datum.p_ec)" },
            { type: "formula", as: "fte", expr: fteExpr("datum.c_h") },
            { type: "formula", as: "misses", expr: "(datum.compl < datum.tC ? 1 : 0) + (datum.sysr > datum.tS ? 1 : 0) + (isValid(datum.cpi) && datum.cpi > datum.tCost ? 1 : 0)" },
            { type: "collect", sort: { field: ["misses", "c_a"], order: ["descending", "descending"] } },
          ],
        },
      ],
      signals: [{ name: "pickHs", on: [{ events: "@hs_row:click", update: addFilter("spoke.name", "datum.name") }] }],
    },
    frame({ title: "Hub scorecard", subtitle: "Every hub on the same measures for the period, against its own targets · arrows compare with the previous period · click a hub to filter" }),
    table({
      data: "hs",
      name: "hs",
      rowH: 30,
      rowTip: `{'Hub': datum.name, 'Items, this period': ${F.int("datum.c_a")}, 'Items, previous period': ${F.int("datum.p_a")}, 'Completion / target': ${F.pct("datum.compl")} + ' / ' + ${F.pct("datum.tC", 0)}, 'System exceptions / target': ${F.pct("datum.sysr")} + ' / ' + ${F.pct("datum.tS", 0)}, 'Within SLA': ${F.pct("datum.sla")}, 'Cost per item / target': ${F.money2("datum.cpi")} + ' / ' + ${F.money2("datum.tCost")}, 'Net benefit': ${F.gbp("datum.net")}, 'Net change vs previous': ${F.gbp("datum.dNet")}, 'Targets missed': datum.misses, '': 'click to filter to this hub'}`,
      rowClick: true,
      columns: [
        { label: "Hub", text: "datum.name", bold: true, swatch: spokeColorExpr("datum.name") },
        { label: "Items", w: 110, align: "right", font: "mono", text: `${F.int("datum.c_a")} + ${dlt("datum.dVol")}` },
        { label: "Completion", w: 130, align: "right", font: "mono", text: `${F.pct("datum.compl")} + ' / ' + ${F.pct("datum.tC", 0)}`, color: `datum.compl < datum.tC ? '${C.bad}' : '${C.good}'` },
        { label: "System exc.", w: 120, align: "right", font: "mono", text: `${F.pct("datum.sysr")} + ' / ' + ${F.pct("datum.tS", 0)}`, color: `datum.sysr > datum.tS ? '${C.bad}' : '${C.good}'` },
        { label: "All exceptions", w: 110, align: "right", font: "mono", text: F.pct("datum.exr") },
        { label: "Within SLA", w: 96, align: "right", font: "mono", text: F.pct("datum.sla"), color: `datum.sla < 0.95 ? '${C.bad}' : '${C.ink}'` },
        { label: "Cost per item", w: 150, align: "right", font: "mono", text: `${F.money2("datum.cpi")} + ' / ' + ${F.money2("datum.tCost")}`, color: `isValid(datum.cpi) && datum.cpi > datum.tCost ? '${C.bad}' : '${C.good}'`, tip: `'vs previous period ' + ${dlt("datum.dCpi")}` },
        { label: "Net benefit", w: 130, align: "right", font: "mono", bold: true, text: F.gbp("datum.net"), color: `datum.net < 0 ? '${C.bad}' : '${C.ink}'`, tip: `'change vs previous period ' + ${F.gbp("datum.dNet")}` },
        { label: "FTE released", w: 104, align: "right", font: "mono", text: "format(datum.fte, '.1f')" },
        { label: "Exceptions, weekly", w: 150, align: "right", text: "''" },
      ],
    }),
    {
      // each hub's exception rate week by week across the period, beside its row
      data: [
        {
          name: "hs_wk",
          source: "hs_raw",
          transform: [
            { type: "formula", as: "name", expr: "datum.key" },
            { type: "flatten", fields: ["d.buckets"], as: ["b"] },
            { type: "filter", expr: "datum.b.key >= lo && datum.b.key <= hi" },
            { type: "formula", as: "w", expr: "floor((datum.b.key - lo) / (7 * 86400000))" },
            { type: "formula", as: "e", expr: "datum.b.e.value" },
            { type: "formula", as: "a", expr: "datum.b.a.value" },
            { type: "aggregate", groupby: ["name", "w"], ops: ["sum", "sum"], fields: ["e", "a"], as: ["e", "a"] },
            { type: "formula", as: "r", expr: "datum.a ? datum.e / datum.a : null" },
            { type: "lookup", from: "hs_rows", key: "name", fields: ["name"], values: ["rank"], as: ["rank"] },
            { type: "filter", expr: "isValid(datum.rank) && isValid(datum.r)" },
          ],
        },
      ],
      marks: [
        {
          type: "group",
          from: { facet: { data: "hs_wk", name: "hsf", groupby: ["name", "rank"] } },
          encode: { update: { x: { signal: `${PAD} + cw - 140` }, y: { signal: "top + 26 + (datum.rank - 1) * hs_rh + hs_rh / 2 - 10" }, width: { value: 128 }, height: { value: 20 } } },
          scales: [
            { name: "sx2", type: "linear", domain: { data: "hsf", field: "w" }, range: [2, 120] },
            { name: "sy2", type: "linear", domain: { data: "hsf", field: "r" }, range: [19, 2], zero: false },
          ],
          marks: [
            { type: "area", from: { data: "hsf" }, encode: { update: { x: { scale: "sx2", field: "w" }, y: { scale: "sy2", field: "r" }, y2: { value: 20 }, fill: { value: wash(C.system, 0.25) } } } },
            {
              type: "line",
              from: { data: "hsf" },
              encode: { update: { x: { scale: "sx2", field: "w" }, y: { scale: "sy2", field: "r" }, stroke: { value: C.system }, strokeWidth: { value: 1.5 }, tooltip: { signal: `{'Hub': datum.name, 'Week': datum.w + 1, 'Exception rate': ${F.pct("datum.r")}, 'Items': datum.a}` } } },
            },
          ],
        },
      ],
    },
  );
};

// Day by day: each day's exception rate as a calendar, shaded against the
// period's own average so a bad day (an outage, a release) stands out.
const calendar = () => {
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const cx = `${PAD} + 34 + datum.wk * cellW`;
  const cy = "top + 20 + datum.dow * cellH";
  const LOWV = 20; // fewer items than this: rate not meaningful, shown muted
  return merge(
    dailyBlock({ keys: ["a", "c", "e", "s"] }),
    frame({ title: "Day by day", subtitleSignal: "'Exception rate each day, %, against the period average of ' + format(calAvg * 100, '.1f') + '% · outlined: half as bad again'" }),
    {
      data: [
        {
          name: "cal",
          source: "series",
          transform: [
            { type: "formula", as: "dow", expr: "(utcday(datum.t) + 6) % 7" },
            { type: "formula", as: "wk", expr: `floor((datum.t - (lo - ((utcday(lo) + 6) % 7) * 86400000)) / (7 * 86400000))` },
            { type: "formula", as: "r", expr: "datum.a ? datum.e / datum.a : null" },
            { type: "formula", as: "ok", expr: `datum.a >= ${LOWV}` },
          ],
        },
        { name: "calmax", source: "cal", transform: [{ type: "aggregate", ops: ["max", "sum", "sum"], fields: ["wk", "e", "a"], as: ["w", "e", "a"] }] },
        { name: "calrows", values: DOW.map((d, i) => ({ i, d })) },
        { name: "calkey", values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => ({ i })) },
      ],
      signals: [
        { name: "nW", update: "length(data('calmax')) ? data('calmax')[0].w + 1 : 1" },
        { name: "calAvg", update: "length(data('calmax')) && data('calmax')[0].a ? data('calmax')[0].e / data('calmax')[0].a : 0" },
        { name: "cellW", update: "min(64, (cw - 34) / nW)" },
        { name: "cellH", update: "(ch - 44) / 7" },
        { name: "showTxt", update: "cellW >= 30 && cellH >= 16" },
      ],
      scales: [
        { name: "calc", type: "linear", domain: { signal: "[calAvg * 0.5, calAvg, calAvg * 1.6]" }, range: ["#D5E6DD", "#F4EBDD", C.system], clamp: true, interpolate: "lab" },
      ],
      marks: [
        { type: "text", from: { data: "calrows" }, encode: { update: { x: { value: PAD }, y: { signal: "top + 20 + (datum.i + 0.5) * cellH" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.inkSoft }, text: { field: "d" } } } },
        { type: "text", from: { data: "cal" }, encode: { update: { x: { signal: `${cx} + 2` }, y: { signal: "top + 9" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.inkSoft }, text: { signal: "datum.dow === 0 && (datum.wk % max(1, ceil(nW / 13)) === 0) ? utcFormat(datum.t, '%d %b') : ''" } } } },
        {
          type: "rect",
          from: { data: "cal" },
          encode: {
            update: {
              x: { signal: `${cx} + 1.5` },
              width: { signal: "max(1, cellW - 3)" },
              y: { signal: `${cy} + 1.5` },
              height: { signal: "max(1, cellH - 3)" },
              cornerRadius: { value: 4 },
              fill: { signal: `datum.ok && calAvg ? scale('calc', datum.r) : '${C.paperDeep}'` },
              stroke: { signal: `datum.ok && calAvg && datum.r > calAvg * 1.5 ? '${C.ink}' : '${C.rule}'` },
              strokeWidth: { signal: "datum.ok && calAvg && datum.r > calAvg * 1.5 ? 1.6 : 0.6" },
              tooltip: { signal: `{'Day': ${F.dayLong("datum.t")}, 'Items': ${F.int("datum.a")}, 'Exception rate': ${F.pct("datum.r")}, 'Period average': ${F.pct("calAvg")}, 'System exceptions': datum.s}` },
            },
          },
        },
        {
          type: "text",
          from: { data: "cal" },
          interactive: false,
          encode: {
            update: {
              x: { signal: `${cx} + cellW / 2` },
              y: { signal: `${cy} + cellH / 2` },
              align: { value: "center" },
              baseline: { value: "middle" },
              font: { value: FONT.mono },
              fontSize: { signal: "cellW >= 44 ? 11 : 9.5" },
              fontWeight: { signal: "datum.ok && datum.r > calAvg * 1.25 ? 600 : 400" },
              fill: { signal: `!datum.ok ? '${C.inkMuted}' : datum.r > calAvg * 1.35 ? '#FFFFFF' : '${C.ink}'` },
              text: { signal: "showTxt && isValid(datum.r) ? format(datum.r * 100, '.1f') : ''" },
            },
          },
        },
        // key: below average, average, above
        { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "height - 18" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.inkSoft }, text: { value: "BETTER" } } } },
        { type: "rect", from: { data: "calkey" }, encode: { update: { x: { signal: `${PAD} + 54 + datum.i * 14` }, y: { signal: "height - 24" }, width: { value: 12 }, height: { value: 12 }, cornerRadius: { value: 3 }, fill: { signal: "scale('calc', calAvg * (0.5 + datum.i * 0.1))" } } } },
        { type: "text", encode: { update: { x: { signal: `${PAD} + 54 + 12 * 14 + 6` }, y: { signal: "height - 18" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.inkSoft }, text: { value: "WORSE" } } } },
        { type: "text", encode: { update: { x: { signal: `${PAD} + 54 + 12 * 14 + 56` }, y: { signal: "height - 18" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 11 }, fill: { value: C.inkSoft }, text: { value: "Grey: under 20 items that day, too few to judge" } } } },
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
    { id: "hubs", title: "Hub scorecard", grid: { x: 0, y: 18, w: 48, h: 12 }, build: hubScore },
    { id: "moved", title: "What moved", grid: { x: 0, y: 30, w: 26, h: 14 }, build: moved },
    { id: "calendar", title: "Day by day", grid: { x: 26, y: 30, w: 22, h: 14 }, build: calendar },
  ],
};
