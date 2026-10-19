// ---------------------------------------------------------------------------
// es.mjs: builders for the Elasticsearch data sources Kibana's Vega runs.
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

// A shift in hours (Kibana rounds "now-89d/d" to local midnight: 23:00 UTC in British Summer Time).
const tfh = (which, hours) => ({ "%timefilter%": which, shift: hours, unit: "hour" });
// The window starts on the UTC day nearest the picker's start: a start within an hour before
// a UTC midnight belongs to the next day, any other start to its own day. WINDOW_START is the
// start moved on an hour, so flooring it to a day gives that day; DAY_FLOOR is the bound for
// "outcome_date on or after it" (outcome_date is a midnight: after start + 1 h - 1 day).
export const WINDOW_START = tfh("min", 1);
const DAY_FLOOR = tfh("min", -23);
export { DAY_FLOOR };

// The picker window as whole UTC days, the rule every tile uses: outcome days from the
// picker's start day (see WINDOW_START) up to the picker's end. Kibana's own time range
// would start at the picker's raw start, mid-day for "Last 90 days".
export const DAY_WINDOW = [
  { range: { outcome_date: { gt: DAY_FLOOR, format: "epoch_millis" } } },
  { range: { "@timestamp": { lte: tf("max"), format: "epoch_millis" } } },
];

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
  // T17: the same measures split by where the colleagues sit (the totals are the sum of the two)
  hOn: "value.hours_saved_onshore",
  hOff: "value.hours_saved_offshore",
  gbOn: "value.benefit_onshore_gbp",
  gbOff: "value.benefit_offshore_gbp",
  rhOn: "value.rework_hours_onshore",
  rhOff: "value.rework_hours_offshore",
  rwOn: "value.rework_onshore_gbp",
  rwOff: "value.rework_offshore_gbp",
};
export const sums = (...keys) => Object.fromEntries(keys.map((k) => [k, { sum: { field: SUM_FIELDS[k] } }]));

// The picker window as a day histogram: gives the panel lo/hi/ndays.
export const WINDOW_AGG = {
  win: {
    filter: { range: { "@timestamp": { gte: WINDOW_START, lte: tf("max"), format: "epoch_millis" } } },
    aggs: { d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 0, extended_bounds: { min: WINDOW_START, max: tf("max") } } } },
  },
};

export function ctx(name, { index = IDX.items, body, property, timefield = "@timestamp", extra = {} }) {
  // work items: whole UTC days, as the tiles; other indices: the picker's own range
  const days = index === IDX.items && timefield === "@timestamp";
  if (days && body?.query) throw new Error(`ctx("${name}"): body.query is not allowed on the work items index, use wide() or plain()`);
  const url = days
    ? { index, body: { size: 0, query: { bool: { must: ["%dashboard_context-must_clause%", ...DAY_WINDOW], filter: ["%dashboard_context-filter_clause%"], must_not: ["%dashboard_context-must_not_clause%"] } }, ...body } }
    : { "%context%": true, ...(timefield ? { "%timefield%": timefield } : {}), index, body: { size: 0, ...body } };
  return {
    name,
    url,
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
