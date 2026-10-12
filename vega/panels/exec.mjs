// Executive Summary: the headline numbers for the exec and finance, on one
// screen, fiscal-year-to-date to the end of the picker window. Pick a single
// spoke in the Spoke control for that hub's own summary (the React page's hub
// switch). Every comparison is against the same point last fiscal year.
// React source: src/pages/ExecutiveSummary.tsx + exec-rules.ts
import { C, FONT, IDX } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, kpiTiles, table, PAD } from "../lib/kit.mjs";
import { dailyBlock, targetsBlock, globalTarget, fyBlock, financeTargets, spokeColours, spokeColorExpr } from "../lib/blocks.mjs";
import { wide, plain, sums } from "../lib/es.mjs";
import { workingTime, fteExpr, processCatalogue } from "../lib/common.mjs";
import { alertsRows } from "../lib/alerts.mjs";

const D = 86400000;
const KEYS = ["c", "b", "s", "e", "a", "h", "gb", "ec", "rw", "cd", "w"];

// FY and prior-FY totals ("fyt": cur_<k>, prev_<k>), FY months ("fym") and
// the run-rate projection. Needs dailyBlock + targetsBlock + fyBlock.
function execFy() {
  return {
    data: [
      {
        name: "fyt",
        source: "days",
        transform: [
          ...KEYS.flatMap((k) => [
            { type: "formula", as: `cur_${k}`, expr: `datum.key >= fyStart && datum.key <= hi ? datum.${k} : 0` },
            { type: "formula", as: `prev_${k}`, expr: `datum.key >= pfyStart && datum.key <= pfyHi ? datum.${k} : 0` },
          ]),
          { type: "aggregate", ops: KEYS.flatMap(() => ["sum", "sum"]), fields: KEYS.flatMap((k) => [`cur_${k}`, `prev_${k}`]), as: KEYS.flatMap((k) => [`cur_${k}`, `prev_${k}`]) },
        ],
      },
      {
        name: "fym",
        source: "days",
        transform: [
          { type: "filter", expr: "datum.key >= fyStart && datum.key <= hi" },
          { type: "formula", as: "m", expr: "utc(utcyear(datum.key), utcmonth(datum.key), 1)" },
          { type: "aggregate", groupby: ["m"], ops: ["sum", "sum", "sum"], fields: ["gb", "ec", "c"], as: ["gb", "ec", "c"] },
          { type: "formula", as: "net", expr: "datum.gb - datum.ec" },
          { type: "collect", sort: { field: "m" } },
          { type: "window", ops: ["row_number"], as: ["i"] },
        ],
      },
    ],
    signals: [
      { name: "fyDays", update: `round((hi - fyStart) / ${D}) + 1` },
      { name: "fyNet", update: `${FT("cur_gb")} - ${FT("cur_ec")}` },
      { name: "pfyNet", update: `${FT("prev_gb")} - ${FT("prev_ec")}` },
      { name: "execProjected", update: "projected" },
      { name: "hubTarget", update: "indexof(pluck(data('ftg'), 'spoke'), oneSpoke || 'ESTATE') >= 0 ? data('ftg')[indexof(pluck(data('ftg'), 'spoke'), oneSpoke || 'ESTATE')].target : null" },
      { name: "scopeName", update: "oneSpoke || 'Estate'" },
    ],
  };
}
const FT = (k) => `(length(data('fyt')) ? data('fyt')[0].${k} : 0)`;

// exec-rules.ts comparePeriods + trendLabel, as expressions
const cmpPct = (cur, prior) => `(isFinite(${prior}) && ${prior} !== 0 && ${cur} > 0 && ${prior} > 0 ? (${cur} - ${prior}) / abs(${prior}) : null)`;
const trend = (cur, prior) =>
  `(!(isFinite(${prior}) && ${prior} !== 0) ? 'no comparable figure' : (${cur} > 0 && ${prior} > 0) ? ((${cur} >= ${prior} ? '▲ ' : '▼ ') + format(abs((${cur} - ${prior}) / abs(${prior})) * 100, '.1f') + '%') : ((${cur} > ${prior} ? 'improved' : ${cur} < ${prior} ? 'worsened' : 'unchanged') + ' from ' + ${F.gbpc(prior)}))`;
const trendColor = (cur, prior) => `(!(isFinite(${prior}) && ${prior} !== 0) ? '${C.inkSoft}' : (${cur} > 0 && ${prior} > 0) ? (${cur} >= ${prior} ? '${C.positive}' : '${C.bad}') : (${cur} > ${prior} ? '${C.positive}' : ${cur} < ${prior} ? '${C.bad}' : '${C.inkSoft}'))`;

const base = () => [dailyBlock({ keys: KEYS }), targetsBlock(), fyBlock(), financeTargets(), execFy()];

