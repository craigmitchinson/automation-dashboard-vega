// Overview: headline performance, outcome mix and the operational watchlist.
// React source: src/pages/Overview.tsx
import { C, FONT } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, kpiTiles, timeChart, segmented, table, PAD } from "../lib/kit.mjs";
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
      ],
    }),
  );
};

// Day by day: the exception rate of every day in the period as a calendar,
// so a bad day (an outage, a release) stands out at once.
const calendar = () => {
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return merge(
    dailyBlock({ keys: ["a", "c", "e", "s"] }),
    targetsBlock(),
    frame({ title: "Day by day", subtitleSignal: "'Exception rate each day against the period average of ' + format(calAvg * 100, '.1f') + '% · red is worse, green better · outlined: half as bad again, 20+ items'" }),
    {
      data: [
        {
          name: "cal",
          source: "series",
          transform: [
            { type: "formula", as: "dow", expr: "(utcday(datum.t) + 6) % 7" },
            { type: "formula", as: "wk", expr: `floor((datum.t - (lo - ((utcday(lo) + 6) % 7) * 86400000)) / (7 * 86400000))` },
            { type: "formula", as: "r", expr: "datum.a ? datum.e / datum.a : null" },
          ],
        },
        { name: "calmax", source: "cal", transform: [{ type: "aggregate", ops: ["max", "max", "sum", "sum"], fields: ["r", "wk", "e", "a"], as: ["m", "w", "e", "a"] }] },
        { name: "calrows", values: DOW.map((d, i) => ({ i, d })) },
      ],
      signals: [
        { name: "nW", update: "length(data('calmax')) ? data('calmax')[0].w + 1 : 1" },
        { name: "calAvg", update: "length(data('calmax')) && data('calmax')[0].a ? data('calmax')[0].e / data('calmax')[0].a : 0" },
        { name: "cellW", update: "(cw - 40) / nW" },
        { name: "cellH", update: "(ch - 18) / 7" },
      ],
      marks: [
        { type: "text", from: { data: "calrows" }, encode: { update: { x: { value: PAD }, y: { signal: "top + 18 + (datum.i + 0.5) * cellH" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.inkSoft }, text: { field: "d" } } } },
        { type: "text", from: { data: "cal" }, encode: { update: { x: { signal: `${PAD} + 40 + datum.wk * cellW` }, y: { signal: "top + 8" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.inkSoft }, text: { signal: "datum.dow === 0 && (datum.wk % max(1, ceil(nW / 14)) === 0) ? utcFormat(datum.t, '%d %b') : ''" } } } },
        {
          type: "rect",
          from: { data: "cal" },
          encode: {
            update: {
              x: { signal: `${PAD} + 40 + datum.wk * cellW + 1` },
              width: { signal: "max(1, cellW - 2)" },
              y: { signal: "top + 18 + datum.dow * cellH + 1" },
              height: { signal: "max(1, cellH - 2)" },
              cornerRadius: { value: 3 },
              fill: { signal: `!isValid(datum.r) || !calAvg ? '${C.track}' : datum.r >= calAvg ? '${C.system}' : '${C.good}'` },
              fillOpacity: { signal: "!isValid(datum.r) || !calAvg ? 0.5 : 0.06 + 0.8 * min(1, abs(datum.r / calAvg - 1) / 0.6)" },
              stroke: { signal: `isValid(datum.r) && calAvg && datum.r > calAvg * 1.5 && datum.a >= 20 ? '${C.bad}' : null` },
              strokeWidth: { value: 1.5 },
              tooltip: { signal: `{'Day': ${F.dayLong("datum.t")}, 'Items': ${F.int("datum.a")}, 'Exception rate': ${F.pct("datum.r")}, 'Period average': ${F.pct("calAvg")}, 'System exceptions': datum.s}` },
            },
          },
        },
      ],
    },
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
    { id: "hubs", title: "Hub scorecard", grid: { x: 0, y: 30, w: 48, h: 12 }, build: hubScore },
    { id: "calendar", title: "Day by day", grid: { x: 0, y: 42, w: 48, h: 10 }, build: calendar },
  ],
};
