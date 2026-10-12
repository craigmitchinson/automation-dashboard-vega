// ---------------------------------------------------------------------------
// service.mjs: the service checks: what a run team needs to know, as a fixed
// set of checks that are each OK, Warning, Action or Out of hours.
//
// One definition, two runtimes:
//   - the Service dashboard runs these queries through Kibana and evaluates
//     them in Vega (serviceBlock below), live, following the Spoke control;
//   - etl/service-job/service_checks.py runs the same queries (exported by
//     build.mjs as etl/service-job/service-checks.json) every 15 minutes,
//     estate-wide, applies the same rules and writes ia-service-checks, which
//     the Kibana alerting rules watch.
// tests/service.test.mjs proves both give identical results.
//
// "now" is the end of the time picker (%timefilter% max). With the picker
// ending at "now" that is the current time; the job passes the real time.
// ---------------------------------------------------------------------------
import { IDX } from "./tokens.mjs";
import { sums, MAPPED } from "./es.mjs";

// Thresholds. Change here, rebuild, re-import and redeploy the job's JSON.
export const SERVICE = {
  serviceHoursUtc: [7, 19], // freshness and worker gaps are only judged inside these hours
  freshnessMin: { warn: 60, act: 180 }, // minutes since any item was last updated
  costLagDays: { warn: 2, act: 4 }, // days between today and the last costed day
  slaSoonHours: 2, // waiting items due within this many hours are a warning; past due is action
  lockMinutes: 60, // a pending item locked longer than this is stuck
  workerGapHours: { warn: 2, act: 4 }, // since a worker's last item (or the start of today's service hours), against the estate's last item
  gapMinExpected: 5, // ...and only once its usual rate means at least this many items should have been worked in the gap
  usualFloor: 10, // "usual" (mean of the same 24 hours 1 to 4 weeks back) must reach this before silence counts
  belowUsual: { warn: 0.5, act: 0.25 }, // share of usual volume in the last 24 hours
  sysSpike: { warnItems: 5, warnX: 2, actItems: 10, actX: 3, rateFloor: 0.005 },
  newReasonMin: 3, // occurrences in 24 hours of a reason not seen in the previous 28 days
  runEveryMinutes: 15,
  jobSilentMinutes: 45, // the check job itself is considered down after this
};

// The checks, in board order. `runbook` is the first thing to do; it goes
// into the alert message as well as the dashboard.
export const CHECKS = [
  { id: "freshness", group: "Pipeline", name: "Data arriving", runbook: "Check the Logstash pipeline is running and can reach the Blue Prism database. If Blue Prism itself has stopped, raise it with platform support." },
  { id: "cost_job", group: "Pipeline", name: "Cost job up to date", runbook: "Re-run stamp_costs.py and read its log for the day that failed. Value and cost figures are understated until it catches up." },
  { id: "unmapped", group: "Pipeline", name: "All queues mapped", runbook: "A queue is producing items that reference data doesn't know, so they are missing from every figure. Add it to queueMap in reference.json (or retire the queue) and reload." },
  { id: "sla", group: "Queues", name: "Nothing past its SLA", runbook: "Open the queue in Control Room. Check its schedule is running and has a worker; prioritise the items closest to their SLA or add capacity." },
  { id: "locks", group: "Queues", name: "No items stuck on a lock", runbook: "A session probably died holding the lock. Confirm nothing is running against the item, then unlock it in Control Room." },
  { id: "workers", group: "Digital workers", name: "Workers running", runbook: "Log on to the VDI. Check the runtime resource is up, the session isn't stuck on a dialog and the schedule fired." },
  { id: "processes", group: "Processes", name: "Processes running as usual", runbook: "Check the schedule fired and that items were loaded upstream. An empty queue usually means the feed or the trigger failed." },
  { id: "sys_spike", group: "Exceptions", name: "System exceptions normal", runbook: "Read the top reason for the process. It is usually a target system outage, a credential change or a screen change; pause the schedule if items are failing in bulk." },
  { id: "new_reasons", group: "Exceptions", name: "No new exception reasons", runbook: "A reason not seen in 28 days usually means the target system changed. Check with its owners; if the reason is genuine, add a pattern to reference data." },
];

export const STATUS_RANK = { quiet: 0, ok: 1, warn: 2, act: 3 };
export const STATUS_LABEL = { quiet: "Out of hours", ok: "OK", warn: "Warning", act: "Action" };