const kpis = () =>
  merge(...base(), {
    data: [
      {
        name: "tiles",
        values: [
          { i: 0, label: "Net benefit", accent: C.completed, deltaGood: "up" },
          { i: 1, label: "Gross benefit", accent: C.good },
          { i: 2, label: "Estate cost", accent: C.system },
          { i: 3, label: "ROI", accent: C.business },
          { i: 4, label: "vs annual target" },
          { i: 5, label: "Projected FY-end", accent: C.accent },
        ],
        transform: [
          { type: "formula", as: "label", expr: "datum.i === 2 && oneSpoke ? 'Hub cost' : datum.i === 4 && !isValid(hubTarget) ? 'Cases completed' : datum.label" },
          { type: "formula", as: "accent", expr: `datum.i === 4 ? (isValid(hubTarget) ? (execProjected >= hubTarget ? '${C.good}' : '${C.bad}') : '${C.accent}') : datum.accent` },
          {
            type: "formula",
            as: "value",
            expr: `[${F.gbpc("fyNet")}, ${F.gbpc(FT("cur_gb"))}, ${F.gbpc(FT("cur_ec"))}, ${FT("cur_ec")} ? format(${FT("cur_gb")} / ${FT("cur_ec")}, '.1f') + '×' : '–', isValid(hubTarget) && hubTarget ? ${F.pct("execProjected / hubTarget")} : ${F.compact(FT("cur_cd"))}, ${F.gbpc("execProjected")}][datum.i]`,
          },
          { type: "formula", as: "delta", expr: `datum.i === 0 ? ${cmpPct("fyNet", "pfyNet")} : null` },
          {
            type: "formula",
            as: "sub",
            expr: `[isValid(${cmpPct("fyNet", "pfyNet")}) ? 'vs same point last FY' : ${trend("fyNet", "pfyNet")}, fyLabel, 'apportioned', 'benefit per £1 spent', isValid(hubTarget) ? 'FYTD ' + ${F.gbpc("fyNet")} + ' of ' + ${F.gbpc("hubTarget")} : 'finished end to end, ' + fyLabel, 'at the year-to-date rate'][datum.i]`,
          },
        ],
      },
      { name: "spark", source: "fym", transform: [{ type: "formula", as: "tile", expr: "0" }, { type: "formula", as: "v", expr: "datum.net" }] },
    ],
  }, kpiTiles({ n: 6, spark: "spark" }));

