// ---------------------------------------------------------------------------
// pipeline.mjs — the two ETL stages as plain functions.
//
//   Stage 1  enrichItem()   one Blue Prism work-queue item in, one
//                           ia-workqueue-items document out. Per-record, so
//                           this is the Logstash pipeline's job
//                           (etl/logstash/ia-enrich.rb is the Ruby twin).
//
//   Stage 2  costDay()      needs every item for a day before any one item
//                           can be costed (worktime shares), so it runs as a
//                           scheduled job after ingest, not in Logstash
//                           (etl/cost-job/stamp_costs.py is the Python twin).
//                           Writes ia-cost-daily and ia-vdi-daily and stamps
//                           cost.* onto that day's items.
//
// Field names here ARE the data contract (docs/DATA-CONTRACT.md).
// ---------------------------------------------------------------------------
import { dateOnly, parseBpDate, gradeRate, gradeName, makeClassifier, displayReason, reasonCode, poolsOn, vdiDailyCost } from "./economics.mjs";

const iso = (ts) => (ts == null ? null : new Date(ts).toISOString());
const round = (n, dp = 6) => Number(n.toFixed(dp));

export function makeLookups(ref) {
  const procById = new Map(ref.processes.map((p) => [p.processId, p]));
  const propById = new Map(ref.propositions.map((p) => [p.propositionId, p]));
  const spokeById = new Map(ref.spokes.map((s) => [s.spokeId, s]));
  const queueMap = new Map(ref.queueMap.map((q) => [q.queueName, q]));
  const resourceByName = new Map(ref.resources.map((r) => [r.resourceName, r]));
  return { procById, propById, spokeById, queueMap, resourceByName, classify: makeClassifier(ref) };
}

// --- Stage 1 ------------------------------------------------------------------
export function enrichItem(row, ref, lk) {
  const id = (row.ID ?? "").trim();
  if (!id) return null; // blank-ID rows are dropped

  const loaded = parseBpDate(row.LoadedDate);
  const completed = parseBpDate(row.CompletedDate);
  const exceptionAt = parseBpDate(row.ExceptionDate);
  const locked = parseBpDate(row.LockedDate);
  const lastUpdated = parseBpDate(row.LastUpdatedDate) ?? completed ?? exceptionAt ?? locked ?? loaded;
  const worktime = Number.parseInt(row.Worktime, 10) || 0;

  // Outcome comes from which date is populated, never the Status text.
  const outcome = completed != null ? "Completed" : exceptionAt != null ? "Exception" : "Pending";
  const outcomeTs = completed ?? exceptionAt ?? loaded;
  const outcomeDate = dateOnly(outcomeTs);

  const qm = lk.queueMap.get((row.QueueName ?? "").trim());
  const proc = qm ? lk.procById.get(qm.processId) : null;
  const prop = proc ? lk.propById.get(proc.propositionId) : null;
  const spoke = prop ? lk.spokeById.get(prop.spokeId) : null;
  const res = lk.resourceByName.get((row.Resource ?? "").trim());
  const resOwner = res ? (res.spokeId != null ? lk.spokeById.get(res.spokeId).spokeName : "Hub") : null;

  const excType = outcome === "Exception" ? lk.classify(row.ExceptionReason?.trim() || null) : null;
  const reasonDisplay = outcome === "Exception" ? displayReason(row.ExceptionReason?.trim() || null) : null;

  const rate = proc ? gradeRate(ref, proc.grade, prop.spokeId, outcomeDate) : 0;
  const smv = proc ? proc.smvMinutes : 0;
  const isC = outcome === "Completed" ? 1 : 0;
  const isE = outcome === "Exception" ? 1 : 0;

  const doc = {
    "@timestamp": iso(outcomeTs),
    outcome_date: outcomeDate,
    item: {
      id,
      key_value: row.KeyValue?.trim() || null,
      priority: Number.parseInt(row.Priority, 10) || null,
      status: row.Status?.trim() || null,
      tags: row.Tags?.trim() || null,
      attempt: Number.parseInt(row.Attempt, 10) || null,
      loaded_at: iso(loaded),
      last_updated_at: iso(lastUpdated),
      completed_at: iso(completed),
      exception_at: iso(exceptionAt),
      locked_at: iso(locked),
      deferred_at: iso(parseBpDate(row.DeferredDate)),
    },
    queue: { name: row.QueueName?.trim() || null, stage: qm?.stageName ?? null, stage_order: qm?.stageOrder ?? null },
    resource: { name: row.Resource?.trim() || null, bot: res?.botName ?? null, owner_spoke: resOwner },
    outcome,
    exception: excType ? { type: excType, reason: row.ExceptionReason?.trim() || null, reason_display: reasonDisplay, code: reasonCode(ref, reasonDisplay) } : null,
    worktime_sec: worktime,
    worktime_completed_sec: isC ? worktime : 0,
    mapped: !!proc,
    n: {
      completed: isC,
      exception: isE,
      business: excType === "Business" ? 1 : 0,
      system: excType === "System" ? 1 : 0,
      pending: outcome === "Pending" ? 1 : 0,
      attempt: isC + isE,
    },
    process: proc
      ? { id: String(proc.processId), name: proc.processName, acronym: proc.processAcronym, tags: proc.tags ?? [], smv_minutes: smv, grade: proc.grade, grade_name: gradeName(ref, proc.grade) }
      : null,
    proposition: prop ? { name: prop.propositionName } : null,
    spoke: spoke ? { id: String(spoke.spokeId), name: spoke.spokeName, short: spoke.shortName } : null,
    value: {
      hourly_rate_gbp: rate,
      hours_saved: proc && isC ? smv / 60 : 0,
      benefit_gbp: proc && isC ? round((smv * rate) / 60) : 0,
      rework_gbp: proc && isE ? round((smv * rate) / 60) : 0,
    },
    cost: null, // stamped by stage 2
  };
  return doc;
}