// --- queries -----------------------------------------------------------------
const H = 3600000;
const at = (shift = 0, unit = "hour") => ({ "%timefilter%": "max", ...(shift ? { shift, unit } : {}) });
const rng = (field, gte, lte = at()) => ({ range: { [field]: { ...(gte ? { gte } : {}), lte, format: "epoch_millis" } } });
const win = (k) => rng("@timestamp", at(-24 - 168 * k), at(-168 * k));
const BASE = () => rng("@timestamp", at(-24 * 29), at(-24));
const NOW_AGG = { nowb: { date_range: { field: "@timestamp", ranges: [{ key: "now", from: at() }] } } };
const ctxBool = (must) => ({
  bool: { must: ["%dashboard_context-must_clause%", ...must], filter: ["%dashboard_context-filter_clause%"], must_not: ["%dashboard_context-must_not_clause%"] },
});
const W5 = { w0: win(0), w1: win(1), w2: win(2), w3: win(3), w4: win(4) };

export const SERVICE_QUERIES = {
  // latest item update anywhere, plus "now" as Kibana resolved it
  sv_fresh: {
    index: IDX.items,
    body: { size: 0, query: rng("item.last_updated_at", at(-24 * 7)), aggs: { last: { max: { field: "item.last_updated_at" } }, ...NOW_AGG } },
  },
  sv_cost: {
    index: IDX.costDaily,
    body: { size: 0, query: rng("@timestamp", at(-24 * 60)), aggs: { last: { max: { field: "@timestamp" } } } },
  },
  sv_vdi: {
    index: IDX.vdiDaily,
    body: { size: 0, query: rng("@timestamp", at(-72)), aggs: { r: { terms: { field: "resource.name", size: 500 }, aggs: { st: { terms: { field: "resource.status", size: 1 } } } } } },
  },
  // attempts over 30 days: hourly activity, per-process and per-worker windows, reasons
  sv_flow: {
    index: IDX.items,
    ctx: true,
    body: {
      size: 0,
      query: ctxBool([MAPPED, { term: { "n.attempt": 1 } }, rng("@timestamp", at(-24 * 30))]),
      aggs: {
        last: { max: { field: "@timestamp" } },
        hr: { date_histogram: { field: "@timestamp", fixed_interval: "1h", min_doc_count: 0, extended_bounds: { min: at(-24 * 30), max: at() } }, aggs: sums("a", "c", "s") },
        pr: {
          terms: { field: "process.name", size: 500 },
          aggs: { sp: { terms: { field: "spoke.name", size: 1 } }, w: { filters: { filters: { ...W5, base: BASE() } }, aggs: sums("a", "s") } },
        },
        rs: {
          terms: { field: "resource.name", size: 500 },
          aggs: {
            last: { max: { field: "@timestamp" } },
            sp: { terms: { field: "resource.owner_spoke", size: 1 } },
            w: { filters: { filters: W5 } },
            h: { filter: win(0), aggs: { t: { date_histogram: { field: "@timestamp", fixed_interval: "1h", min_doc_count: 0, extended_bounds: { min: at(-23), max: at() } } } } },
          },
        },
        r0: {
          filter: win(0),
          aggs: { code: { terms: { field: "exception.code", size: 100 }, aggs: { rd: { terms: { field: "exception.reason_display", size: 1 } }, ty: { terms: { field: "exception.type", size: 1 } }, pr: { terms: { field: "process.name", size: 1 } } } } },
        },
        rb: { filter: BASE(), aggs: { code: { terms: { field: "exception.code", size: 2000 } } } },
      },
    },
  },
  // items from queues reference data doesn't know (estate-wide: they have no spoke)
  sv_unmapped: {
    index: IDX.items,
    body: { size: 0, query: { bool: { filter: [{ term: { mapped: false } }, rng("@timestamp", at(-24))] } }, aggs: { q: { terms: { field: "queue.name", size: 50, missing: "(no queue name)" } } } },
  },
  // everything still waiting
  sv_pending: {
    index: IDX.items,
    ctx: true,
    body: {
      size: 0,
      query: ctxBool([MAPPED, { term: { "n.pending": 1 } }, rng("@timestamp", at(-24 * 120))]),
      aggs: {
        q: {
          terms: { field: "queue.name", size: 500 },
          aggs: {
            sp: { terms: { field: "spoke.name", size: 1 } },
            pr: { terms: { field: "process.name", size: 1 } },
            live: {
              filter: { bool: { must_not: [{ range: { "item.deferred_at": { gt: at(), format: "epoch_millis" } } }] } },
              aggs: {
                oldest: { min: { field: "item.loaded_at" } },
                past: { filter: rng("item.sla_due_at", null, at()) },
                soon: { filter: { range: { "item.sla_due_at": { gt: at(), lte: at(SERVICE.slaSoonHours), format: "epoch_millis" } } } },
              },
            },
            stuck: { filter: rng("item.locked_at", null, at(-SERVICE.lockMinutes, "minute")), aggs: { oldest: { min: { field: "item.locked_at" } } } },
          },
        },
      },
    },
  },
};