const operations = () => {
  const ratio = (a, b) => `(${b} ? ${a} / ${b} : 0)`;
  const d = (c, p) => `(${p} ? (${c} - ${p}) / ${p} : null)`;
  const cR = ratio(FT("cur_c"), FT("cur_a")), pR = ratio(FT("prev_c"), FT("prev_a"));
  const eR = ratio(FT("cur_e"), FT("cur_a")), peR = ratio(FT("prev_e"), FT("prev_a"));
  const cpc = ratio(FT("cur_ec"), FT("cur_c")), pcpc = ratio(FT("prev_ec"), FT("prev_c"));
  const fte = fteExpr(FT("cur_h"), "fyDays"), pfte = fteExpr(FT("prev_h"), "fyDays");
  const stats = [
    ["Items completed", F.int(FT("cur_c")), d(FT("cur_c"), FT("prev_c")), "up", null, null],
    ["Completion rate", F.pct(cR), d(cR, pR), "up", `${cR} >= ${globalTarget("completionPct")}`, `'≥ ' + ${F.pct(globalTarget("completionPct"), 0)}`],
    ["Exception rate", F.pct(eR), d(eR, peR), "down", `${eR} <= ${globalTarget("exceptionRate")}`, `'≤ ' + ${F.pct(globalTarget("exceptionRate"), 0)}`],
    ["Cost per item", F.money2(cpc), d(cpc, pcpc), "down", `${cpc} <= ${globalTarget("costPerCase")}`, `'≤ ' + ${F.money2(globalTarget("costPerCase"))}`],
    ["FTE released", `format(${fte}, '.1f')`, d(fte, pfte), "up", null, null],
    ["Hours saved", F.int(FT("cur_h")), d(FT("cur_h"), FT("prev_h")), "up", null, null],
  ];
  return merge(...base(), workingTime(), frame({ title: "Operations", titleSignal: "'Operations this period · ' + (oneSpoke ? oneSpoke + ' · ' : '') + fyLabel" }), {
    signals: [{ name: "msW", update: "(cw - 10) / 3" }, { name: "msH", update: "(ch - 6) / 2" }],
    data: [
      {
        name: "ms",
        values: stats.map((s, i) => ({ i, label: s[0].toUpperCase(), good: s[3] })),
        transform: [
          { type: "formula", as: "value", expr: `[${stats.map((s) => s[1]).join(", ")}][datum.i]` },
          { type: "formula", as: "delta", expr: `[${stats.map((s) => s[2]).join(", ")}][datum.i]` },
          { type: "formula", as: "met", expr: `[${stats.map((s) => s[4] ?? "null").join(", ")}][datum.i]` },
          { type: "formula", as: "tl", expr: `[${stats.map((s) => s[5] ?? "''").join(", ")}][datum.i]` },
          { type: "formula", as: "col", expr: "datum.i % 3" },
          { type: "formula", as: "row", expr: "floor(datum.i / 3)" },
        ],
      },
    ],
    marks: [
      {
        type: "group",
        from: { data: "ms" },
        encode: { update: { x: { signal: `${PAD} + datum.col * (msW + 5)` }, y: { signal: "top + datum.row * (msH + 6)" }, width: { signal: "msW" }, height: { signal: "msH" }, fill: { value: C.paper }, stroke: { value: C.rule }, cornerRadius: { value: 12 } } },
        marks: [
          { type: "text", encode: { update: { x: { value: 12 }, y: { value: 11 }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { field: { parent: "label" } } } } },
          { type: "text", encode: { update: { x: { value: 12 }, y: { value: 28 }, baseline: { value: "top" }, font: { value: FONT.display }, fontSize: { value: 20 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { field: { parent: "value" } } } } },
          {
            type: "text",
            encode: {
              update: {
                x: { value: 12 },
                y: { signal: "item.mark.group.height - 12" },
                font: { value: FONT.mono },
                fontSize: { value: 10 },
                fontWeight: { value: 600 },
                fill: { signal: `!isValid(parent.delta) || abs(parent.delta) < 0.001 ? '${C.inkSoft}' : ((parent.good === 'down' ? parent.delta <= 0 : parent.delta >= 0) ? '${C.good}' : '${C.bad}')` },
                text: { signal: `isValid(parent.delta) ? ${F.delta("parent.delta")} : ''` },
              },
            },
          },
          {
            type: "text",
            encode: {
              update: {
                x: { value: 74 },
                y: { signal: "item.mark.group.height - 12" },
                font: { value: FONT.mono },
                fontSize: { value: 10 },
                fill: { signal: `parent.met ? '${C.good}' : '${C.bad}'` },
                text: { signal: "isValid(parent.met) ? '● ' + parent.tl : ''" },
              },
            },
          },
        ],
      },
      {
        type: "group",
        encode: { update: { x: { signal: `${PAD} + msW - 56` }, y: { signal: "top + 22" }, width: { value: 46 }, height: { value: 18 } } },
        scales: [
          { name: "fsx", type: "linear", domain: { data: "fym", field: "i" }, range: [1, 45] },
          { name: "fsy", type: "linear", domain: { data: "fym", field: "c" }, range: [17, 1], zero: false },
        ],
        marks: [{ type: "line", from: { data: "fym" }, encode: { update: { x: { scale: "fsx", field: "i" }, y: { scale: "fsy", field: "c" }, stroke: { value: C.completed }, strokeWidth: { value: 1.6 } } } }],
      },
    ],
  });
};

// Digital-worker figures over the fiscal year.
function vdiFy() {
  return {
    data: [
      plain("vfa_raw", {
        index: IDX.vdiDaily,
        body: {
          query: { range: { "@timestamp": { gte: { "%timefilter%": "max", shift: -732, unit: "day" }, lte: { "%timefilter%": "max" }, format: "epoch_millis" } } },
          aggs: { r: { terms: { field: "resource.name", size: 500 }, aggs: { o: { terms: { field: "resource.owner_spoke", size: 1 } }, d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: { h: { sum: { field: "operating_hours" } } } } } } },
        },
        property: "aggregations.r.buckets",
      }),
      wide("vfw_raw", { body: { aggs: { r: { terms: { field: "resource.name", size: 500 }, aggs: { d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: { w: { sum: { field: "worktime_sec" } } } } } } } }, property: "aggregations.r.buckets" }),
      wide("vf_scope", { body: { aggs: { s: { terms: { field: "spoke.name", size: 100 } } } }, property: "aggregations.s.buckets" }),
      plain("vf_spokes", { index: IDX.ref, body: { size: 0, query: { term: { doc_type: "spoke" } } }, property: "hits.total" }),
      {
        name: "vfa",
        source: "vfa_raw",
        transform: [
          { type: "formula", as: "owner", expr: "datum.o.buckets[0].key" },
          { type: "formula", as: "gd", expr: "datum.d" },
          { type: "flatten", fields: ["gd.buckets"], as: ["bk"] },
          { type: "filter", expr: "datum.bk.key >= fyStart && datum.bk.key <= hi" },
          { type: "formula", as: "h", expr: "datum.bk.h.value" },
          { type: "aggregate", groupby: ["key", "owner"], ops: ["sum"], fields: ["h"], as: ["avail"] },
        ],
      },
      {
        name: "vfw",
        source: "vfw_raw",
        transform: [
          { type: "formula", as: "gd", expr: "datum.d" },
          { type: "flatten", fields: ["gd.buckets"], as: ["bk"] },
          { type: "filter", expr: "datum.bk.key >= fyStart && datum.bk.key <= hi" },
          { type: "formula", as: "w", expr: "datum.bk.w.value" },
          { type: "aggregate", groupby: ["key"], ops: ["sum", "count"], fields: ["w", "w"], as: ["w", "days"] },
        ],
      },
      {
        name: "vf",
        source: "vfa",
        transform: [
          { type: "lookup", from: "vfw", key: "key", fields: ["key"], values: ["w"], as: ["w"] },
          { type: "formula", as: "active", expr: "(datum.w || 0) / 3600" },
          { type: "formula", as: "on", expr: "datum.w > 0 ? 1 : 0" },
          { type: "filter", expr: "(datum.avail > 0 || datum.on) && (datum.on || allSp || indexof(pluck(data('vf_scope'), 'key'), datum.owner) >= 0)" },
          { type: "formula", as: "av", expr: "datum.on ? datum.avail : 0" },
          { type: "formula", as: "ac", expr: "datum.on ? datum.active : 0" },
          { type: "formula", as: "idle", expr: "datum.on ? max(0, datum.avail - datum.active) : 0" },
          { type: "aggregate", ops: ["sum", "count", "sum", "sum", "sum"], fields: ["on", "key", "av", "ac", "idle"], as: ["nOn", "nAll", "av", "ac", "idle"] },
        ],
      },
    ],
    signals: [{ name: "allSp", update: "length(data('vf_scope')) >= (length(data('vf_spokes')) ? data('vf_spokes')[0].value : 99)" }],
  };
}
const VF = (k) => `(length(data('vf')) ? data('vf')[0].${k} : 0)`;

