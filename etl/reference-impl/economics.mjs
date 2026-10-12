// ---------------------------------------------------------------------------
// economics.mjs: reference implementation of every transformation the ETL
// must perform. Ported line for line from the React app's pipeline
// (automation-dashboard: tools/build-dashboard-data.mjs and
// src/reference/economics.ts). Logstash, the cost job and this file must
// agree to the penny; tests/parity.test.mjs checks this file against the
// React app's own published totals.
//
// Nothing here is Kibana-specific. It is the executable version of
// docs/DATA-CONTRACT.md.
// ---------------------------------------------------------------------------

export const DAY = 86400000;
export const dateOnly = (ts) => new Date(ts).toISOString().slice(0, 10);
const parseISO = (d) => Date.parse(d + "T00:00:00Z");

// --- T1. Dates --------------------------------------------------------------
// Blue Prism dates arrive as "YYYY-MM-DD HH:MM:SS" or ISO without offset, in
// UTC. Blank or unparseable becomes null.
export function parseBpDate(s) {
  if (s == null) return null;
  const v = String(s).trim();
  if (!v) return null;
  const t = Date.parse(v.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? "" : "Z"));
  return Number.isNaN(t) ? null : t;
}

// --- T2. Date-effective lookup -----------------------------------------------
// The row with the latest effectiveFrom <= date wins.
export function inForce(history, dateISO) {
  let best = null;
  for (const h of history) if (h.effectiveFrom <= dateISO && (!best || h.effectiveFrom > best.effectiveFrom)) best = h;
  return best;
}

// --- T3. Grade rate in force (spoke-first) -----------------------------------
// For (grade, spoke, day): the latest spoke-specific row in force wins
// outright; otherwise the latest universal row (no spokeId) in force.
export function gradeRate(ref, grade, spokeId, dateISO) {
  const rows = ref.gradeRates.filter((g) => g.grade === grade);
  const sid = spokeId != null ? String(spokeId) : null;
  const viaSpoke = sid != null ? inForce(rows.filter((g) => g.spokeId === sid), dateISO) : null;
  if (viaSpoke) return viaSpoke.hourlyCostGBP;
  return inForce(rows.filter((g) => g.spokeId == null), dateISO)?.hourlyCostGBP ?? 0;
}

export function gradeName(ref, grade) {
  return (ref.grades ?? []).find((g) => g.grade === grade)?.gradeName ?? ref.gradeRates.find((g) => g.grade === grade)?.gradeName ?? grade;
}

// --- T4. Exception classification ---------------------------------------------
// 1. "Business Exception..." / "System Exception..." prefix is trusted.
// 2. Otherwise the first matching pattern, ordered priority DESC then pattern
//    length DESC (longest, most specific pattern first), case-insensitive
//    substring match ("%" wildcards are stripped).
// 3. Otherwise Business.
export function makeClassifier(ref) {
  const patterns = [...ref.exceptionPatterns]
    .map((p) => ({ ...p, needle: p.matchPattern.replace(/%/g, "").toLowerCase() }))
    .sort((a, b) => b.priority - a.priority || b.matchPattern.length - a.matchPattern.length);
  return (reason) => {
    if (!reason) return "Business";
    if (/^business exception/i.test(reason)) return "Business";
    if (/^system exception/i.test(reason)) return "System";
    const low = reason.toLowerCase();
    for (const p of patterns) if (low.includes(p.needle)) return p.exceptionType;
    return "Business";
  };
}

// Display reason: the prefix stripped, "(no reason recorded)" when empty.
export const displayReason = (reason) => (reason ?? "").replace(/^(business|system) exception:?\s*/i, "") || "(no reason recorded)";

// Short code for the heatmap column header: reference.exceptionDisplayCodes,
// else the initials of the display reason (max 3, upper case).
export function reasonCode(ref, display) {
  const fixed = ref.exceptionDisplayCodes?.[display];
  if (fixed) return fixed;
  return display
    .split(/[\s/]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

// --- T5. VDI renewal / coverage window ----------------------------------------
// Renewal cycles tile every 365 days from renewalDate, forward and backward.
// A VDI outside its coverage window costs £0 AND has no capacity that day.
export function cycleStart(renewalDateISO, dateISO) {
  const renewalTs = parseISO(renewalDateISO);
  const dateTs = parseISO(dateISO);
  const idx = Math.floor((dateTs - renewalTs) / (365 * DAY));
  return renewalTs + idx * 365 * DAY;
}
export function coverageWindow(vdi, cycleStartTs) {
  let end = cycleStartTs + 365 * DAY;
  if (vdi.licenseExpiryDate) end = Math.min(end, parseISO(vdi.licenseExpiryDate) + DAY);
  if (vdi.status === "retired" && vdi.activeTo) end = Math.min(end, parseISO(vdi.activeTo) + DAY);
  const start = Math.max(cycleStartTs, parseISO(vdi.activeFrom));
  return { start, end };
}
export function vdiClassRate(ref, costClass, dateISO, spokeId) {
  const rows = ref.vdiCostHistory.filter((v) => v.costClass === costClass);
  const sid = spokeId != null ? String(spokeId) : null;
  const viaSpoke = sid != null ? inForce(rows.filter((v) => v.spokeId === sid), dateISO) : null;
  if (viaSpoke) return viaSpoke.annualCostPerVDIGBP;
  return inForce(rows.filter((v) => v.spokeId == null), dateISO)?.annualCostPerVDIGBP ?? 0;
}
export function vdiDailyCost(ref, vdi, dateISO) {
  const dateTs = parseISO(dateISO);
  const cs = cycleStart(vdi.renewalDate, dateISO);
  const { start, end } = coverageWindow(vdi, cs);
  if (dateTs < start || dateTs >= end) return 0;
  const windowDays = Math.round((end - start) / DAY);
  const annual = vdi.annualCostGBP ?? vdiClassRate(ref, vdi.costClass, dateOnly(cs), vdi.spokeId);
  return windowDays > 0 ? annual / windowDays : 0;
}

// --- T6. People cost in force ---------------------------------------------------
// ownerId "HUB" for the CoE team, the spokeId as a string for a spoke team.
export const peopleCostOn = (ref, ownerId, dateISO) => inForce(ref.peopleCostHistory.filter((p) => p.ownerId === ownerId), dateISO)?.annualCostGBP ?? 0;

// --- T7. Pools for one day ---------------------------------------------------------
// hub pool/day   = HUB people/365.25 + hub-owned VDIs' daily cost
// spoke pool/day = that spoke's people/365.25 + that spoke's VDIs' daily cost
export function poolsOn(ref, dateISO) {
  const hubPeople = peopleCostOn(ref, "HUB", dateISO) / 365.25;
  let hubInfra = 0;
  const spokes = new Map(ref.spokes.map((s) => [s.spokeId, { people: peopleCostOn(ref, String(s.spokeId), dateISO) / 365.25, infra: 0 }]));
  for (const r of ref.resources) {
    const c = vdiDailyCost(ref, r, dateISO);
    if (r.spokeId == null) hubInfra += c;
    else spokes.get(r.spokeId).infra += c;
  }
  const est = inForce(ref.estateCostHistory, dateISO);
  return { hubPeople, hubInfra, spokes, workingDaysPerYear: est?.workingDaysPerYear ?? 252, productiveHoursPerDay: est?.productiveHoursPerDay ?? 7.5 };
}
