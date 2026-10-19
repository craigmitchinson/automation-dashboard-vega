// ---------------------------------------------------------------------------
// generate-mock-data.mjs
// ---------------------------------------------------------------------------
// Writes data/mock/BPAWorkQueueItem.csv, a deterministic, realistic stand-in
// for a Blue Prism work queue export (BP 7.2 BPAWorkQueueItem fields, plus
// QueueName). THIS FILE DEFINES THE SWAP POINT: replace the CSV with a real
// export (or the output of bp-sql-layer/ingest/elastic_to_csv.py pulling from
// Elastic) and re-run `npm run data:build`, nothing downstream changes.
//
// Column order matches raw.WorkQueueItem in bp-sql-layer exactly:
//   ID, KeyValue, Priority, Status, Tags, Resource, Attempt,
//   LoadedDate, LastUpdatedDate, DeferredDate, LockedDate, CompletedDate,
//   Worktime, ExceptionDate, ExceptionReason, QueueName
//
// The generator knows nothing the transform relies on: classification is done
// downstream from the reason text (prefix -> pattern fallback -> default),
// exactly as core.usp_MergeFact does. ~85% of exception reasons carry the
// "Business Exception:" / "System Exception:" prefix convention; the rest are
// legacy unprefixed strings that exercise the pattern fallback (and one that
// matches nothing, exercising the default-to-Business rule).
//
// Run: npm run data:mock   (then npm run data:build)
// ---------------------------------------------------------------------------
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(root, "mock", "BPAWorkQueueItem.csv");

// --- deterministic PRNG (mulberry32) ---------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260715);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pickW = (pairs) => {
  // pairs: [ [value, weight], ... ]
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
};
const guid = () => {
  const h = () => Math.floor(rand() * 16).toString(16).toUpperCase();
  const s = (n) => Array.from({ length: n }, h).join("");
  return `${s(8)}-${s(4)}-${s(4)}-${s(4)}-${s(12)}`;
};

// --- window -----------------------------------------------------------------
const DAY = 86400000;
const START = Date.UTC(2025, 0, 1);
const END = Date.UTC(2026, 6, 14); // last full day; "today" is 2026-07-15
const SPAN = Math.round((END - START) / DAY);

// --- estate (must match data/reference/reference.json) ----------------------
// Hub & spoke: each VDI belongs to a spoke, and a spoke's queues run on the
// spoke's own machines (spoke 1 Insurance, Pensions & Investments; 2 Risk;
// 3 Commercial; 4 Consumer Lending).
const PROD_VDIS = [
  { name: "VDI-RPA-PROD-01", spoke: 1, from: START, to: null },
  { name: "VDI-RPA-PROD-02", spoke: 1, from: START, to: null },
  { name: "VDI-RPA-PROD-03", spoke: 1, from: START, to: Date.UTC(2025, 2, 31) },
  { name: "VDI-RPA-PROD-04", spoke: 1, from: START, to: null },
  { name: "VDI-RPA-PROD-05", spoke: 1, from: START, to: null },
  { name: "VDI-RPA-PROD-06", spoke: 1, from: START, to: null },
  { name: "VDI-RPA-PROD-07", spoke: 1, from: Date.UTC(2025, 5, 1), to: null },
  { name: "VDI-RPA-PROD-08", spoke: 2, from: START, to: null },
  { name: "VDI-RPA-PROD-09", spoke: 3, from: START, to: null },
  { name: "VDI-RPA-PROD-10", spoke: 4, from: START, to: null },
  { name: "VDI-RPA-PROD-11", spoke: 4, from: Date.UTC(2025, 8, 1), to: null },
];
// D6 demonstrability: exactly one ACTIVE, registered VDI goes idle ~30 days
// before data-through and stays idle through the end of the window, so the
// stale-VDI alert (src/alerts/engine.ts) and the Capacity page's idle-review
// queue have something real to fire on against the mock dataset, without
// this, every active VDI has activity through data-through and that feature
// path is permanently untested/invisible. VDI-RPA-PROD-06 (spoke 1) is
// picked because spoke 1 has plenty of OTHER live VDIs (01/02/04/05/07) to
// absorb its share of the workload, so removing it from the selection pool
// doesn't starve any queue. Deterministic: same seed -> same last-seen date.
const STALE_VDI = "VDI-RPA-PROD-06";
const STALE_IDLE_DAYS = 30;
const STALE_CUTOFF = END - STALE_IDLE_DAYS * DAY; // STALE_VDI may only be picked on/before this ts