const health = () =>
  merge(...base(), processCatalogue(), alertsRows(), vdiFy(), frame({ title: "Estate health", titleSignal: "oneSpoke ? 'Estate health · ' + oneSpoke : 'Estate health'" }), {
    data: [
      {
        name: "hub_al",
        source: "alerts",
        transform: [
          { type: "filter", expr: "!oneSpoke || datum.kind === 'estate' || datum.spoke === oneSpoke" },
          { type: "filter", expr: "datum.kind === 'process' && datum.severity === 'breach'" },
          { type: "formula", as: "own", expr: "oneSpoke && datum.spoke === oneSpoke ? 0 : 1" },
          { type: "collect", sort: { field: ["own", "atStake"], order: ["ascending", "descending"] } },
          { type: "window", ops: ["row_number"], as: ["k"] },
        ],
      },
      { name: "hub_sev", source: "hub_al", transform: [{ type: "aggregate", groupby: ["severity"], ops: ["count"], as: ["n"] }] },
      // one health line for ExCo: processes in breach and the money at stake
      {
        // per process, counting its rework exposure once (it is shared by the three rate metrics)
        name: "hub_proc",
        source: "hub_al",
        transform: [
          { type: "formula", as: "sr", expr: "datum.metric === 'costPerCase' ? 0 : datum.atStake" },
          { type: "formula", as: "sc", expr: "datum.metric === 'costPerCase' ? datum.atStake : 0" },
          { type: "formula", as: "short", expr: "({'completionPct': 'completion', 'exceptionRate': 'exceptions', 'systemRate': 'system exceptions', 'costPerCase': 'cost per item'})[datum.metric]" },
          { type: "aggregate", groupby: ["label"], ops: ["max", "max", "values"], fields: ["sr", "sc", "short"], as: ["sr", "sc", "items"] },
          { type: "formula", as: "atStake", expr: "datum.sr + datum.sc" },
          { type: "formula", as: "headline", expr: "datum.label + ': ' + join(pluck(datum.items, 'short'), ', ')" },
          { type: "collect", sort: { field: "atStake", order: "descending" } },
          { type: "window", ops: ["row_number"], as: ["k"] },
        ],
      },
      { name: "hub_proc_tot", source: "hub_proc", transform: [{ type: "aggregate", ops: ["count", "sum"], fields: ["label", "atStake"], as: ["n", "atStake"] }] },
      { name: "hub_top", source: "hub_proc", transform: [{ type: "filter", expr: "datum.k <= 4" }] },
    ],
    signals: [
      { name: "nBreach", update: "indexof(pluck(data('hub_sev'), 'severity'), 'breach') >= 0 ? data('hub_sev')[indexof(pluck(data('hub_sev'), 'severity'), 'breach')].n : 0" },
      { name: "nProc", update: "length(data('hub_proc_tot')) ? data('hub_proc_tot')[0].n : 0" },
      { name: "procStake", update: "length(data('hub_proc_tot')) ? data('hub_proc_tot')[0].atStake : 0" },
      { name: "spareItems", update: `${FT("cur_a")} && ${FT("cur_w")} && fyDays ? ${VF("idle")} * 3600 / (${FT("cur_w")} / ${FT("cur_a")}) / fyDays * 30.44 : 0` },
      { name: "nWarn", update: "indexof(pluck(data('hub_sev'), 'severity'), 'warn') >= 0 ? data('hub_sev')[indexof(pluck(data('hub_sev'), 'severity'), 'warn')].n : 0" },
    ],
    marks: [
      ...[
        ["Below target", "'' + nProc", `nProc > 0 ? '${C.bad}' : '${C.good}'`],
        ["At stake (7 days)", F.gbpc("procStake"), `procStake > 0 ? '${C.bad}' : '${C.good}'`],
        ["Active workers", `${VF("nOn")} + ' / ' + ${VF("nAll")}`, `'${C.ink}'`],
        ["Avg. utilisation", F.pct(`${VF("av")} ? ${VF("ac")} / ${VF("av")} : 0`, 0), `'${C.ink}'`],
        ["Room for more items", `'≈' + ${F.compact("spareItems")} + '/month'`, `'${C.ink}'`],
      ].flatMap(([k, v, col], i) => [
        { type: "text", encode: { update: { x: { signal: `${PAD} + ${i} * cw / 5` }, y: { signal: "top" }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: k.toUpperCase() } } } },
        { type: "text", encode: { update: { x: { signal: `${PAD} + ${i} * cw / 5` }, y: { signal: "top + 15" }, baseline: { value: "top" }, font: { value: FONT.display }, fontSize: { value: 17 }, fontWeight: { value: 600 }, fill: { signal: col }, text: { signal: v } } } },
      ]),
      { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "top + 50" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12.5 }, fontWeight: { value: 600 }, fill: { signal: `nProc ? '${C.bad}' : '${C.good}'` }, text: { signal: `nProc ? nProc + (nProc === 1 ? ' process is' : ' processes are') + ' below target this week, with ' + ${F.gbpc("procStake")} + ' at stake. Biggest first:' : 'Every process is within target this week.'` } } } },
      { type: "symbol", from: { data: "hub_top" }, encode: { update: { x: { value: PAD + 4 }, y: { signal: "top + 72 + (datum.k - 1) * 20" }, size: { value: 40 }, fill: { value: C.bad } } } },
      { type: "text", from: { data: "hub_top" }, encode: { update: { x: { value: PAD + 14 }, y: { signal: "top + 72 + (datum.k - 1) * 20" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12.5 }, fill: { value: C.ink }, text: { signal: `datum.headline + (datum.atStake >= 1 ? ' · ' + ${F.gbpc("datum.atStake")} + ' at stake' : '')` }, limit: { signal: "cw - 20" } } } },
      { type: "rule", encode: { update: { x: { value: PAD }, x2: { signal: `width - ${PAD}` }, y: { signal: "height - 26" }, stroke: { value: C.rule } } } },
      { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "height - 13" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fill: { value: C.inkSoft }, text: { signal: "'Data through ' + utcFormat(hi, '%-d %b %Y')" } } } },
      { type: "text", encode: { update: { x: { signal: `width - ${PAD}` }, y: { signal: "height - 13" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fill: { value: C.inkSoft }, text: { signal: "'Targets: trailing ' + alWindow + ' · workers: ' + fyLabel + ' · detail on Alerts'" } } } },
    ],
  });

