// ---------------------------------------------------------------------------
// alerts.mjs: the React alert engine (src/alerts/engine.ts) as one Vega
// block. Trailing 7 days to the end of the picker window, estate-wide (the
// dashboard filters do not apply, as in the app), at four scopes:
//   estate, spoke, process (30+ attempts), digital worker (utilisation; idle
//   workers are a Service check, not a target).
// Output dataset "alerts": one row per breach/warning with severity, scope,
// label, metric, value, threshold, direction, headline, spoke, and "spark"
// rows {id, i, v} for the trailing-7-day sparkline.
// Needs: targetsBlock() and processCatalogue() merged first.
// ---------------------------------------------------------------------------
import { IDX } from "./tokens.mjs";
import { plain, sums, tf, MAPPED } from "./es.mjs";

const D = 86400000;
const K = ["c", "b", "s", "e", "a", "ec", "rw"];

export function alertsBlock() {
  const daily = { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: sums(...K) };
  const range = { range: { "@timestamp": { gte: tf("max", -7), lte: tf("max"), format: "epoch_millis" } } };
  const flat = (name, source, path, labelExpr, spokeExpr, kind) => ({
    name,
    source,
    transform: [
      { type: "flatten", fields: [path], as: ["bk"] },
      { type: "formula", as: "kind", expr: `'${kind}'` },
      { type: "formula", as: "label", expr: labelExpr },
      { type: "formula", as: "spoke", expr: spokeExpr },
      { type: "formula", as: "t", expr: "datum.bk.key" },
      ...K.map((k) => ({ type: "formula", as: k, expr: `datum.bk.${k}.value` })),
      { type: "filter", expr: `datum.t >= ahi - ${6 * D} && datum.t <= ahi` },
      { type: "project", fields: ["kind", "label", "spoke", "t", ...K] },
    ],
  });
  // union of scope-day rows: Vega has no union transform, so index into each
  const parts = ["al_est", "al_sp", "al_pr"];
  const off = (i) => (i === 0 ? "0" : parts.slice(0, i).map((p) => `length(data('${p}'))`).join(" + "));
  const pick = (field) =>
    parts.reduceRight(
      (acc, p, i) => `(datum.i < ${off(i)} + length(data('${p}')) ? data('${p}')[datum.i - (${off(i)})].${field} : ${acc})`,
      "null",
    );
  const tgtKey = (scope, id, metric) => `indexof(pluck(data('tg'), 'k'), '${scope}|' + ${id} + '|' + ${metric})`;
  const resolved = `(datum.kind === 'process' && ${tgtKey("process", "datum.pid", "datum.metric")} >= 0 ? data('tg')[${tgtKey("process", "datum.pid", "datum.metric")}].v
     : datum.kind !== 'estate' && datum.spoke && ${tgtKey("spoke", "datum.spoke", "datum.metric")} >= 0 ? data('tg')[${tgtKey("spoke", "datum.spoke", "datum.metric")}].v
     : (indexof(pluck(data('tg'), 'k'), 'global|' + datum.metric) >= 0 ? data('tg')[indexof(pluck(data('tg'), 'k'), 'global|' + datum.metric)].v : null))`.replace(/\s+/g, " ");
  const metricLabel = "({'completionPct': 'Completion rate', 'exceptionRate': 'Exception rate', 'systemRate': 'System exception rate', 'costPerCase': 'Cost per item', 'utilisation': 'Utilisation'})[datum.metric]";
  const fmtV = (v) => `(datum.metric === 'costPerCase' ? '£' + format(${v}, '.2f') : format(${v} * 100, '.1f') + '%')`;
  return {
    data: [
      plain("al_raw", {
        index: IDX.items,
        body: {
          query: { bool: { filter: [MAPPED, range] } },
          aggs: {
            win: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 0, extended_bounds: { min: tf("max", -6), max: tf("max") } } },
            est: daily,
            sp: { terms: { field: "spoke.name", size: 100 }, aggs: { d: daily } },
            pr: { terms: { field: "process.name", size: 500 }, aggs: { sp: { terms: { field: "spoke.name", size: 1 } }, d: daily } },
            rs: { terms: { field: "resource.name", size: 500 }, aggs: { d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: { w: { sum: { field: "worktime_sec" } } } } } },
          },
        },
        property: "aggregations",
      }),
      plain("al_avail", {
        index: IDX.vdiDaily,
        body: {
          query: { range: { "@timestamp": { gte: tf("max", -7), lte: tf("max"), format: "epoch_millis" } } },
          aggs: { r: { terms: { field: "resource.name", size: 500 }, aggs: { o: { terms: { field: "resource.owner_spoke", size: 1 } }, st: { terms: { field: "resource.status", size: 1 } }, d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: { h: { sum: { field: "operating_hours" } } } } } } },
        },
        property: "aggregations.r.buckets",
      }),
      { name: "al_win", source: "al_raw", transform: [{ type: "flatten", fields: ["win.buckets"], as: ["bk"] }, { type: "formula", as: "t", expr: "datum.bk.key" }, { type: "project", fields: ["t"] }] },
      flat("al_est", "al_raw", "est.buckets", "'Estate'", "''", "estate"),
      { name: "al_sp0", source: "al_raw", transform: [{ type: "flatten", fields: ["sp.buckets"], as: ["g"] }, { type: "formula", as: "gk", expr: "datum.g.key" }, { type: "formula", as: "gd", expr: "datum.g.d" }, { type: "project", fields: ["gk", "gd"] }] },
      flat("al_sp", "al_sp0", "gd.buckets", "datum.gk", "datum.gk", "spoke"),
      { name: "al_pr0", source: "al_raw", transform: [{ type: "flatten", fields: ["pr.buckets"], as: ["g"] }, { type: "formula", as: "gk", expr: "datum.g.key" }, { type: "formula", as: "gs", expr: "datum.g.sp.buckets[0].key" }, { type: "formula", as: "gd", expr: "datum.g.d" }, { type: "project", fields: ["gk", "gs", "gd"] }] },
      flat("al_pr", "al_pr0", "gd.buckets", "datum.gk", "datum.gs", "process"),
      {
        name: "al_days",
        transform: [
          { type: "sequence", start: 0, stop: { signal: parts.map((p) => `length(data('${p}'))`).join(" + ") }, as: "i" },
          ...["kind", "label", "spoke", "t", ...K].map((f) => ({ type: "formula", as: f, expr: pick(f) })),
        ],
      },
      {
        name: "al_rate",
        source: "al_days",
        transform: [
          { type: "aggregate", groupby: ["kind", "label", "spoke"], ops: K.map(() => "sum"), fields: K, as: K },
          { type: "filter", expr: "datum.kind !== 'process' || datum.a >= 30" },
          { type: "filter", expr: "datum.a > 0" },
          { type: "lookup", from: "procs", key: "name", fields: ["label"], values: ["pid"], as: ["pid"] },
          { type: "formula", as: "completionPct", expr: "datum.a ? datum.c / datum.a : 0" },
          { type: "formula", as: "exceptionRate", expr: "datum.a ? datum.e / datum.a : 0" },
          { type: "formula", as: "systemRate", expr: "datum.a ? datum.s / datum.a : 0" },
          { type: "formula", as: "costPerCase", expr: "datum.c ? datum.ec / datum.c : 0" },
          { type: "fold", fields: ["completionPct", "exceptionRate", "systemRate", "costPerCase"], as: ["metric", "value"] },
          { type: "formula", as: "direction", expr: "datum.metric === 'completionPct' ? 'min' : 'max'" },
          { type: "formula", as: "threshold", expr: resolved },
          { type: "project", fields: ["kind", "label", "spoke", "pid", "metric", "value", "direction", "threshold", "c", "ec", "rw"] },
        ],
      },
      {
        name: "al_vdi",
        source: "al_avail",
        transform: [
          { type: "formula", as: "label", expr: "datum.key" },
          { type: "formula", as: "owner", expr: "datum.o.buckets[0].key" },
          { type: "formula", as: "spoke", expr: "datum.owner === 'Hub' ? '' : datum.owner" },
          { type: "formula", as: "status", expr: "datum.st.buckets[0].key" },
          { type: "formula", as: "availH", expr: `reduce_avail` },
          { type: "lookup", from: "al_raw_rs", key: "key", fields: ["key"], values: ["activeH"], as: ["activeH"] },
          { type: "formula", as: "util", expr: "datum.availH ? min(1, (datum.activeH || 0) / datum.availH) : null" },
        ],
      },
    ],
    signals: [
      { name: "ahi", update: "length(data('al_win')) ? data('al_win')[length(data('al_win')) - 1].t : 0" },
      { name: "alWindow", update: `'7 days to ' + utcFormat(ahi, '%-d %b %Y')` },
    ],
    // finishing transforms are added by alertsRows() so the VDI helpers exist first
    metricLabel,
    fmtV,
  };
}