const liveVdis = (ts, spoke) =>
  PROD_VDIS.filter((v) => v.spoke === spoke && ts >= v.from && (v.to === null || ts <= v.to) && !(v.name === STALE_VDI && ts > STALE_CUTOFF));

// --- exception reason catalogue ---------------------------------------------
// base text -> emitted either prefixed (the convention, ~85%) or legacy/unprefixed.
const SYS = {
  TMO: "Application timeout waiting for core system",
  ENF: "Element not found on screen",
  LGN: "Login failed for credential vault account",
  CTX: "Citrix session disconnected mid-run",
  DLG: "Unexpected dialog window blocked automation",
};
const BUS = {
  CNF: "Customer record not found in core system",
  INV: "Case data invalid for processing",
  DOC: "Documentation missing or incomplete",
  TOL: "Value outside tolerance - manual referral",
  DUP: "Duplicate case already processed",
};
// legacy reasons are ALWAYS emitted unprefixed: three resolve via the pattern
// fallback, one ("Reference data mismatch…") matches no pattern and lands on
// the default-to-Business rule.
const LEGACY = [
  { text: "Connection to mainframe lost during navigation", kind: "sys" },
  { text: "Timeout retrieving policy record", kind: "sys" },
  { text: "Manual referral required - complex case", kind: "bus" },
  { text: "Reference data mismatch between systems", kind: "bus" },
];

// --- turnaround (loaded to outcome) -----------------------------------------
// Each queue spends a typical share of its process's SLA (tat) between load
// and outcome, so turnaround scales with the SLA and a few queues miss it.
// The outcome time is never moved (dates, cost and benefit stay as they were):
// the load time is set back from it, using the wait draw already made, so the
// random sequence is untouched.
const REF = JSON.parse(readFileSync(join(root, "etl", "reference", "reference.json"), "utf8"));
const slaHoursOf = (queue) => {
  const pid = REF.queueMap.find((m) => m.queueName === queue)?.processId;
  return REF.processes.find((p) => p.processId === pid)?.slaHours ?? REF.slaHoursDefault ?? 24;
};
const turnaroundSec = (q, u, wt) => Math.max(wt + 120, Math.round(slaHoursOf(q.queue) * 3600 * q.tat * (0.2 + 1.6 * u * u)));