// By hub (estate view) or by proposition (one spoke selected).
const byHub = () =>
  merge(...base(), spokeColours(), frame({ title: "By hub", titleSignal: "oneSpoke ? 'By proposition' : 'By hub'", subtitleSignal: "oneSpoke ? 'Net benefit (FYTD) by proposition within ' + oneSpoke + ', ' + fyLabel : 'Net benefit (FYTD) by spoke' + (length(data('ftg')) ? ', against target, ' : ', ') + fyLabel" }), {
    data: [
      wide("grp_raw", {
        body: {
          aggs: {
            sp: { terms: { field: "spoke.name", size: 100 }, aggs: { d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: sums("gb", "ec", "c", "e", "a") } } },
            pr: { terms: { field: "proposition.name", size: 200 }, aggs: { d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: sums("gb", "ec", "c", "e", "a") } } },
          },
        },
        property: "aggregations",
      }),
      ...["sp", "pr"].map((g) => ({
        name: `g_${g}`,
        source: "grp_raw",
        transform: [
          { type: "flatten", fields: [`${g}.buckets`], as: ["grp"] },
          { type: "formula", as: "name", expr: "datum.grp.key" },
          { type: "formula", as: "gd", expr: "datum.grp.d" },
          { type: "flatten", fields: ["gd.buckets"], as: ["bk"] },
          { type: "formula", as: "t", expr: "datum.bk.key" },
          { type: "formula", as: "net", expr: "datum.bk.gb.value - datum.bk.ec.value" },
          { type: "formula", as: "cur", expr: "datum.t >= fyStart && datum.t <= hi" },
          { type: "formula", as: "fy", expr: "datum.cur ? datum.net : 0" },
          { type: "formula", as: "pfy", expr: "datum.t >= pfyStart && datum.t <= pfyHi ? datum.net : 0" },
          ...["c", "e", "a", "ec"].map((k) => ({ type: "formula", as: k, expr: `datum.cur ? datum.bk.${k}.value : 0` })),
          { type: "formula", as: "wk", expr: `datum.t > hi - 84 * ${D} && datum.t <= hi ? min(11, floor((datum.t - (hi - 84 * ${D} + ${D})) / (7 * ${D}))) : -1` },
          { type: "aggregate", groupby: ["name"], ops: ["sum", "sum", "sum", "sum", "sum", "sum"], fields: ["fy", "pfy", "c", "e", "a", "ec"], as: ["fy", "pfy", "c", "e", "a", "ec"] },
          { type: "filter", expr: "datum.a > 0 || datum.fy !== 0" },
          { type: "formula", as: "excRate", expr: "datum.a ? datum.e / datum.a : 0" },
          { type: "formula", as: "cpc", expr: "datum.c ? datum.ec / datum.c : 0" },
        ],
      })),
      {
        name: "hubrows",
        transform: [
          { type: "sequence", start: 0, stop: { signal: "oneSpoke ? length(data('g_pr')) : length(data('g_sp'))" }, as: "i" },
          { type: "formula", as: "r", expr: "oneSpoke ? data('g_pr')[datum.i] : data('g_sp')[datum.i]" },
          ...["name", "fy", "pfy", "c", "excRate", "cpc"].map((f) => ({ type: "formula", as: f, expr: `datum.r.${f}` })),
          { type: "lookup", from: "ftg", key: "spoke", fields: ["name"], values: ["target"], as: ["target"] },
          { type: "formula", as: "vs", expr: "!oneSpoke && isValid(datum.target) && datum.target ? datum.fy / datum.target : null" },
          { type: "collect", sort: { field: "fy", order: "descending" } },
        ],
      },
      { name: "hubtot", source: "hubrows", transform: [{ type: "aggregate", ops: ["sum", "sum"], fields: ["fy", "c"], as: ["fy", "c"] }] },
    ],
  }, table({
    data: "hubrows",
    name: "hb",
    rowH: 24,
    headH: 26,
    columns: [
      { label: "Hub", labelExpr: "oneSpoke ? 'Proposition' : 'Hub'", text: "datum.name", swatch: `oneSpoke ? '${C.ink}' : ${spokeColorExpr("datum.name")}` },
      { label: "Net (FYTD)", w: 120, align: "right", text: F.gbpc("datum.fy") },
      { label: "vs target", labelExpr: "length(data('ftg')) ? 'vs target' : 'Net per item'", w: 110, align: "right", text: `length(data('ftg')) ? (isValid(datum.vs) ? ${F.pct("datum.vs")} : '–') : ${F.money2("datum.c ? datum.fy / datum.c : 0")}` },
      { label: "Items", w: 110, align: "right", text: F.int("datum.c") },
      { label: "Exception rate", w: 130, align: "right", text: F.pct("datum.excRate") },
      { label: "Cost per item", w: 120, align: "right", text: F.money2("datum.cpc") },
      { label: "Trend (vs last FY)", w: 200, align: "right", bold: true, text: trend("datum.fy", "datum.pfy"), color: trendColor("datum.fy", "datum.pfy") },
    ],
    totals: ["'Total'", F.gbpc("data('hubtot')[0].fy"), "'–'", F.int("data('hubtot')[0].c"), "'–'", "'–'", "'–'"],
  }));