// The check job's own history (dashboard only)
export const HISTORY_QUERY = {
  index: IDX.serviceChecks,
  body: {
    size: 0,
    query: rng("@timestamp", at(-24)),
    aggs: {
      last: { max: { field: "@timestamp" } },
      c: { terms: { field: "check.id", size: 50 }, aggs: { h: { date_histogram: { field: "@timestamp", fixed_interval: "1h", min_doc_count: 0, extended_bounds: { min: at(-23), max: at() } }, aggs: { r: { max: { field: "status_rank" } } } } } },
    },
  },
};

const asData = (name, q) => ({ name, url: { index: q.index, body: q.body }, format: { property: "aggregations" } });

// --- evaluation in Vega ------------------------------------------------------
// Mirrors evaluate() in etl/service-job/service_checks.py line for line.
const S = SERVICE;
const fmtAge = (m) => `(${m} < 90 ? round(${m}) + ' min' : ${m} < 2880 ? round(${m} / 60) + ' h' : round(${m} / 1440) + ' days')`;
const pct = (x) => `format(${x} * 100, '.1f') + '%'`;
const rankOf = (s) => `({'quiet': 0, 'ok': 1, 'warn': 2, 'act': 3})[${s}]`;

// offender list -> rank (max), count, detail ("a; b; +N more")
const summary = (ds) => [
  { name: `${ds}_rank`, update: `length(data('${ds}')) ? extent(pluck(data('${ds}'), 'rank'))[1] : 1` },
  { name: `${ds}_n`, update: `length(data('${ds}'))` },
  {
    name: `${ds}_detail`,
    update: `join(slice(pluck(data('${ds}'), 'txt'), 0, 2), '; ') + (length(data('${ds}')) > 2 ? '; +' + (length(data('${ds}')) - 2) + ' more' : '')`,
  },
];
const offSort = { type: "collect", sort: { field: ["rank", "m", "name"], order: ["descending", "descending", "ascending"] } };