// --- Stage 2 ------------------------------------------------------------------
// items: every ia-workqueue-items document whose outcome_date === dateISO
// (mapped AND unmapped: unmapped worktime still counts in the denominators).
export function costDay(ref, dateISO, items) {
  const pools = poolsOn(ref, dateISO);
  const estateWt = items.reduce((s, i) => s + i.worktime_sec, 0);
  const spokeWt = new Map();
  for (const i of items) if (i.spoke) spokeWt.set(i.spoke.name, (spokeWt.get(i.spoke.name) ?? 0) + i.worktime_sec);

  const hubTotal = pools.hubPeople + pools.hubInfra;
  const costDaily = [
    {
      "@timestamp": dateISO + "T00:00:00.000Z",
      date: dateISO,
      pool: "HUB",
      pool_type: "hub",
      spoke: null,
      people_gbp: pools.hubPeople,
      infra_gbp: pools.hubInfra,
      total_gbp: hubTotal,
      worktime_sec: estateWt,
      estate_worktime_sec: estateWt,
      cost_per_bot_sec: estateWt ? hubTotal / estateWt : 0,
      working_days_per_year: pools.workingDaysPerYear,
      productive_hours_per_day: pools.productiveHoursPerDay,
    },
  ];
  const spokeRates = new Map();
  for (const s of ref.spokes) {
    const p = pools.spokes.get(s.spokeId);
    const wt = spokeWt.get(s.spokeName) ?? 0;
    const total = p.people + p.infra;
    spokeRates.set(s.spokeName, { people: wt ? p.people / wt : 0, infra: wt ? p.infra / wt : 0 });
    costDaily.push({
      "@timestamp": dateISO + "T00:00:00.000Z",
      date: dateISO,
      pool: s.spokeName,
      pool_type: "spoke",
      spoke: { name: s.spokeName },
      people_gbp: p.people,
      infra_gbp: p.infra,
      total_gbp: total,
      worktime_sec: wt,
      estate_worktime_sec: estateWt,
      cost_per_bot_sec: wt ? total / wt : 0,
      working_days_per_year: pools.workingDaysPerYear,
      productive_hours_per_day: pools.productiveHoursPerDay,
    });
  }

  // Stamp: worktime x (hub £/bot-sec + own spoke £/bot-sec), kept by component.
  const hubPeopleCps = estateWt ? pools.hubPeople / estateWt : 0;
  const hubInfraCps = estateWt ? pools.hubInfra / estateWt : 0;
  for (const i of items) {
    if (!i.mapped) { i.cost = null; continue; } // unmapped items carry no £ (React parity)
    const sr = spokeRates.get(i.spoke.name);
    const c = {
      hub_people_gbp: i.worktime_sec * hubPeopleCps,
      hub_infra_gbp: i.worktime_sec * hubInfraCps,
      spoke_people_gbp: i.worktime_sec * sr.people,
      spoke_infra_gbp: i.worktime_sec * sr.infra,
    };
    c.people_gbp = c.hub_people_gbp + c.spoke_people_gbp;
    c.infra_gbp = c.hub_infra_gbp + c.spoke_infra_gbp;
    c.estate_gbp = c.people_gbp + c.infra_gbp;
    for (const k of Object.keys(c)) c[k] = round(c[k], 8);
    i.cost = c;
  }

  const vdiDaily = ref.resources.map((r) => {
    const cost = vdiDailyCost(ref, r, dateISO);
    return {
      "@timestamp": dateISO + "T00:00:00.000Z",
      date: dateISO,
      resource: {
        name: r.resourceName,
        bot: r.botName,
        owner_spoke: r.spokeId != null ? ref.spokes.find((s) => s.spokeId === r.spokeId).spokeName : "Hub",
        cost_class: r.costClass,
        status: r.status,
      },
      available: cost > 0,
      daily_cost_gbp: cost,
      operating_hours: cost > 0 ? ref.vdiOperatingHoursPerDay : 0,
    };
  });

  return { costDaily, vdiDaily };
}

