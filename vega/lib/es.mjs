// ---------------------------------------------------------------------------
// es.mjs — builders for the Elasticsearch data sources Kibana's Vega runs.
//
// Two query shapes are used throughout:
//
//   ctx(...)    "%context%": true + "%timefield%": the dashboard's query,
//               filters AND time picker. For anything that is simply "the
//               current selection".
//
//   wide(...)   the dashboard's query and filters, but a time range the panel
//               chooses itself (e.g. the picker window plus the equal window
//               before it, for "vs previous period"). Built from Kibana's
//               %dashboard_context-*_clause% placeholders and %timefilter%
//               bounds, so it still follows every control on the dashboard.
// ---------------------------------------------------------------------------
import { IDX } from "./tokens.mjs";

export const DAY_MS = 86400000;

// {"%timefilter%": "min"|"max"} with an optional shift in days.
export const tf = (which, shiftDays) => ({ "%timefilter%": which, ...(shiftDays ? { shift: shiftDays, unit: "day" } : {}) });

export const MAPPED = { term: { mapped: true } };

// Sum aggregations by short name. Every one is a plain sum over a field the
// ETL writes, so ES does all the arithmetic and only small results come back.
export const SUM_FIELDS = {
  c: "n.completed",
  b: "n.business",
  s: "n.system",
  e: "n.exception",
  p: "n.pending",
  a: "n.attempt",
  w: "worktime_sec",
  cw: "worktime_completed_sec",
  h: "value.hours_saved",
  gb: "value.benefit_gbp",
  rw: "value.rework_gbp",
  ec: "cost.estate_gbp",
  cp: "cost.people_gbp",
  ci: "cost.infra_gbp",
  cd: "n.case_done", // cases completed (final stage)
  f1: "n.first", // first attempts
  fo: "n.first_ok", // first attempts that completed
  sl: "n.in_sla", // completed within SLA
  ta: "turnaround_sec", // loaded to outcome, attempts only
  rh: "value.rework_hours",
};
export const sums = (...keys) => Object.fromEntries(keys.map((k) => [k, { sum: { field: SUM_FIELDS[k] } }]));

// The picker window as a day histogram: gives the panel lo/hi/ndays.
export const WINDOW_AGG = {
  win: {
    filter: { range: { "@timestamp": { "%timefilter%": true } } },
    aggs: { d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 0, extended_bounds: { min: tf("min"), max: tf("max") } } } },
  },
};

export function ctx(name, { index = IDX.items, body, property, timefield = "@timestamp", extra = {} }) {
  return {
    name,
    url: { "%context%": true, ...(timefield ? { "%timefield%": timefield } : {}), index, body: { size: 0, ...body } },
    format: { property },
    ...extra,
  };
}

// Dashboard query + filters, explicit time range [picker min + backDays, picker max].
export function wide(name, { index = IDX.items, body, property, backDays = -732, mapped = true, extraMust = [], extra = {} }) {
  const must = ["%dashboard_context-must_clause%", { range: { "@timestamp": { gte: tf("min", backDays), lte: tf("max"), format: "epoch_millis" } } }];
  if (mapped) must.push(MAPPED);
  must.push(...extraMust);
  return {
    name,
    url: {
      index,
      body: {
        size: 0,
        query: { bool: { must, filter: ["%dashboard_context-filter_clause%"], must_not: ["%dashboard_context-must_not_clause%"] } },
        ...body,
      },
    },
    format: { property },
    ...extra,
  };
}

// No dashboard context at all (reference data, estate-wide cost pools).
export function plain(name, { index, body, property, extra = {} }) {
  return { name, url: { index, body: { size: 0, ...body } }, format: { property }, ...extra };
}

// Reference documents of one type.
export const refDocs = (name, docType, size = 200) =>
  plain(name, { index: IDX.ref, body: { size, query: { term: { doc_type: docType } } }, property: "hits.hits" });
