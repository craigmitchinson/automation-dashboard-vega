// ---------------------------------------------------------------------------
// alert-rules.mjs: the five Kibana alerting rules (rule type .es-query) that
// stand behind the Service dashboard's alerting checks. build.mjs writes them
// into the import file as saved objects of type "alert".
//
// A rule cannot compare against a 4-week "usual", so workers, processes,
// system exceptions and new exception reasons stay on the dashboard.
//
// Each rule's time window filters on `timeField`, which is how "past SLA" and
// "locked" can look at item fields instead of @timestamp. Rules import
// disabled with no connector (see publish/docs/JOBS.md).
//
// Thresholds come from SERVICE (vega/lib/service.mjs), the same numbers the
// dashboard uses. The saved-object shape follows Kibana 8.15's export of an
// Elasticsearch query rule; it has not been tried against a live Kibana.
// ---------------------------------------------------------------------------
import { IDX } from "./lib/tokens.mjs";
import { SERVICE, CHECKS } from "./lib/service.mjs";
import { MAPPED } from "./lib/es.mjs";

const S = SERVICE;
const runbook = (id) => CHECKS.find((c) => c.id === id).runbook;
const WIN_ITEMS = 120; // days of waiting items the dashboard looks at

// timeWindow is [size, unit]; compare/threshold apply to the hit count
export const RULES = [
  {
    id: "data-arriving",
    check: "freshness",
    name: "IA · Data arriving",
    index: IDX.items + "*",
    timeField: "item.last_updated_at",
    window: [S.freshnessMin.warn, "m"],
    query: { match_all: {} },
    compare: "<",
    threshold: 1,
    every: "15m",
    fires: `no item updated in the last ${S.freshnessMin.warn} minutes`,
    limitation: `An Elasticsearch query rule has no service-hours setting, so on its own it also fires overnight and at weekends when nothing arrives. Restrict the rule's action to ${String(S.serviceHoursUtc[0]).padStart(2, "0")}:00 to ${S.serviceHoursUtc[1]}:00 UTC (action option "If alert matches a query / On selected days and hours"); the dashboard's own check does this for you. It also fires at the Warning threshold, not Action (${S.freshnessMin.act} minutes).`,
  },
  {
    id: "cost-pipeline",
    check: "cost_pipeline",
    name: "IA · Cost pipelines up to date",
    index: IDX.costDaily + "*",
    timeField: "@timestamp",
    window: [S.costLagDays.warn, "d"],
    query: { match_all: {} },
    compare: "<",
    threshold: 1,
    every: "1h",
    fires: `no ia-cost-daily document dated in the last ${S.costLagDays.warn} days`,
  },
  {
    id: "queues-mapped",
    check: "unmapped",
    name: "IA · All queues mapped",
    index: IDX.items + "*",
    timeField: "@timestamp",
    window: [24, "h"],
    query: { term: { mapped: false } },
    compare: ">",
    threshold: 0,
    every: "1h",
    fires: "any item in the last 24 hours from a queue missing from reference data (mapped is false)",
  },
  {
    id: "past-sla",
    check: "sla",
    name: "IA · Nothing past its SLA",
    index: IDX.items + "*",
    timeField: "item.sla_due_at",
    window: [WIN_ITEMS, "d"],
    query: { bool: { filter: [MAPPED, { term: { "n.pending": 1 } }], must_not: [{ range: { "item.deferred_at": { gt: "now" } } }] } },
    compare: ">",
    threshold: 0,
    every: "15m",
    fires: `any waiting item (not deferred to the future) whose item.sla_due_at has passed, looking back ${WIN_ITEMS} days`,
  },
  {
    id: "stuck-locks",
    check: "locks",
    name: "IA · Nothing stuck on a lock",
    index: IDX.items + "*",
    timeField: "item.locked_at",
    window: [WIN_ITEMS, "d"],
    query: { bool: { filter: [MAPPED, { term: { "n.pending": 1 } }, { range: { "item.locked_at": { lte: `now-${S.lockMinutes}m` } } }] } },
    compare: ">",
    threshold: 0,
    every: "15m",
    fires: `any waiting item locked for more than ${S.lockMinutes} minutes`,
  },
].map((r) => ({ ...r, message: `${r.name}: ${r.fires}. First step: ${runbook(r.check)}` }));

// The saved object for one rule, in the shape Kibana 8.15 exports.
export function ruleObject(r, kibanaVersion, capped) {
  const now = "2026-01-01T00:00:00.000Z"; // fixed so rebuilds do not churn the file; Kibana sets the real dates on import
  return {
    id: `ia-rule-${r.id}`,
    type: "alert",
    attributes: {
      name: r.name,
      tags: ["ia", "service"],
      alertTypeId: ".es-query",
      consumer: "stackAlerts",
      schedule: { interval: r.every },
      enabled: false,
      actions: [],
      params: {
        searchType: "esQuery",
        index: [r.index],
        timeField: r.timeField,
        esQuery: JSON.stringify({ query: r.query }),
        size: 100,
        timeWindowSize: r.window[0],
        timeWindowUnit: r.window[1],
        threshold: [r.threshold],
        thresholdComparator: r.compare,
        aggType: "count",
        groupBy: "all",
        termSize: 5,
        excludeHitsFromPreviousRun: false,
        sourceFields: [],
      },
      throttle: null,
      notifyWhen: null,
      muteAll: false,
      mutedInstanceIds: [],
      snoozeSchedule: [],
      apiKey: null,
      apiKeyOwner: null,
      apiKeyCreatedByUser: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
      executionStatus: { status: "pending", lastExecutionDate: now },
      meta: { versionApiKeyLastmodified: kibanaVersion },
      scheduledTaskId: null,
      legacyId: null,
      revision: 0,
      running: false,
    },
    references: [],
    coreMigrationVersion: kibanaVersion,
    typeMigrationVersion: capped("8.9.0"),
  };
}