// Per-process FY and prior-FY figures for movers, loss-makers and the briefing.
function procFy() {
  return {
    data: [
      wide("pf_raw", { body: { aggs: { p: { terms: { field: "process.name", size: 500 }, aggs: { d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: sums("gb", "ec", "c", "e", "a", "rw") } } } } }, property: "aggregations.p.buckets" }),
      {
        name: "pf",
        source: "pf_raw",
        transform: [
          { type: "formula", as: "name", expr: "datum.key" },
          { type: "formula", as: "gd", expr: "datum.d" },
          { type: "flatten", fields: ["gd.buckets"], as: ["bk"] },
          { type: "formula", as: "cur", expr: "datum.bk.key >= fyStart && datum.bk.key <= hi" },
          { type: "formula", as: "net", expr: "datum.cur ? datum.bk.gb.value - datum.bk.ec.value : 0" },
          { type: "formula", as: "pnet", expr: "datum.bk.key >= pfyStart && datum.bk.key <= pfyHi ? datum.bk.gb.value - datum.bk.ec.value : 0" },
          ...["c", "e", "a", "ec", "rw"].map((k) => ({ type: "formula", as: k, expr: `datum.cur ? datum.bk.${k}.value : 0` })),
          { type: "aggregate", groupby: ["name"], ops: ["sum", "sum", "sum", "sum", "sum", "sum", "sum"], fields: ["net", "pnet", "c", "e", "a", "ec", "rw"], as: ["net", "pnet", "c", "e", "a", "ec", "rw"] },
          { type: "filter", expr: "datum.a > 0" },
          {
            type: "formula",
            as: "why",
            expr: `datum.c < 30 ? 'Low volume: only ' + datum.c + ' completions this period, too few to amortise fixed cost.' : datum.rw > datum.ec * 0.3 ? 'High rework exposure: exceptions could cost more than 30% of this process\\'s automation spend.' : datum.ec / max(1, datum.c) > ${globalTarget("costPerCase")} * 1.5 ? 'High unit cost: £' + format(datum.c ? datum.ec / datum.c : datum.ec, '.2f') + '/item, over 1.5× the target cost per item (£' + format(${globalTarget("costPerCase")}, '.2f') + ').' : 'Cost exceeds benefit at the current volume and rate mix.'`,
          },
        ],
      },
      { name: "top5", source: "pf", transform: [{ type: "collect", sort: { field: "net", order: "descending" } }, { type: "window", ops: ["row_number"], as: ["k"] }, { type: "filter", expr: "datum.k <= 5" }] },
      { name: "loss3", source: "pf", transform: [{ type: "filter", expr: "datum.net < 0" }, { type: "collect", sort: { field: "net" } }, { type: "window", ops: ["row_number"], as: ["k"] }, { type: "filter", expr: "datum.k <= 3" }] },
      { name: "posSum", source: "pf", transform: [{ type: "filter", expr: "datum.net > 0" }, { type: "aggregate", ops: ["sum"], fields: ["net"], as: ["s"] }] },
      { name: "excWorst", source: "pf", transform: [{ type: "formula", as: "rate", expr: "datum.e / datum.a" }, { type: "filter", expr: `datum.rate > ${globalTarget("exceptionRate")}` }, { type: "collect", sort: { field: "rate", order: "descending" } }] },
    ],
  };
}

