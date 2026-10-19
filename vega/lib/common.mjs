// ---------------------------------------------------------------------------
// common.mjs: small shared pieces: working-time assumptions, the process
// catalogue, cross-filtering and the measures several pages repeat.
// ---------------------------------------------------------------------------
import { IDX, C } from "./tokens.mjs";
import { plain, refDocs, ctx, sums, MAPPED } from "./es.mjs";

// Working days/year and productive hours/day in force at the end of the
// window (the React app reads estateCostHistory at the window's last day).
// Signals: wd, ph (onshore, or location-less) and wdo, pho (offshore, which the
// cost pipeline falls back to the onshore figures for when none is set).
export function workingTime() {
  return {
    data: [
      plain("wdph", {
        index: IDX.costDaily,
        body: {
          size: 1,
          query: { bool: { filter: [{ term: { pool: "HUB" } }, { range: { "@timestamp": { lte: { "%timefilter%": "max" }, format: "epoch_millis" } } }] } },
          sort: [{ "@timestamp": { order: "desc" } }],
        },
        property: "hits.hits",
      }),
    ],
    signals: [
      { name: "wd", update: "length(data('wdph')) ? data('wdph')[0]._source.working_days_per_year : 252" },
      { name: "ph", update: "length(data('wdph')) ? data('wdph')[0]._source.productive_hours_per_day : 7.5" },
      { name: "wdo", update: "length(data('wdph')) && isValid(data('wdph')[0]._source.working_days_per_year_offshore) ? data('wdph')[0]._source.working_days_per_year_offshore : wd" },
      { name: "pho", update: "length(data('wdph')) && isValid(data('wdph')[0]._source.productive_hours_per_day_offshore) ? data('wdph')[0]._source.productive_hours_per_day_offshore : ph" },
    ],
  };
}

// FTE released over n days: hours saved / (n x working days/365.25 x hours/day)
export const fteExpr = (hours, days = "ndays") => `(${days} > 0 ? (${hours}) / (${days} * (wd / 365.25) * ph) : 0)`;
// The same for offshore colleagues, on the offshore working assumptions.
export const fteOffExpr = (hours, days = "ndays") => `(${days} > 0 ? (${hours}) / (${days} * (wdo / 365.25) * pho) : 0)`;
// Total FTE = onshore FTE + offshore FTE, each on its own location's assumptions.
export const fteTotExpr = (hoursOn, hoursOff, days = "ndays") => `(${fteExpr(hoursOn, days)} + ${fteOffExpr(hoursOff, days)})`;

// Process catalogue (ia-reference doc_type: process) as rows with plain fields.
export function processCatalogue(name = "procs") {
  return {
    data: [
      refDocs(`${name}_raw`, "process", 500),
      {
        name,
        source: `${name}_raw`,
        transform: [
          { type: "formula", as: "name", expr: "datum._source.process.name" },
          { type: "formula", as: "pid", expr: "datum._source.process.id" },
          { type: "formula", as: "acronym", expr: "datum._source.process.acronym" },
          { type: "formula", as: "spoke", expr: "datum._source.spoke.name" },
          { type: "formula", as: "spokeColor", expr: "datum._source.spoke.color" },
          { type: "formula", as: "proposition", expr: "datum._source.proposition.name" },
          { type: "formula", as: "queue", expr: "datum._source.primary_queue" },
          { type: "formula", as: "queues", expr: "join(datum._source.queues, ' → ')" },
          { type: "formula", as: "description", expr: "datum._source.process.description" },
          { type: "formula", as: "tags", expr: "datum._source.process.tags" },
          { type: "formula", as: "smv", expr: "datum._source.process.smv_minutes" },
          { type: "formula", as: "grade", expr: "datum._source.process.grade" },
          { type: "formula", as: "gradeName", expr: "datum._source.process.grade_name" },
          { type: "formula", as: "rate", expr: "datum._source.process.current_rate_gbp" },
          { type: "formula", as: "rateOff", expr: "datum._source.process.current_rate_offshore_gbp" },
          { type: "formula", as: "offShare", expr: "datum._source.process.offshore_share || 0" },
          { type: "formula", as: "slaHours", expr: "datum._source.process.sla_hours" },
        ],
      },
    ],
  };
}

// Kibana cross-filter on a field (adds a dashboard filter, like the React app's
// click-to-filter). Kibana provides kibanaAddFilter; the preview stubs it.
export const addFilter = (field, valueExpr) => `kibanaAddFilter({'match_phrase': {'${field}': ${valueExpr}}}, '${IDX.dataView}')`;

// Per-process aggregate for the picker window (mapped items only).
//   keys: sum keys from es.mjs SUM_FIELDS
// Rows: name, plus each key; spoke and queue come from the catalogue.
export function byProcess(name, keys, { size = 100, extraAggs = {} } = {}) {
  return {
    data: [
      ctx(`${name}_raw`, {
        body: { aggs: { m: { filter: MAPPED, aggs: { p: { terms: { field: "process.name", size }, aggs: { ...sums(...keys), ...extraAggs } } } } } },
        property: "aggregations.m.p.buckets",
      }),
      {
        name,
        source: `${name}_raw`,
        transform: [
          { type: "formula", as: "name", expr: "datum.key" },
          ...keys.map((k) => ({ type: "formula", as: k, expr: `datum['${k}'].value` })),
          { type: "lookup", from: "procs", key: "name", fields: ["name"], as: ["ref"] },
          { type: "formula", as: "spoke", expr: "datum.ref ? datum.ref.spoke : ''" },
          { type: "formula", as: "spokeColor", expr: `datum.ref ? datum.ref.spokeColor : '${C.hub}'` },
          { type: "formula", as: "queue", expr: "datum.ref ? datum.ref.queue : ''" },
          { type: "formula", as: "proposition", expr: "datum.ref ? datum.ref.proposition : ''" },
          { type: "formula", as: "slaHours", expr: "datum.ref ? datum.ref.slaHours : null" },
        ],
      },
    ],
  };
}

// The React rateBand(): bad above target, warn within warn margin below it.
export const rateBandColor = (rate, target) => `(${rate} > ${target} ? '${C.bad}' : ${rate} > ${target} * (1 - cfg_warn) ? '${C.business}' : '${C.ink}')`;
