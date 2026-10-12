// ---------------------------------------------------------------------------
// blocks.mjs — the data plumbing most panels share. One Elasticsearch request
// per block; everything else is Vega transforms on the (small) response.
// ---------------------------------------------------------------------------
import { IDX, C } from "./tokens.mjs";
import { wide, ctx, sums, WINDOW_AGG, DAY_MS, plain, refDocs } from "./es.mjs";

// Extract an aggregation bucket list from a raw response datum into rows,
// mapping metric sub-aggs to plain numbers.
//   path: "days.buckets", fields: { c: "c", gb: "gb" } -> datum.c = bucket.c.value
export function bucketsOf(name, source, path, fields = {}, extra = []) {
  return {
    name,
    source,
    transform: [
      { type: "flatten", fields: [path], as: ["_bk"] },
      { type: "formula", as: "key", expr: "datum._bk.key" },
      { type: "formula", as: "n", expr: "datum._bk.doc_count" },
      ...Object.entries(fields).map(([as, sub]) => ({ type: "formula", as, expr: `datum._bk["${sub}"] ? (datum._bk["${sub}"].value || 0) : 0` })),
      ...extra,
      { type: "project", fields: ["key", "n", ...Object.keys(fields), ...extra.filter((t) => t.as && typeof t.as === "string").map((t) => t.as)] },
    ],
  };
}

// --- the window + daily block ------------------------------------------------------
// Signals: lo, hi (ms, day starts), ndays, plo, phi (previous equal window).
// Data:    days (every day with activity in [picker min - backDays, max]),
//          series (every day of the picker window, zero-filled),
//          tot (one row: cur_<k> and prev_<k> sums for every key).
export function dailyBlock({ keys, backDays = -732, raw = "raw", extraAggs = {}, extraMust = [] }) {
  const body = {
    aggs: {
      ...WINDOW_AGG,
      days: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: sums(...keys) },
      ...extraAggs,
    },
  };
  const f = Object.fromEntries(keys.map((k) => [k, k]));
  return {
    signals: [
      { name: "ndays", update: "length(data('win'))" },
      { name: "lo", update: "ndays ? data('win')[0].key : 0" },
      { name: "hi", update: "ndays ? data('win')[ndays - 1].key : 0" },
      { name: "plo", update: `lo - ndays * ${DAY_MS}` },
      { name: "phi", update: `lo - ${DAY_MS}` },
    ],
    data: [
      wide(raw, { body, property: "aggregations", backDays, extraMust }),
      bucketsOf("win", raw, "win.d.buckets"),
      bucketsOf("days", raw, "days.buckets", f),
      {
        name: "series",
        source: "win",
        transform: [
          { type: "lookup", from: "days", key: "key", fields: ["key"], as: ["d"] },
          { type: "formula", as: "t", expr: "datum.key" },
          ...keys.map((k) => ({ type: "formula", as: k, expr: `datum.d ? datum.d.${k} : 0` })),
        ],
      },
      {
        name: "tot",
        source: "days",
        transform: [
          ...keys.flatMap((k) => [
            { type: "formula", as: `cur_${k}`, expr: `datum.key >= lo && datum.key <= hi ? datum.${k} : 0` },
            { type: "formula", as: `prev_${k}`, expr: `datum.key >= plo && datum.key <= phi ? datum.${k} : 0` },
          ]),
          { type: "aggregate", ops: keys.flatMap(() => ["sum", "sum"]), fields: keys.flatMap((k) => [`cur_${k}`, `prev_${k}`]), as: keys.flatMap((k) => [`cur_${k}`, `prev_${k}`]) },
        ],
      },
    ],
  };
}

// Totals row accessor for expressions.
export const T = (k) => `(length(data('tot')) ? data('tot')[0].${k} : 0)`;

