// ---------------------------------------------------------------------------
// resolve.mjs: runs every Kibana query in every built spec against the mock
// indices (mini-es) under a simulated dashboard state, and writes specs with
// the responses inlined, ready for render.py.
//
//   node --max-old-space-size=6000 preview/resolve.mjs [dashboardId ...]
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadNdjson, search } from "./mini-es.mjs";
import { toSearch } from "./kibana-context.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "dist", "manifest.json"), "utf8"));
const only = process.argv.slice(2);

// "now" pinned to the end of the mock data so previews are reproducible.
const NOW = Date.parse("2026-07-14T23:59:59.999Z");
const DAY = 86400000;
const startOfDay = (t) => Math.floor(t / DAY) * DAY;
const mp = (field, value) => ({ match_phrase: { [field]: value } });

// Named dashboard states the preview can render. Every dashboard renders
// "default"; a dashboard lists extra states in its `states` array.
export const STATES = {
  default: { label: "Last 90 days, no filters", days: 90, must: [] },
  spoke: { label: "Spoke = Commercial", days: 90, must: [mp("spoke.name", "Commercial")] },
  process: { label: "Process = Investment Onboarding", days: 90, must: [mp("process.name", "Investment Onboarding")] },
  fy: { label: "Last 12 months", days: 365, must: [] },
};

const indexFiles = {
  "ia-workqueue-items": "ia-workqueue-items.ndjson",
  "ia-cost-daily": "ia-cost-daily.ndjson",
  "ia-vdi-daily": "ia-vdi-daily.ndjson",
  "ia-reference": "ia-reference.ndjson",
  "ia-service-checks": "ia-service-checks.ndjson",
};
for (const [name, f] of Object.entries(indexFiles)) {
  if (name === "ia-service-checks" && !existsSync(join(root, "mock", f))) { console.warn("mock/ia-service-checks.ndjson missing: run npm run mock:service for the check history"); delete indexFiles[name]; continue; }
  if (!existsSync(join(root, "mock", f))) throw new Error(`mock/${f} missing: run npm run mock first`);
}
const indices = {};
for (const [name, file] of Object.entries(indexFiles)) {
  console.time(`load ${name}`);
  indices[name] = await loadNdjson(join(root, "mock", file));
  console.timeEnd(`load ${name}`);
}
const indexFor = (pattern) => indices[pattern.replace(/\*$/, "")] ?? (pattern.startsWith("ia-service-checks") ? [] : (() => { throw new Error(`unknown index ${pattern}`); })());

const cache = new Map();
function runUrl(url, state) {
  const { index, body } = toSearch(url, state);
  const key = index + JSON.stringify(body);
  if (!cache.has(key)) cache.set(key, search(indexFor(index), body));
  return cache.get(key);
}

const out = [];
for (const entry of manifest) {
  if (only.length && !only.includes(entry.dashboard)) continue;
  const spec = JSON.parse(readFileSync(join(root, entry.file), "utf8"));
  const stateNames = ["default", ...(entry.states ?? [])];
  for (const sn of stateNames) {
    const s = STATES[sn];
    // a dashboard can pin its own "now" (Service is a live, intraday view)
    const pv = sn === "default" ? entry.preview : null;
    const now = pv ? Date.parse(pv.now) : NOW;
    const time = pv ? { min: now - pv.hours * 3600000, max: now } : { min: startOfDay(NOW) - (s.days - 1) * DAY, max: NOW };
    const state = { time, must: s.must, mustNot: [], filter: [] };
    const resolved = structuredClone(spec);
    const t0 = Date.now();
    for (const d of resolved.data ?? []) {
      if (d.url && typeof d.url === "object") {
        d.values = runUrl(d.url, state);
        delete d.url;
      }
    }
    const file = join(root, "preview", "out", "resolved", entry.dashboard, `${entry.panel}.${sn}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(resolved));
    out.push({ ...entry, state: sn, stateLabel: pv?.label ?? s.label, resolved: file });
    console.log(`${entry.dashboard}/${entry.panel} [${sn}] ${Date.now() - t0}ms`);
  }
}
writeFileSync(join(root, "preview", "out", "resolved.json"), JSON.stringify(out, null, 2));