// checks whose status comes from a list of offenders
const OFFENDER_CHECKS = ["unmapped", "sla", "locks", "workers", "processes", "sys_spike", "new_reasons"];
const fromOff = (k) => `({'1': 'ok', '2': 'warn', '3': 'act'})['' + off_${k}_rank]`;
const qtot = (f) => `(data('sv_q_tot').length ? data('sv_q_tot')[0].${f} : 0)`;
const EVAL = {
  freshness: {
    status: "svFreshStatus",
    headline: `!isValid(svLast) ? 'No updates in 7 days' : ${fmtAge("svAgeMin")} + ' since the last update'`,
    detail: `svFreshStatus === 'quiet' ? 'Outside service hours (${String(S.serviceHoursUtc[0]).padStart(2, "0")}:00 to ${S.serviceHoursUtc[1]}:00 UTC)' : ''`,
    count: "0",
  },
  cost_job: {
    status: "svCostStatus",
    headline: `!isValid(svCostLast) ? 'No costed days found' : svCostLag <= 0 ? 'Costed to today' : 'Costed to ' + utcFormat(svCostLast, '%d %b') + ' (' + svCostLag + (svCostLag === 1 ? ' day' : ' days') + ' behind)'`,
    detail: "''",
    count: "0",
  },
  unmapped: {
    status: fromOff("unmapped"),
    headline: `off_unmapped_n ? off_unmapped_n + (off_unmapped_n === 1 ? ' unmapped queue, ' : ' unmapped queues, ') + format(data('sv_unmapped_tot')[0].n, ',') + ' items in 24h' : 'Every queue is in reference data'`,
    detail: "off_unmapped_detail",
    count: "off_unmapped_n",
  },
  sla: {
    status: fromOff("sla"),
    headline: `!${qtot("waiting")} ? 'No items waiting' : format(${qtot("waiting")}, ',') + ' waiting, ' + (${qtot("past")} ? format(${qtot("past")}, ',') + ' past SLA' : ${qtot("soon")} ? format(${qtot("soon")}, ',') + ' due within ${S.slaSoonHours} h' : 'none near SLA')`,
    detail: "off_sla_detail",
    count: "off_sla_n",
  },
  locks: {
    status: fromOff("locks"),
    headline: `!${qtot("stuck")} ? 'No items locked over ${S.lockMinutes} min' : ${qtot("stuck")} + ' locked over ${S.lockMinutes} min'`,
    detail: "off_locks_detail",
    count: "off_locks_n",
  },
  workers: { status: fromOff("workers"), headline: "off_workers_n ? off_workers_n + ' of ' + svWorkers + ' workers quiet' : svWorkers + ' workers active'", detail: "off_workers_detail", count: "off_workers_n" },
  processes: { status: fromOff("processes"), headline: "off_processes_n ? off_processes_n + ' running below usual' : svUsualProcs + ' processes on their usual pattern'", detail: "off_processes_detail", count: "off_processes_n" },
  sys_spike: { status: fromOff("sys_spike"), headline: "off_sys_spike_n ? off_sys_spike_n + (off_sys_spike_n === 1 ? ' process' : ' processes') + ' above usual' : 'In line with the last 28 days'", detail: "off_sys_spike_detail", count: "off_sys_spike_n" },
  new_reasons: { status: fromOff("new_reasons"), headline: "off_new_reasons_n ? off_new_reasons_n + ' new in the last 24 hours' : 'None'", detail: "off_new_reasons_detail", count: "off_new_reasons_n" },
};