// --- queue profiles -----------------------------------------------------------
// baseDaily = mean weekday volume; wt = mean worktime seconds;
// busRate/sysRate = base exception probabilities; weekendFactor = weekend volume.
// sysMix/busMix = the process's exception "fingerprint" (weights over reasons).
const QUEUES = [
  { queue: "INSURANCE_NEW_BUS", tat: 0.55, key: "INB", spoke: 1, baseDaily: 55, wt: 280, busRate: 0.05, sysRate: 0.03, weekendFactor: 0.12, keyFmt: (n) => `POL-${9000000 + n}`, sysMix: [["TMO", 3], ["ENF", 2], ["LGN", 1], ["DLG", 1]], busMix: [["CNF", 2], ["INV", 3], ["DOC", 2], ["DUP", 1]] },
  { queue: "INSURANCE_RENEWALS", tat: 0.5, key: "IRN", spoke: 1, baseDaily: 48, wt: 190, busRate: 0.03, sysRate: 0.025, weekendFactor: 0.12, keyFmt: (n) => `REN-${5000000 + n}`, sysMix: [["TMO", 3], ["ENF", 1], ["DLG", 1]], busMix: [["INV", 2], ["DUP", 3], ["TOL", 1]] },
  { queue: "HOME_CLAIMS", tat: 0.72, key: "HCL", spoke: 1, baseDaily: 30, wt: 420, busRate: 0.08, sysRate: 0.04, weekendFactor: 0.25, keyFmt: (n) => `CLM-${700000 + n}`, sysMix: [["TMO", 2], ["ENF", 2], ["CTX", 1], ["DLG", 1]], busMix: [["DOC", 4], ["CNF", 1], ["INV", 2], ["TOL", 2]] },
  { queue: "PENSIONS_TRANSFER", tat: 0.57, key: "PTR", spoke: 1, baseDaily: 28, wt: 540, busRate: 0.07, sysRate: 0.05, weekendFactor: 0.1, keyFmt: (n) => `TRF-${300000 + n}`, sysMix: [["TMO", 3], ["ENF", 1], ["LGN", 1], ["CTX", 1]], busMix: [["TOL", 3], ["CNF", 2], ["DOC", 2], ["INV", 1]] },
  { queue: "PENSIONS_TRF_FINAL", tat: 0.6, key: "PTF", spoke: 1, baseDaily: 0, wt: 360, busRate: 0.04, sysRate: 0.03, weekendFactor: 0.1, keyFmt: null, sysMix: [["TMO", 2], ["ENF", 1], ["DLG", 1]], busMix: [["TOL", 2], ["INV", 1], ["DOC", 1]] }, // fed by PTR completions, same KeyValue
  { queue: "PENSIONS_VALUATION", tat: 0.45, key: "PVL", spoke: 1, baseDaily: 70, wt: 120, busRate: 0.02, sysRate: 0.02, weekendFactor: 0.5, keyFmt: (n) => `VAL-${1500000 + n}`, sysMix: [["TMO", 4], ["ENF", 1]], busMix: [["INV", 2], ["TOL", 2]] },
  { queue: "LIFE_UNDERWRITING", tat: 0.6, key: "LUW", spoke: 1, baseDaily: 18, wt: 600, busRate: 0.09, sysRate: 0.05, weekendFactor: 0.1, keyFmt: (n) => `LUW-${400000 + n}`, sysMix: [["TMO", 2], ["ENF", 2], ["DLG", 2], ["LGN", 1]], busMix: [["DOC", 4], ["INV", 2], ["CNF", 1], ["TOL", 2]] },
  { queue: "INVEST_REBALANCE", tat: 0.5, key: "IRB", spoke: 1, baseDaily: 45, wt: 200, busRate: 0.025, sysRate: 0.035, weekendFactor: 0.5, keyFmt: (n) => `RBL-${2000000 + n}`, sysMix: [["CTX", 3], ["TMO", 2], ["ENF", 1]], busMix: [["TOL", 3], ["DUP", 1]] },
  { queue: "INVEST_ONBOARDING", tat: 0.58, key: "ION", spoke: 1, baseDaily: 15, wt: 480, busRate: 0.1, sysRate: 0.06, weekendFactor: 0.1, keyFmt: (n) => `ACC-${800000 + n}`, sysMix: [["TMO", 2], ["ENF", 2], ["LGN", 2], ["DLG", 1]], busMix: [["DOC", 3], ["CNF", 3], ["INV", 2], ["DUP", 1]] },
  // --- Risk spoke ---
  { queue: "RISK_SANCTIONS", tat: 0.5, key: "SSR", spoke: 2, baseDaily: 40, wt: 150, busRate: 0.04, sysRate: 0.02, weekendFactor: 0.3, keyFmt: (n) => `SAN-${600000 + n}`, sysMix: [["TMO", 3], ["ENF", 1]], busMix: [["DUP", 2], ["CNF", 2], ["INV", 1]] },
  { queue: "RISK_FRAUD_TRIAGE", tat: 0.66, key: "FCT", spoke: 2, baseDaily: 20, wt: 380, busRate: 0.08, sysRate: 0.04, weekendFactor: 0.3, keyFmt: (n) => `FRD-${250000 + n}`, sysMix: [["TMO", 2], ["ENF", 2], ["DLG", 1]], busMix: [["DOC", 3], ["INV", 2], ["TOL", 2]] },
  // --- Commercial spoke ---
  { queue: "COMM_QUOTE_INGEST", tat: 0.55, key: "CQI", spoke: 3, baseDaily: 25, wt: 300, busRate: 0.07, sysRate: 0.04, weekendFactor: 0.1, keyFmt: (n) => `CQT-${450000 + n}`, sysMix: [["TMO", 2], ["ENF", 2], ["LGN", 1]], busMix: [["DOC", 3], ["INV", 2], ["CNF", 1]] },
  { queue: "COMM_BROKER_RECON", tat: 0.5, key: "BCR", spoke: 3, baseDaily: 30, wt: 240, busRate: 0.05, sysRate: 0.03, weekendFactor: 0.1, keyFmt: (n) => `BCR-${120000 + n}`, sysMix: [["TMO", 3], ["DLG", 1]], busMix: [["TOL", 3], ["DUP", 2], ["INV", 1]] },
  // --- Consumer Lending spoke ---
  { queue: "LEND_APPLICATIONS", tat: 0.62, key: "LAP", spoke: 4, baseDaily: 45, wt: 320, busRate: 0.09, sysRate: 0.04, weekendFactor: 0.15, keyFmt: (n) => `LNA-${3000000 + n}`, sysMix: [["TMO", 3], ["ENF", 2], ["LGN", 1], ["DLG", 1]], busMix: [["DOC", 3], ["CNF", 2], ["INV", 2], ["DUP", 1]] },
  { queue: "LEND_ARREARS_PLANS", tat: 0.52, key: "APL", spoke: 4, baseDaily: 18, wt: 260, busRate: 0.06, sysRate: 0.03, weekendFactor: 0.1, keyFmt: (n) => `ARP-${90000 + n}`, sysMix: [["TMO", 2], ["ENF", 1], ["DLG", 1]], busMix: [["TOL", 2], ["INV", 2], ["CNF", 1]] },
];