// --- Reference index ----------------------------------------------------------
// Small, team-owned documents the dashboards read directly: targets, finance
// targets, the process catalogue and a little config.
export function referenceDocs(ref, asOfISO) {
  const lk = makeLookups(ref);
  const docs = [];
  for (const [metric, value] of Object.entries(ref.targets)) {
    if (metric === "fiscalYearStartMonth") continue;
    docs.push({ doc_type: "target", metric, scope: "global", scope_id: null, value });
  }
  for (const o of ref.thresholdOverrides ?? []) {
    docs.push({ doc_type: "target", metric: o.metric, scope: o.scope, scope_id: String(o.scopeId), value: o.value });
  }
  for (const f of ref.financeTargets ?? []) {
    docs.push({ doc_type: "finance_target", spoke: f.spokeId, annual_net_benefit_target_gbp: f.annualNetBenefitTargetGBP });
  }
  docs.push({
    doc_type: "config",
    fiscal_year_start_month: ref.targets.fiscalYearStartMonth ?? 4,
    vdi_operating_hours: ref.vdiOperatingHoursPerDay,
    warn_margin: 0.1,
    min_alert_volume: 30,
    alert_window_days: 7,
  });
  for (const p of ref.processes) {
    const prop = lk.propById.get(p.propositionId);
    const spoke = lk.spokeById.get(prop.spokeId);
    const queues = ref.queueMap.filter((q) => q.processId === p.processId).sort((a, b) => (a.stageOrder ?? 1) - (b.stageOrder ?? 1));
    docs.push({
      doc_type: "process",
      process: { id: String(p.processId), name: p.processName, acronym: p.processAcronym, description: p.processDescription, tags: p.tags ?? [], smv_minutes: p.smvMinutes, grade: p.grade, grade_name: gradeName(ref, p.grade), current_rate_gbp: gradeRate(ref, p.grade, prop.spokeId, asOfISO), is_active: !!p.isActive },
      proposition: { name: prop.propositionName },
      spoke: { id: String(spoke.spokeId), name: spoke.spokeName, short: spoke.shortName, color: spoke.colorLight },
      queues: queues.map((q) => (q.stageName ? `${q.queueName} (${q.stageName})` : q.queueName)),
      primary_queue: queues[0]?.queueName ?? null,
    });
  }
  for (const s of ref.spokes) docs.push({ doc_type: "spoke", spoke: { id: String(s.spokeId), name: s.spokeName, short: s.shortName, color: s.colorLight } });
  return docs;
}