const movers = () =>
  merge(...base(), procFy(), frame({ title: "Movers" }), {
    signals: [
      { name: "posTot", update: "length(data('posSum')) ? data('posSum')[0].s : 0" },
      // spread the two lists over the panel's height rather than packing them at the top
      { name: "mvS", update: "clamp((ch - 40) / (18 + length(data('top5')) * 22 + 30 + 3 * 36), 1, 1.6)" },
      { name: "mr", update: "22 * mvS" },
      { name: "lr", update: "36 * mvS" },
    ],
    marks: [
      { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "top" }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { signal: "'VALUE LEAGUE · TOP ' + length(data('top5')) + ' BY NET FYTD'" } } } },
      {
        type: "group",
        from: { data: "top5" },
        encode: { update: { x: { value: PAD }, y: { signal: "top + 18 + (datum.k - 1) * mr" }, width: { signal: "cw" }, height: { value: 20 } } },
        marks: [
          { type: "text", encode: { update: { x: { value: 0 }, y: { value: 10 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12.5 }, fill: { value: C.ink }, text: { field: { parent: "name" } }, limit: { signal: "cw - 290" } } } },
          { type: "rect", encode: { update: { x: { signal: "cw - 280" }, y: { value: 7 }, width: { value: 60 }, height: { value: 6 }, cornerRadius: { value: 3 }, fill: { value: C.track } } } },
          { type: "rect", encode: { update: { x: { signal: "cw - 280" }, y: { value: 7 }, width: { signal: "posTot > 0 ? 60 * min(1, max(0, parent.net) / posTot) : 0" }, height: { value: 6 }, cornerRadius: { value: 3 }, fill: { signal: `parent.net >= 0 ? '${C.good}' : '${C.bad}'` } } } },
          { type: "text", encode: { update: { x: { signal: "cw" }, y: { value: 10 }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 11 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { signal: `${F.gbpc("parent.net")} + ' · ' + ${trend("parent.net", "parent.pnet")}` } } } },
        ],
      },
      { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "top + 18 + length(data('top5')) * mr + 12 * mvS" }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: "BOTTOM 3 (AT A LOSS)" } } } },
      {
        type: "group",
        from: { data: "loss3" },
        encode: { update: { x: { value: PAD }, y: { signal: "top + 18 + length(data('top5')) * mr + 30 * mvS + (datum.k - 1) * lr" }, width: { signal: "cw" }, height: { value: 34 } } },
        marks: [
          { type: "text", encode: { update: { x: { value: 0 }, y: { value: 9 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12.5 }, fill: { value: C.ink }, text: { field: { parent: "name" } } } } },
          { type: "text", encode: { update: { x: { signal: "cw" }, y: { value: 9 }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 12 }, fontWeight: { value: 600 }, fill: { value: C.bad }, text: { signal: F.gbpc("parent.net") } } } },
          { type: "text", encode: { update: { x: { value: 0 }, y: { value: 25 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 11 }, fill: { value: C.inkSoft }, text: { field: { parent: "why" } }, limit: { signal: "cw" }, tooltip: { field: { parent: "why" } } } } },
        ],
      },
      { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "top + 18 + length(data('top5')) * mr + 40 * mvS" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.positive }, text: { signal: "length(data('loss3')) ? '' : 'No processes are running at a loss.'" } } } },
    ],
  });