// seeded incidents so the trends, watchlist and exception views tell a story
const INCIDENTS = [
  // Citrix outage hits Investment Rebalancing hard for four days
  { queue: "INVEST_REBALANCE", from: Date.UTC(2026, 4, 12), to: Date.UTC(2026, 4, 15), sysX: 6, busX: 1, forceSys: "CTX" },
  // upstream documentation quality dip in Life Underwriting through February 2026
  { queue: "LIFE_UNDERWRITING", from: Date.UTC(2026, 1, 2), to: Date.UTC(2026, 1, 27), sysX: 1, busX: 2.3, forceBus: "DOC" },
  // credential/MFA change causes login failures in New Business the week before "today"
  { queue: "INSURANCE_NEW_BUS", from: Date.UTC(2026, 6, 8), to: Date.UTC(2026, 6, 13), sysX: 3, busX: 1, forceSys: "LGN" },
  // core lending platform slowdown hits Loan Applications for a week in March 2026
  { queue: "LEND_APPLICATIONS", from: Date.UTC(2026, 2, 16), to: Date.UTC(2026, 2, 20), sysX: 4, busX: 1, forceSys: "TMO" },
];

// --- helpers ------------------------------------------------------------------
const fmt = (ts) => {
  const d = new Date(ts);
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};
const csv = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const ITEM_TAGS = ["Source: Broker", "Source: Direct", "Region: North", "Region: South", "Priority-case"];