// --- targets -----------------------------------------------------------------------
// Global targets from ia-reference, plus the per-spoke override when the
// current selection holds exactly one spoke (the React app's resolvedTarget).
// Signals: tgt_<metric> for completionPct, exceptionRate, systemRate,
// costPerCase, utilMin, utilMax, vdiStaleDays; cfg_fyStart; cfg_warn; oneSpoke.
export const TARGET_DEFAULTS = { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14 };
export function targetsBlock() {
  const metrics = Object.keys(TARGET_DEFAULTS);
  const g = (m) => `indexof(pluck(data('tg'), 'k'), 'global|${m}')`;
  const o = (m) => `indexof(pluck(data('tg'), 'k'), 'spoke|' + oneSpoke + '|${m}')`;
  return {
    data: [
      refDocs("ref_targets", "target"),
      {
        name: "tg",
        source: "ref_targets",
        transform: [
          { type: "formula", as: "k", expr: "datum._source.scope === 'global' ? 'global|' + datum._source.metric : datum._source.scope + '|' + datum._source.scope_id + '|' + datum._source.metric" },
          { type: "formula", as: "v", expr: "datum._source.value" },
        ],
      },
      refDocs("ref_config", "config", 1),
      ctx("scope_spokes", { body: { aggs: { m: { filter: { term: { mapped: true } }, aggs: { s: { terms: { field: "spoke.name", size: 2 } } } } } }, property: "aggregations.m.s.buckets" }),
    ],
    signals: [
      { name: "oneSpoke", update: "length(data('scope_spokes')) === 1 ? data('scope_spokes')[0].key : ''" },
      ...metrics.map((m) => ({
        name: `tgt_${m}`,
        update: `oneSpoke && ${o(m)} >= 0 ? data('tg')[${o(m)}].v : (${g(m)} >= 0 ? data('tg')[${g(m)}].v : ${TARGET_DEFAULTS[m]})`,
      })),
      { name: "cfg_fyStart", update: "length(data('ref_config')) ? data('ref_config')[0]._source.fiscal_year_start_month : 4" },
      { name: "cfg_warn", update: "length(data('ref_config')) ? data('ref_config')[0]._source.warn_margin : 0.1" },
    ],
  };
}

// Global (never spoke-overridden) target, as the Executive Summary and
// review-candidate rules use.
export const globalTarget = (m) => `(indexof(pluck(data('tg'), 'k'), 'global|${m}') >= 0 ? data('tg')[indexof(pluck(data('tg'), 'k'), 'global|${m}')].v : ${TARGET_DEFAULTS[m]})`;

// Spoke colours from ia-reference, as an ordinal scale "spokeColor".
export function spokeColours() {
  return {
    data: [
      refDocs("ref_spokes", "spoke", 50),
      { name: "spk", source: "ref_spokes", transform: [{ type: "formula", as: "name", expr: "datum._source.spoke.name" }, { type: "formula", as: "color", expr: "datum._source.spoke.color" }] },
    ],
  };
}
// Colour for a spoke name (Hub and unknown fall back to the hub grey).
export const spokeColorExpr = (x) => `(indexof(pluck(data('spk'), 'name'), ${x}) >= 0 ? data('spk')[indexof(pluck(data('spk'), 'name'), ${x})].color : '${C.hub}')`;

// --- seasonal-naive forecast (src/components/forecast.ts) --------------------------
// For each of the next `periods` days after "hi": mean of the same weekday
// 1-4 weeks back where that day has a value; fewer than two such values falls
// back to the last 7 available days. Band = max(stdev, 5% of mean), lo
// floored at 0. src rows: { t, <field> } with missing days absent.
export function seasonalForecast({ src, field, out, periods = 14 }) {
  const D = 86400000;
  const vs = [1, 2, 3, 4];
  const valid = (i) => `(isValid(datum.v${i}) ? 1 : 0)`;
  const val = (i) => `(isValid(datum.v${i}) ? datum.v${i} : 0)`;
  return {
    data: [
      {
        name: `${out}_l7`,
        source: src,
        transform: [
          { type: "window", sort: { field: "t", order: "descending" }, ops: ["row_number"], as: ["rk"] },
          { type: "filter", expr: "datum.rk <= 7" },
          { type: "aggregate", ops: ["mean", "stdevp"], fields: [field, field], as: ["m", "sd"] },
        ],
      },
      {
        name: out,
        transform: [
          { type: "sequence", start: 1, stop: periods + 1, as: "k" },
          { type: "formula", as: "t", expr: `hi + datum.k * ${D}` },
          ...vs.flatMap((w) => [
            { type: "formula", as: `t${w}`, expr: `datum.t - ${7 * w * D}` },
            { type: "lookup", from: src, key: "t", fields: [`t${w}`], values: [field], as: [`v${w}`] },
          ]),
          { type: "formula", as: "n", expr: vs.map(valid).join(" + ") },
          { type: "formula", as: "m", expr: `datum.n >= 2 ? (${vs.map(val).join(" + ")}) / datum.n : (length(data('${out}_l7')) ? data('${out}_l7')[0].m : 0)` },
          {
            type: "formula",
            as: "sd",
            expr: `datum.n >= 2 ? sqrt((${vs.map((i) => `(isValid(datum.v${i}) ? pow(datum.v${i} - datum.m, 2) : 0)`).join(" + ")}) / datum.n) : (length(data('${out}_l7')) ? data('${out}_l7')[0].sd : 0)`,
          },
          { type: "formula", as: "band", expr: "max(datum.sd, abs(datum.m) * 0.05)" },
          { type: "formula", as: "point", expr: "datum.m || 0" },
          { type: "formula", as: "lo", expr: "max(0, datum.m - datum.band) || 0" },
          { type: "formula", as: "hi", expr: "(datum.m + datum.band) || 0" },
        ],
      },
    ],
  };
}