// Post-processing that turns the per-scope figures into alert rows. Split out
// so the VDI hour totals (which need two small helper datasets) are defined in
// the right order.
export function alertsRows() {
  const blk = alertsBlock();
  const avail = blk.data.find((d) => d.name === "al_vdi");
  // sum of operating hours in the window for this VDI
  avail.transform = avail.transform.filter((t) => t.as !== "availH");
  const rsData = {
    name: "al_raw_rs",
    source: "al_raw",
    transform: [
      { type: "flatten", fields: ["rs.buckets"], as: ["g"] },
      { type: "formula", as: "key", expr: "datum.g.key" },
      { type: "formula", as: "gd", expr: "datum.g.d" },
      { type: "flatten", fields: ["gd.buckets"], as: ["bk"] },
      { type: "filter", expr: `datum.bk.key >= ahi - ${6 * D} && datum.bk.key <= ahi` },
      { type: "formula", as: "w", expr: "datum.bk.w.value" },
      { type: "aggregate", groupby: ["key"], ops: ["sum"], fields: ["w"], as: ["w"] },
      { type: "formula", as: "activeH", expr: "datum.w / 3600" },
    ],
  };
  const availData = {
    name: "al_av_sum",
    source: "al_avail",
    transform: [
      { type: "formula", as: "gd", expr: "datum.d" },
      { type: "flatten", fields: ["gd.buckets"], as: ["bk"] },
      { type: "filter", expr: `datum.bk.key >= ahi - ${6 * D} && datum.bk.key <= ahi` },
      { type: "formula", as: "h", expr: "datum.bk.h.value" },
      { type: "aggregate", groupby: ["key"], ops: ["sum"], fields: ["h"], as: ["h"] },
    ],
  };
  avail.transform.splice(5, 0, { type: "lookup", from: "al_av_sum", key: "key", fields: ["key"], values: ["h"], as: ["availH"] });
  const idx = blk.data.indexOf(avail);
  blk.data.splice(idx, 0, rsData, availData);

  const tgtKey = (scope, id, metric) => `indexof(pluck(data('tg'), 'k'), '${scope}|' + ${id} + '|${metric}')`;
  const spokeTgt = (metric) => `(datum.spoke && ${tgtKey("spoke", "datum.spoke", metric)} >= 0 ? data('tg')[${tgtKey("spoke", "datum.spoke", metric)}].v : tgt_g_${metric})`;
  const classify = (v, th, dir) => `(${dir} === 'min' ? (${v} < ${th} ? 'breach' : ${v} < ${th} + (1 - ${th}) * cfg_warn ? 'warn' : '') : (${v} > ${th} ? 'breach' : ${v} > ${th} * (1 - cfg_warn) ? 'warn' : ''))`;
  blk.data.push(
    {
      name: "al_vdi_rows",
      source: "al_vdi",
      transform: [
        { type: "formula", as: "kind", expr: "'vdi'" },
        { type: "formula", as: "uMin", expr: spokeTgt("utilMin") },
        { type: "formula", as: "uMax", expr: spokeTgt("utilMax") },
        { type: "formula", as: "uSevMin", expr: `isValid(datum.util) ? ${classify("datum.util", "datum.uMin", "'min'")} : ''` },
        { type: "formula", as: "uSevMax", expr: `isValid(datum.util) ? ${classify("datum.util", "datum.uMax", "'max'")} : ''` },
      ],
    },
    {
      name: "alerts",
      transform: [
        // idle-VDI ("stale") alerts now live on the Service dashboard, so each VDI contributes one row (utilisation)
        { type: "sequence", start: 0, stop: { signal: "length(data('al_rate')) + length(data('al_vdi_rows'))" }, as: "i" },
        { type: "formula", as: "nR", expr: "length(data('al_rate'))" },
        { type: "formula", as: "r", expr: "datum.i < datum.nR ? data('al_rate')[datum.i] : data('al_vdi_rows')[datum.i - datum.nR]" },
        { type: "formula", as: "vdiPart", expr: "datum.i < datum.nR ? -1 : 0" },
        { type: "formula", as: "kind", expr: "datum.r.kind" },
        { type: "formula", as: "label", expr: "datum.r.label" },
        { type: "formula", as: "spoke", expr: "datum.r.spoke" },
        { type: "formula", as: "metric", expr: "datum.vdiPart === -1 ? datum.r.metric : 'utilisation'" },
        { type: "formula", as: "value", expr: "datum.vdiPart === -1 ? datum.r.value : datum.r.util" },
        { type: "formula", as: "direction", expr: "datum.vdiPart === -1 ? datum.r.direction : datum.vdiPart === 0 ? (datum.r.uSevMin ? 'min' : 'max') : 'max'" },
        { type: "formula", as: "threshold", expr: "datum.vdiPart === -1 ? datum.r.threshold : (datum.r.uSevMin ? datum.r.uMin : datum.r.uMax)" },
        { type: "formula", as: "severity", expr: `datum.vdiPart === -1 ? (isValid(datum.threshold) ? ${classify("datum.value", "datum.threshold", "datum.direction")} : '') : (datum.r.uSevMin || datum.r.uSevMax)` },
        { type: "filter", expr: "datum.severity !== '' && isValid(datum.severity)" },
        { type: "formula", as: "id", expr: "datum.kind + '|' + datum.label + '|' + datum.metric" },
        { type: "formula", as: "scopeOrder", expr: "indexof(['estate', 'spoke', 'process', 'vdi'], datum.kind)" },
        { type: "formula", as: "sevOrder", expr: "datum.severity === 'breach' ? 0 : 1" },
        { type: "formula", as: "metricName", expr: blk.metricLabel },
        { type: "formula", as: "vText", expr: blk.fmtV("datum.value") },
        { type: "formula", as: "thText", expr: blk.fmtV("datum.threshold") },
        { type: "formula", as: "scopeText", expr: "datum.kind === 'estate' ? 'Estate' : datum.label" },
        {
          type: "formula",
          as: "headline",
          expr: "datum.scopeText + ': ' + datum.metricName + ' ' + datum.vText + (datum.direction === 'min' ? (datum.severity === 'breach' ? ', below the ' + datum.thText + ' floor' : ', only just above the ' + datum.thText + ' floor') : (datum.severity === 'breach' ? ', above the ' + datum.thText + ' ceiling' : ', approaching the ' + datum.thText + ' ceiling'))",
        },
        // money at stake over the 7 days: rework exposure for the rate metrics, excess cost for cost per item
        { type: "formula", as: "atStake", expr: "datum.vdiPart !== -1 ? 0 : datum.metric === 'costPerCase' ? max(0, datum.r.ec - datum.threshold * datum.r.c) : datum.r.rw" },
        { type: "formula", as: "context", expr: "datum.kind === 'process' ? 'Process: ' + datum.label + ' · Spoke: ' + datum.spoke : datum.kind === 'vdi' ? 'VDI: ' + datum.label + ' · Spoke: ' + (datum.spoke || 'Hub') : ''" },
        { type: "collect", sort: { field: ["sevOrder", "scopeOrder", "atStake", "label"], order: ["ascending", "ascending", "descending", "ascending"] } },
        { type: "window", ops: ["row_number"], as: ["rank"] },
      ],
    },
  );
  blk.signals.push(...["utilMin", "utilMax"].map((m) => ({ name: `tgt_g_${m}`, update: `indexof(pluck(data('tg'), 'k'), 'global|${m}') >= 0 ? data('tg')[indexof(pluck(data('tg'), 'k'), 'global|${m}')].v : ${{ utilMin: 0.15, utilMax: 0.6 }[m]}` })));
  delete blk.metricLabel;
  delete blk.fmtV;
  return blk;
}