function reasonFor(q, kind, incident) {
  // ~8% of exceptions carry a legacy unprefixed reason (transitional estate)
  if (!incident && rand() < 0.08) {
    const legal = LEGACY.filter((l) => l.kind === kind);
    return pick(legal).text;
  }
  if (kind === "sys") {
    const code = incident?.forceSys && rand() < 0.75 ? incident.forceSys : pickW(q.sysMix);
    return `System Exception: ${SYS[code]}`;
  }
  const code = incident?.forceBus && rand() < 0.75 ? incident.forceBus : pickW(q.busMix);
  return `Business Exception: ${BUS[code]}`;
}

// --- generate -----------------------------------------------------------------
const rows = [];
const counters = new Map(); // per-queue KeyValue counters

function nextKey(q) {
  const n = (counters.get(q.queue) ?? 0) + 1;
  counters.set(q.queue, n);
  return q.keyFmt(n);
}

/** Emit one work item. Returns the row (already pushed). */
function emitItem({ q, ts, keyValue, attempt, forcedOutcome, incident }) {
  const loaded = ts + (6 * 3600 + Math.floor(rand() * 12 * 3600)) * 1000; // 06:00–18:00
  const vdis = liveVdis(ts, q.spoke);
  const resource = vdis[Math.floor(rand() * vdis.length)].name;
  const wt = Math.max(20, Math.round(q.wt * Math.exp((rand() - 0.5) * 0.9)));
  const waitSec = 5 * 60 + Math.floor(rand() * 4 * 3600);
  const wait = waitSec * 1000;
  const uWait = (waitSec - 5 * 60) / (4 * 3600);

  let outcome = forcedOutcome;
  if (!outcome) {
    let busRate = q.busRate, sysRate = q.sysRate;
    if (incident) { busRate *= incident.busX; sysRate *= incident.sysX; }
    const r = rand();
    outcome = r < sysRate ? "sys" : r < sysRate + busRate ? "bus" : "done";
  }

  const row = {
    ID: guid(),
    KeyValue: keyValue,
    Priority: pickW([[1, 1], [2, 5], [3, 3]]),
    Status: "",
    Tags: rand() < 0.3 ? pick(ITEM_TAGS) : "",
    Resource: resource,
    Attempt: attempt,
    LoadedDate: fmt(loaded),
    LastUpdatedDate: "",
    DeferredDate: "",
    LockedDate: "",
    CompletedDate: "",
    Worktime: wt,
    ExceptionDate: "",
    ExceptionReason: "",
    QueueName: q.queue,
  };

  if (outcome === "done") {
    const done = loaded + wait + wt * 1000;
    row.Status = "Completed";
    row.CompletedDate = fmt(done);
    row.LoadedDate = fmt(done - turnaroundSec(q, uWait, wt) * 1000);
    row.LastUpdatedDate = row.CompletedDate;
  } else if (outcome === "pending") {
    row.Status = "Pending";
    row.LastUpdatedDate = row.LoadedDate;
    row.Worktime = 0;
    if (rand() < 0.25) {
      row.Status = "Deferred";
      row.DeferredDate = fmt(loaded + (1 + Math.floor(rand() * 5)) * DAY);
    }
  } else {
    const kind = outcome; // "sys" | "bus"
    // system faults tend to fail slow (timeouts); business rules fail fast
    const failWt = Math.max(10, Math.round(wt * (kind === "sys" ? 0.7 + rand() * 0.6 : 0.15 + rand() * 0.35)));
    const failed = loaded + wait + failWt * 1000;
    row.Status = "Exception";
    row.Worktime = failWt;
    row.ExceptionDate = fmt(failed);
    row.LoadedDate = fmt(failed - turnaroundSec(q, uWait, failWt) * 1000);
    row.LastUpdatedDate = row.ExceptionDate;
    row.ExceptionReason = reasonFor(q, kind, incident);
  }

  rows.push(row);
  return { row, outcome };
}