export function serviceBlock() {
  const D = 86400000;
  return {
    data: [
      ...Object.entries(SERVICE_QUERIES).map(([n, q]) => asData(n, q)),
      // ---- processes: silence and system exception spikes
      {
        name: "sv_pr",
        source: "sv_flow",
        transform: [
          { type: "flatten", fields: ["pr.buckets"], as: ["g"] },
          { type: "formula", as: "name", expr: "datum.g.key" },
          { type: "formula", as: "spoke", expr: "length(datum.g.sp.buckets) ? datum.g.sp.buckets[0].key : ''" },
          ...[0, 1, 2, 3, 4].map((k) => ({ type: "formula", as: `a${k}`, expr: `datum.g.w.buckets.w${k}.a.value` })),
          { type: "formula", as: "s0", expr: "datum.g.w.buckets.w0.s.value" },
          { type: "formula", as: "ab", expr: "datum.g.w.buckets.base.a.value" },
          { type: "formula", as: "sb", expr: "datum.g.w.buckets.base.s.value" },
          { type: "formula", as: "usual", expr: "(datum.a1 + datum.a2 + datum.a3 + datum.a4) / 4" },
          { type: "formula", as: "baseRate", expr: `max(${S.sysSpike.rateFloor}, datum.ab ? datum.sb / datum.ab : 0)` },
          { type: "formula", as: "rate0", expr: "datum.a0 ? datum.s0 / datum.a0 : 0" },
          {
            type: "formula",
            as: "silent",
            expr: `datum.usual >= ${S.usualFloor} && datum.a0 < datum.usual * ${S.belowUsual.act} ? 'act' : datum.usual >= ${S.usualFloor} && datum.a0 < datum.usual * ${S.belowUsual.warn} ? 'warn' : 'ok'`,
          },
          {
            type: "formula",
            as: "spike",
            expr: `datum.s0 >= ${S.sysSpike.actItems} && datum.rate0 > ${S.sysSpike.actX} * datum.baseRate ? 'act' : datum.s0 >= ${S.sysSpike.warnItems} && datum.rate0 > ${S.sysSpike.warnX} * datum.baseRate ? 'warn' : 'ok'`,
          },
          { type: "project", fields: ["name", "spoke", "a0", "a1", "a2", "a3", "a4", "s0", "ab", "sb", "usual", "baseRate", "rate0", "silent", "spike"] },
        ],
      },
      { name: "sv_pr_usual", source: "sv_pr", transform: [{ type: "filter", expr: `datum.usual >= ${S.usualFloor}` }] },
      {
        name: "off_processes",
        source: "sv_pr",
        transform: [
          { type: "filter", expr: "datum.silent !== 'ok'" },
          { type: "formula", as: "rank", expr: rankOf("datum.silent") },
          { type: "formula", as: "m", expr: "datum.usual - datum.a0" },
          { type: "formula", as: "txt", expr: "datum.name + ': ' + datum.a0 + ' in 24h vs usual ' + round(datum.usual)" },
          offSort,
        ],
      },
      {
        name: "off_sys_spike",
        source: "sv_pr",
        transform: [
          { type: "filter", expr: "datum.spike !== 'ok'" },
          { type: "formula", as: "rank", expr: rankOf("datum.spike") },
          { type: "formula", as: "m", expr: "datum.s0" },
          { type: "formula", as: "txt", expr: `datum.name + ': ' + datum.s0 + ' system exceptions (' + ${pct("datum.rate0")} + ' vs usual ' + ${pct("datum.baseRate")} + ')'` },
          offSort,
        ],
      },
      // ---- digital workers
      {
        name: "sv_vdist",
        source: "sv_vdi",
        transform: [
          { type: "flatten", fields: ["r.buckets"], as: ["g"] },
          { type: "formula", as: "name", expr: "datum.g.key" },
          { type: "formula", as: "status", expr: "length(datum.g.st.buckets) ? datum.g.st.buckets[0].key : ''" },
          { type: "project", fields: ["name", "status"] },
        ],
      },
      {
        name: "sv_rs",
        source: "sv_flow",
        transform: [
          { type: "flatten", fields: ["rs.buckets"], as: ["g"] },
          { type: "formula", as: "name", expr: "datum.g.key" },
          { type: "formula", as: "spoke", expr: "length(datum.g.sp.buckets) ? datum.g.sp.buckets[0].key : ''" },
          { type: "formula", as: "last", expr: "datum.g.last.value" },
          ...[0, 1, 2, 3, 4].map((k) => ({ type: "formula", as: `w${k}`, expr: `datum.g.w.buckets.w${k}.doc_count` })),
          { type: "formula", as: "usual", expr: "(datum.w1 + datum.w2 + datum.w3 + datum.w4) / 4" },
          { type: "lookup", from: "sv_vdist", key: "name", fields: ["name"], values: ["status"], as: ["vstatus"] },
          { type: "filter", expr: `datum.vstatus !== 'retired' && (datum.last >= svNow - ${7 * D} || datum.usual >= ${S.usualFloor})` },
          { type: "formula", as: "gapH", expr: `(svEstLast - max(datum.last, floor(svNow / ${D}) * ${D} + ${S.serviceHoursUtc[0] * H})) / ${H}` },
          { type: "formula", as: "gapX", expr: `datum.usual / ${S.serviceHoursUtc[1] - S.serviceHoursUtc[0]} * datum.gapH >= ${S.gapMinExpected}` },
          { type: "formula", as: "ageMin", expr: "(svNow - datum.last) / 60000" },
          {
            type: "formula",
            as: "state",
            expr:
              `datum.usual >= ${S.usualFloor} && datum.w0 < datum.usual * ${S.belowUsual.act} ? 'act'` +
              ` : svInHours && datum.gapX && datum.gapH > ${S.workerGapHours.act} ? 'act'` +
              ` : svInHours && datum.gapX && datum.gapH > ${S.workerGapHours.warn} ? 'warn'` +
              ` : datum.usual >= ${S.usualFloor} && datum.w0 < datum.usual * ${S.belowUsual.warn} ? 'warn' : 'ok'`,
          },
          { type: "formula", as: "hours", expr: "datum.g.h.t.buckets" },
          { type: "project", fields: ["name", "spoke", "last", "w0", "usual", "gapH", "ageMin", "state", "hours"] },
        ],
      },
      {
        name: "off_workers",
        source: "sv_rs",
        transform: [
          { type: "filter", expr: "datum.state !== 'ok'" },
          { type: "formula", as: "rank", expr: rankOf("datum.state") },
          { type: "formula", as: "m", expr: "datum.usual - datum.w0" },
          { type: "formula", as: "txt", expr: `datum.name + ': last item ' + ${fmtAge("datum.ageMin")} + ' ago, ' + datum.w0 + ' in 24h vs usual ' + round(datum.usual)` },
          offSort,
        ],
      },
      // ---- queues
      {
        name: "sv_q",
        source: "sv_pending",
        transform: [
          { type: "flatten", fields: ["q.buckets"], as: ["g"] },
          { type: "formula", as: "name", expr: "datum.g.key" },
          { type: "formula", as: "spoke", expr: "length(datum.g.sp.buckets) ? datum.g.sp.buckets[0].key : ''" },
          { type: "formula", as: "process", expr: "length(datum.g.pr.buckets) ? datum.g.pr.buckets[0].key : ''" },
          { type: "formula", as: "waiting", expr: "datum.g.live.doc_count" },
          { type: "formula", as: "deferred", expr: "datum.g.doc_count - datum.g.live.doc_count" },
          { type: "formula", as: "ageMin", expr: "datum.waiting ? (svNow - datum.g.live.oldest.value) / 60000 : 0" },
          { type: "formula", as: "stuck", expr: "datum.g.stuck.doc_count" },
          { type: "formula", as: "lockMin", expr: "datum.stuck ? (svNow - datum.g.stuck.oldest.value) / 60000 : 0" },
          { type: "formula", as: "past", expr: "datum.g.live.past.doc_count" },
          { type: "formula", as: "soon", expr: "datum.g.live.soon.doc_count" },
          { type: "formula", as: "state", expr: "datum.past > 0 ? 'act' : datum.soon > 0 ? 'warn' : 'ok'" },
          { type: "formula", as: "lockState", expr: "datum.stuck > 0 ? 'act' : 'ok'" },
          { type: "project", fields: ["name", "spoke", "process", "waiting", "deferred", "ageMin", "past", "soon", "stuck", "lockMin", "state", "lockState"] },
        ],
      },
      {
        name: "off_sla",
        source: "sv_q",
        transform: [
          { type: "filter", expr: "datum.state !== 'ok'" },
          { type: "formula", as: "rank", expr: rankOf("datum.state") },
          { type: "formula", as: "m", expr: "datum.past + datum.soon / 1000" },
          { type: "formula", as: "txt", expr: `datum.name + ': ' + (datum.past ? datum.past + ' past SLA' : datum.soon + ' due within ${S.slaSoonHours} h') + ', oldest ' + ${fmtAge("datum.ageMin")}` },
          offSort,
        ],
      },
      {
        name: "off_locks",
        source: "sv_q",
        transform: [
          { type: "filter", expr: "datum.stuck > 0" },
          { type: "formula", as: "rank", expr: "3" },
          { type: "formula", as: "m", expr: "datum.stuck" },
          { type: "formula", as: "txt", expr: `datum.name + ': ' + datum.stuck + ' locked, longest ' + ${fmtAge("datum.lockMin")}` },
          offSort,
        ],
      },
      { name: "sv_q_tot", source: "sv_q", transform: [{ type: "aggregate", ops: ["sum", "max", "sum", "sum", "sum"], fields: ["waiting", "ageMin", "stuck", "past", "soon"], as: ["waiting", "ageMin", "stuck", "past", "soon"] }] },
      // ---- unmapped queues
      {
        name: "off_unmapped",
        source: "sv_unmapped",
        transform: [
          { type: "flatten", fields: ["q.buckets"], as: ["g"] },
          { type: "formula", as: "name", expr: "datum.g.key" },
          { type: "formula", as: "n", expr: "datum.g.doc_count" },
          { type: "formula", as: "rank", expr: "2" },
          { type: "formula", as: "m", expr: "datum.n" },
          { type: "formula", as: "txt", expr: "datum.name + ': ' + datum.n + ' items'" },
          offSort,
        ],
      },
      { name: "sv_unmapped_tot", source: "off_unmapped", transform: [{ type: "aggregate", ops: ["sum"], fields: ["n"], as: ["n"] }] },
      // ---- exception reasons
      { name: "sv_base_codes", source: "sv_flow", transform: [{ type: "flatten", fields: ["rb.code.buckets"], as: ["g"] }, { type: "formula", as: "code", expr: "datum.g.key" }, { type: "project", fields: ["code"] }] },
      {
        name: "sv_codes",
        source: "sv_flow",
        transform: [
          { type: "flatten", fields: ["r0.code.buckets"], as: ["g"] },
          { type: "formula", as: "code", expr: "datum.g.key" },
          { type: "formula", as: "n", expr: "datum.g.doc_count" },
          { type: "formula", as: "reason", expr: "length(datum.g.rd.buckets) ? datum.g.rd.buckets[0].key : datum.code" },
          { type: "formula", as: "type", expr: "length(datum.g.ty.buckets) ? datum.g.ty.buckets[0].key : ''" },
          { type: "formula", as: "process", expr: "length(datum.g.pr.buckets) ? datum.g.pr.buckets[0].key : ''" },
          { type: "formula", as: "isNew", expr: "indexof(pluck(data('sv_base_codes'), 'code'), datum.code) < 0" },
          { type: "project", fields: ["code", "n", "reason", "type", "process", "isNew"] },
        ],
      },
      {
        name: "off_new_reasons",
        source: "sv_codes",
        transform: [
          { type: "filter", expr: `datum.isNew && datum.n >= ${S.newReasonMin}` },
          { type: "formula", as: "name", expr: "datum.reason" },
          { type: "formula", as: "rank", expr: "2" },
          { type: "formula", as: "m", expr: "datum.n" },
          { type: "formula", as: "txt", expr: "datum.reason + ' (' + datum.n + ', ' + datum.process + ')'" },
          offSort,
        ],
      },
      // ---- the board: one row per check
      {
        name: "checks",
        values: CHECKS.map((c, i) => ({ i, ...c })),
        transform: [
          { type: "formula", as: "status", expr: "svStatus[datum.i]" },
          { type: "formula", as: "rank", expr: rankOf("datum.status") },
          { type: "formula", as: "headline", expr: "svHeadline[datum.i]" },
          { type: "formula", as: "detail", expr: "svDetail[datum.i]" },
          { type: "formula", as: "n", expr: "svCount[datum.i]" },
        ],
      },
    ],
    signals: [
      { name: "svNow", update: "length(data('sv_fresh')) ? data('sv_fresh')[0].nowb.buckets[0].from : 0" },
      { name: "svInHours", update: `utchours(svNow) >= ${S.serviceHoursUtc[0]} && utchours(svNow) < ${S.serviceHoursUtc[1]}` },
      { name: "svLast", update: "length(data('sv_fresh')) ? data('sv_fresh')[0].last.value : null" },
      { name: "svEstLast", update: "length(data('sv_flow')) && data('sv_flow')[0].last.value ? data('sv_flow')[0].last.value : svNow" },
      { name: "svAgeMin", update: "isValid(svLast) ? (svNow - svLast) / 60000 : null" },
      { name: "svCostLast", update: "length(data('sv_cost')) ? data('sv_cost')[0].last.value : null" },
      { name: "svCostLag", update: `isValid(svCostLast) ? floor((floor(svNow / ${D}) * ${D} - floor(svCostLast / ${D}) * ${D}) / ${D}) : null` },
      { name: "svWorkers", update: "length(data('sv_rs'))" },
      { name: "svUsualProcs", update: "length(data('sv_pr_usual'))" },
      ...OFFENDER_CHECKS.flatMap((k) => summary(`off_${k}`)),
      {
        name: "svFreshStatus",
        update: `!svInHours ? 'quiet' : !isValid(svLast) ? 'act' : svAgeMin > ${S.freshnessMin.act} ? 'act' : svAgeMin > ${S.freshnessMin.warn} ? 'warn' : 'ok'`,
      },
      { name: "svCostStatus", update: `!isValid(svCostLag) ? 'act' : svCostLag >= ${S.costLagDays.act} ? 'act' : svCostLag >= ${S.costLagDays.warn} ? 'warn' : 'ok'` },
      { name: "svStatus", update: `[${CHECKS.map((c) => EVAL[c.id].status).join(", ")}]` },
      { name: "svHeadline", update: `[${CHECKS.map((c) => `(${EVAL[c.id].headline})`).join(", ")}]` },
      { name: "svDetail", update: `[${CHECKS.map((c) => EVAL[c.id].detail).join(", ")}]` },
      { name: "svCount", update: `[${CHECKS.map((c) => EVAL[c.id].count).join(", ")}]` },
      { name: "svAct", update: CHECKS.map((c, i) => `(svStatus[${i}] === 'act' ? 1 : 0)`).join(" + ") },
      { name: "svWarn", update: CHECKS.map((c, i) => `(svStatus[${i}] === 'warn' ? 1 : 0)`).join(" + ") },
    ],
  };
}
