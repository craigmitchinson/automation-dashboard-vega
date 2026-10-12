// ---------------------------------------------------------------------------
// build-mock.mjs: turns a Blue Prism work-queue CSV (the mock one by default)
// into the four Elasticsearch indices the dashboards read, as _bulk NDJSON.
//
//   node etl/reference-impl/build-mock.mjs [path/to/BPAWorkQueueItem.csv]
//
// Output (mock/, git-ignored):
//   ia-workqueue-items.ndjson   ia-cost-daily.ndjson
//   ia-vdi-daily.ndjson         ia-reference.ndjson
//
// Load into a dev cluster with, per file:
//   curl -s -H 'Content-Type: application/x-ndjson' -XPOST "$ES/_bulk" --data-binary @mock/<file>
// (create the index templates in etl/index-templates/ first).
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { makeLookups, enrichItem, costDay, referenceDocs } from "./pipeline.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ref = JSON.parse(readFileSync(join(root, "etl", "reference", "reference.json"), "utf8"));
const csvPath = process.argv[2] ?? join(root, "mock", "BPAWorkQueueItem.csv");
if (!existsSync(csvPath)) {
  console.log("no CSV yet, generating the deterministic mock first");
  execFileSync(process.execPath, [join(root, "etl", "reference-impl", "generate-mock-csv.mjs")], { stdio: "inherit" });
}

function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = parseCsv(readFileSync(csvPath, "utf8"));
const header = raw[0].map((h) => h.trim());
const lk = makeLookups(ref);
const items = [];
for (let i = 1; i < raw.length; i++) {
  const row = Object.fromEntries(header.map((h, j) => [h, raw[i][j] ?? ""]));
  const doc = enrichItem(row, ref, lk);
  if (doc) items.push(doc);
}

// Stage 2, one day at a time, across every calendar day in the data window.
const byDate = new Map();
for (const it of items) {
  if (!byDate.has(it.outcome_date)) byDate.set(it.outcome_date, []);
  byDate.get(it.outcome_date).push(it);
}
const dates = [...byDate.keys()].sort();
const costDaily = [], vdiDaily = [];
for (let ts = Date.parse(dates[0] + "T00:00:00Z"); ts <= Date.parse(dates.at(-1) + "T00:00:00Z"); ts += 86400000) {
  const d = new Date(ts).toISOString().slice(0, 10);
  const out = costDay(ref, d, byDate.get(d) ?? []);
  costDaily.push(...out.costDaily);
  vdiDaily.push(...out.vdiDaily);
}

mkdirSync(join(root, "mock"), { recursive: true });
const bulk = (index, docs, idOf) => docs.map((d) => JSON.stringify({ index: { _index: index, ...(idOf ? { _id: idOf(d) } : {}) } }) + "\n" + JSON.stringify(d)).join("\n") + "\n";
writeFileSync(join(root, "mock", "ia-workqueue-items.ndjson"), bulk("ia-workqueue-items", items, (d) => d.item.id));
writeFileSync(join(root, "mock", "ia-cost-daily.ndjson"), bulk("ia-cost-daily", costDaily, (d) => `${d.date}|${d.pool}`));
writeFileSync(join(root, "mock", "ia-vdi-daily.ndjson"), bulk("ia-vdi-daily", vdiDaily, (d) => `${d.date}|${d.resource.name}`));
writeFileSync(join(root, "mock", "ia-reference.ndjson"), bulk("ia-reference", referenceDocs(ref, dates.at(-1))));

// Headline totals, comparable with the React app's own build output.
const mapped = items.filter((i) => i.mapped);
const sum = (f) => mapped.reduce((s, i) => s + f(i), 0);
const totals = {
  items: items.length,
  window: [dates[0], dates.at(-1)],
  completed: sum((i) => i.n.completed),
  exceptions: sum((i) => i.n.exception),
  business: sum((i) => i.n.business),
  system: sum((i) => i.n.system),
  grossBenefitGBP: Number(sum((i) => i.value.benefit_gbp).toFixed(2)),
  estateCostGBP: Number(sum((i) => i.cost.estate_gbp).toFixed(2)),
};
totals.netBenefitGBP = Number((totals.grossBenefitGBP - totals.estateCostGBP).toFixed(2));
// What the React app also counts: benefit on completed items at a non-final
// stage of a multi-stage process (T13 stops that double count).
totals.earlierStageBenefitGBP = Number(sum((i) => (i.n.completed && !i.n.case_done && i.mapped ? (i.process.smv_minutes * i.value.hourly_rate_gbp) / 60 : 0)).toFixed(2));
totals.casesCompleted = sum((i) => i.n.case_done);
writeFileSync(join(root, "mock", "totals.json"), JSON.stringify(totals, null, 2));
console.log(JSON.stringify(totals));