// --- fiscal year --------------------------------------------------------------------
// Needs dailyBlock (with gb and ec) and targetsBlock (cfg_fyStart). The fiscal
// year is the one containing "hi" (the window's last day), as in the React app.
// Signals: fyStart, fyEnd, pfyStart, pfyHi, fytdNet, pfytdNet, daysLeft,
// runRate (net/day over the window), projected.
export function fyBlock() {
  const D = 86400000;
  return {
    signals: [
      { name: "fyY", update: "utcmonth(hi) >= cfg_fyStart - 1 ? utcyear(hi) : utcyear(hi) - 1" },
      { name: "fyStart", update: "utc(fyY, cfg_fyStart - 1, 1)" },
      { name: "fyEnd", update: "utc(fyY + 1, cfg_fyStart - 1, 1)" },
      { name: "pfyStart", update: "utc(fyY - 1, cfg_fyStart - 1, 1)" },
      { name: "pfyHi", update: "pfyStart + (hi - fyStart)" },
      { name: "fytdNet", update: "length(data('fy')) ? data('fy')[0].cur : 0" },
      { name: "pfytdNet", update: "length(data('fy')) ? data('fy')[0].prev : 0" },
      { name: "daysLeft", update: `max(0, round((fyEnd - hi) / ${D}) - 1)` },
      { name: "runRate", update: `ndays ? (${T("cur_gb")} - ${T("cur_ec")}) / ndays : 0` },
      { name: "projected", update: "fytdNet + runRate * daysLeft" },
      { name: "fyLabel", update: "cfg_fyStart === 1 ? 'FY ' + fyY : 'FY ' + fyY + '/' + pad('' + ((fyY + 1) % 100), 2, '0', 'left')" },
    ],
    data: [
      {
        name: "fy",
        source: "days",
        transform: [
          { type: "formula", as: "net", expr: "datum.gb - datum.ec" },
          { type: "formula", as: "cur", expr: "datum.key >= fyStart && datum.key <= hi ? datum.net : 0" },
          { type: "formula", as: "prev", expr: "datum.key >= pfyStart && datum.key <= pfyHi ? datum.net : 0" },
          { type: "aggregate", ops: ["sum", "sum"], fields: ["cur", "prev"], as: ["cur", "prev"] },
        ],
      },
    ],
  };
}

// Finance targets (annual net benefit) from ia-reference: signal estateTarget
// (null when none) and dataset "ftg" {spoke, target}.
export function financeTargets() {
  return {
    data: [
      refDocs("ref_ft", "finance_target", 100),
      { name: "ftg", source: "ref_ft", transform: [{ type: "formula", as: "spoke", expr: "datum._source.spoke" }, { type: "formula", as: "target", expr: "datum._source.annual_net_benefit_target_gbp" }] },
    ],
    signals: [{ name: "estateTarget", update: "indexof(pluck(data('ftg'), 'spoke'), 'ESTATE') >= 0 ? data('ftg')[indexof(pluck(data('ftg'), 'spoke'), 'ESTATE')].target : null" }],
  };
}