for (let d = 0; d <= SPAN; d++) {
  const ts = START + d * DAY;
  const dow = new Date(ts).getUTCDay();
  const isWeekend = dow === 0 || dow === 6;
  const trend = 0.88 + (d / SPAN) * 0.27; // steady growth across the window
  const month = new Date(ts).getUTCMonth();
  const daysToEnd = SPAN - d;

  for (const q of QUEUES) {
    if (!q.keyFmt) continue; // PENSIONS_TRF_FINAL is fed by PTR completions below
    let base = q.baseDaily * trend;
    if (q.key === "IRN" && (month === 2 || month === 3)) base *= 1.45; // renewals season
    const vol = Math.round(base * (isWeekend ? q.weekendFactor : 1) * (0.75 + rand() * 0.5));
    const incident = INCIDENTS.find((i) => i.queue === q.queue && ts >= i.from && ts <= i.to) ?? null;

    for (let i = 0; i < vol; i++) {
      const keyValue = nextKey(q);
      // items loaded in the final two days may still be in flight
      const forcedOutcome = daysToEnd <= 1 && rand() < (daysToEnd === 0 ? 0.35 : 0.08) ? "pending" : null;
      const { row, outcome } = emitItem({ q, ts, keyValue, attempt: 1, forcedOutcome, incident });

      // retries: a system exception is often retried as a NEW item (new ID,
      // same KeyValue, next Attempt), Blue Prism standard retry behaviour
      if (outcome === "sys" && rand() < 0.45) {
        const retry = emitItem({ q, ts: Math.min(ts + (rand() < 0.7 ? 0 : DAY), END), keyValue, attempt: 2, forcedOutcome: rand() < 0.9 ? "done" : "bus", incident: null });
        void retry;
      }

      // Pension Transfers is a two-stage process: a completed Initiation item
      // spawns a Completion-stage item in PENSIONS_TRF_FINAL with the SAME
      // KeyValue (one business case, two queue items)
      if (q.key === "PTR" && row.CompletedDate) {
        const lagDays = 1 + Math.floor(rand() * 3);
        const fts = Math.min(ts + lagDays * DAY, END);
        const ptf = QUEUES.find((x) => x.key === "PTF");
        const stillOpen = ts + lagDays * DAY > END;
        emitItem({ q: ptf, ts: fts, keyValue, attempt: 1, forcedOutcome: stillOpen ? "pending" : null, incident: null });
      }
    }
  }
}

// stable order: by LoadedDate then queue (exports are usually date-ordered)
rows.sort((a, b) => (a.LoadedDate < b.LoadedDate ? -1 : a.LoadedDate > b.LoadedDate ? 1 : a.QueueName < b.QueueName ? -1 : 1));

const HEADER = ["ID", "KeyValue", "Priority", "Status", "Tags", "Resource", "Attempt", "LoadedDate", "LastUpdatedDate", "DeferredDate", "LockedDate", "CompletedDate", "Worktime", "ExceptionDate", "ExceptionReason", "QueueName"];
const lines = [HEADER.join(",")];
for (const r of rows) lines.push(HEADER.map((h) => csv(r[h])).join(","));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n") + "\n", "utf8");

// summary
const byOutcome = { Completed: 0, Exception: 0, Pending: 0 };
for (const r of rows) byOutcome[r.CompletedDate ? "Completed" : r.ExceptionDate ? "Exception" : "Pending"]++;
console.log(`wrote ${OUT}`);
console.log(`rows: ${rows.length} | completed: ${byOutcome.Completed} | exceptions: ${byOutcome.Exception} (${(100 * byOutcome.Exception / rows.length).toFixed(1)}%) | pending: ${byOutcome.Pending}`);
console.log(`window: 2025-01-01 .. 2026-07-14 (${SPAN + 1} days)`);