const briefing = () =>
  merge(...base(), processCatalogue(), alertsRows(), procFy(), frame({ title: "Briefing", subtitle: "Generated from the live figures, alerts and targets" }), {
    data: [
      { name: "b_al", source: "alerts", transform: [{ type: "filter", expr: "(!oneSpoke || datum.kind === 'estate' || datum.spoke === oneSpoke) && datum.severity === 'breach'" }, { type: "formula", as: "own", expr: "oneSpoke && datum.spoke === oneSpoke ? 0 : 1" }, { type: "collect", sort: { field: ["own", "scopeOrder", "label"] } }] },
    ],
    signals: [
      {
        name: "bHead",
        update: `'Fiscal-year-to-date net benefit is ' + ${F.gbpc("fyNet")} + (!(pfyNet !== 0) ? ', with no comparable figure last fiscal year' : (fyNet > 0 && pfyNet > 0) ? ', ' + (fyNet >= pfyNet ? 'up ' : 'down ') + format(abs((fyNet - pfyNet) / abs(pfyNet)) * 100, '.1f') + '% vs the same point last fiscal year' : ', ' + (fyNet > pfyNet ? 'improved' : fyNet < pfyNet ? 'worsened' : 'unchanged') + ' from ' + ${F.gbpc("pfyNet")} + ' at the same point last fiscal year') + (isValid(hubTarget) ? (execProjected >= hubTarget ? ', on track to meet the annual target' : ', behind the annual target') : '') + '.'`,
      },
      {
        name: "bRisk",
        update: "length(data('b_al')) ? 'Highest-priority risk: ' + data('b_al')[0].headline + '.' : length(data('excWorst')) ? 'Highest-priority risk: ' + data('excWorst')[0].name + ' is running an exception rate of ' + format(data('excWorst')[0].rate * 100, '.1f') + '%, above target.' : 'No thresholds breached.'",
      },
      { name: "bAction", update: "length(data('loss3')) ? 'Recommended action: review ' + data('loss3')[0].name + ': ' + data('loss3')[0].why : 'No processes running at a loss.'" },
      { name: "nbMax", update: "max(1, extent(pluck(data('fym'), 'net'))[1] || 0, -(extent(pluck(data('fym'), 'net'))[0] || 0))" },
    ],
    marks: [
      ...[
        ["HEADLINE", "bHead", 0],
        ["RISK", "bRisk", 1],
        ["ACTION", "bAction", 2],
      ].flatMap(([k, sig, i]) => [
        { type: "text", encode: { update: { x: { value: PAD }, y: { signal: `top + ${i * 50}` }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: k } } } },
        { type: "text", encode: { update: { x: { value: PAD }, y: { signal: `top + ${i * 50} + 14` }, baseline: { value: "top" }, font: { value: FONT.body }, fontSize: { value: 12.5 }, fill: { value: C.ink }, text: { signal: `replace(${sig}, regexp('(.{1,' + floor(cw / 6.4) + '})(\\\\s|$)', 'g'), '$1\\n')` }, lineBreak: { value: "\n" }, lineHeight: { value: 15 } } } },
      ]),
      { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "top + 152" }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: "MONTHLY NET BENEFIT" } } } },
      {
        type: "group",
        encode: { update: { x: { value: PAD }, y: { signal: "top + 170" }, width: { signal: "cw" }, height: { signal: "max(40, ch - 172)" } } },
        signals: [{ name: "zy", update: "(extent(pluck(data('fym'), 'net'))[0] || 0) < 0 ? (height - 16) / 2 : height - 20" }],
        scales: [{ name: "bx", type: "band", domain: { data: "fym", field: "m", sort: true }, range: [0, { signal: "cw" }], paddingInner: 0.28 }],
        marks: [
          { type: "rule", encode: { update: { x: { value: 0 }, x2: { signal: "cw" }, y: { signal: "zy" }, stroke: { value: C.rule }, strokeWidth: { value: 1.5 } } } },
          { type: "rect", from: { data: "fym" }, encode: { update: { x: { scale: "bx", field: "m" }, width: { scale: "bx", band: 1 }, y: { signal: "datum.net >= 0 ? zy - max(3, abs(datum.net) / nbMax * (zy - 16)) : zy" }, y2: { signal: "datum.net >= 0 ? zy : zy + max(3, abs(datum.net) / nbMax * (zy - 16))" }, fill: { signal: `datum.net >= 0 ? '${C.good}' : '${C.bad}'` }, cornerRadius: { value: 2 }, tooltip: { signal: `{'Month': ${F.month("datum.m")}, 'Net': ${F.gbp("datum.net")}}` } } } },
          { type: "text", from: { data: "fym" }, encode: { update: { x: { scale: "bx", field: "m", band: 0.5 }, y: { signal: "datum.net >= 0 ? zy - max(3, abs(datum.net) / nbMax * (zy - 16)) - 4 : zy + max(3, abs(datum.net) / nbMax * (zy - 16)) + 12" }, align: { value: "center" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fontWeight: { value: 600 }, fill: { signal: `datum.net >= 0 ? '${C.good}' : '${C.bad}'` }, text: { signal: F.gbpc("datum.net") } } } },
          { type: "text", from: { data: "fym" }, encode: { update: { x: { scale: "bx", field: "m", band: 0.5 }, y: { signal: "height" }, align: { value: "center" }, baseline: { value: "bottom" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.inkSoft }, text: { signal: F.month("datum.m") } } } },
        ],
      },
    ],
  });

export const dashboard = {
  id: "exec",
  title: "IA · Executive Summary",
  description: "The headline numbers for the exec and finance, fiscal-year-to-date to the end of the time picker; pick one spoke for that hub's own view",
  time: { from: "now-89d/d", to: "now" },
  states: ["spoke"],
  controls: [{ field: "spoke.name", title: "Hub (leave empty for the estate)" }],
  panels: [
    { id: "kpis", title: "Executive KPIs", grid: { x: 0, y: 0, w: 48, h: 5 }, build: kpis },
    { id: "operations", title: "Operations this period", grid: { x: 0, y: 5, w: 26, h: 9 }, build: operations },
    { id: "health", title: "Estate health", grid: { x: 26, y: 5, w: 22, h: 9 }, build: health },
    { id: "by-hub", title: "By hub / by proposition", grid: { x: 0, y: 14, w: 48, h: 9 }, build: byHub },
    { id: "movers", title: "Movers", grid: { x: 0, y: 23, w: 24, h: 13 }, build: movers },
    { id: "briefing", title: "Briefing", grid: { x: 24, y: 23, w: 24, h: 13 }, build: briefing },
  ],
};
