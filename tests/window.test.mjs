// The window is whole UTC days, from the picker's start day to its end, on every
// panel. Kibana's "Last 90 days" starts mid-day, and "now-89d/d" starts at local
// midnight (23:00 UTC in British Summer Time), so whatever the start, the
// "Where the work went" sankey must equal the Work in & out KPI tiles: completed,
// business, system exceptions and waiting at the period end, on the same days.
// Needs `npm run mock` and `npm run build`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as vega from "vega";
import { loadNdjson, search } from "../render/mini-es.mjs";
import { toSearch } from "../render/kibana-context.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const kpisFile = join(root, "dist/specs/work-flow/kpis.vg.json");
const flowFile = join(root, "dist/specs/work-flow/flow.vg.json");
const mastFile = join(root, "dist/specs/work-flow/masthead.vg.json");
const ready = existsSync(join(root, "mock/ia-workqueue-items.ndjson")) && existsSync(kpisFile) && existsSync(flowFile);

for (const fn of ["kibanaAddFilter", "kibanaRemoveFilter", "kibanaRemoveAllFilters", "kibanaSetTimeFilter"]) vega.expressionFunction(fn, () => true);

async function evaluate(file, idx, time, clauses = {}) {
  const state = { time, must: [], mustNot: [], filter: [], ...clauses };
  const spec = JSON.parse(readFileSync(file, "utf8"));
  for (const d of spec.data ?? []) {
    if (!d.url || typeof d.url !== "object") continue;
    const { index, body } = toSearch(d.url, state);
    d.values = search(idx[index.replace(/\*$/, "")], body);
    delete d.url;
  }
  const view = new vega.View(vega.parse(spec), { renderer: "none" });
  view.width(900).height(500);
  await view.runAsync();
  return view;
}

const END = Date.parse("2026-07-14T23:59:59.999Z");
const mp = (field, value) => ({ match_phrase: { [field]: value } });

// Evaluates the KPI tiles, the sankey and the masthead for one state, asserts the sankey
// equals the tiles, and returns the figures.
async function check(label, idx, time, clauses) {
  const k = await evaluate(kpisFile, idx, time, clauses);
  const f = await evaluate(flowFile, idx, time, clauses);
  const m = await evaluate(mastFile, idx, time, clauses);
  const tot = k.data("tot")[0];
  const sk = f.data("fl_tot")[0];
  assert.equal(sk.c, tot.cur_c, `${label}: sankey Completed = KPI completed`);
  assert.equal(sk.b, tot.cur_b, `${label}: sankey Business = KPI business`);
  assert.equal(sk.s, tot.cur_s, `${label}: sankey System = KPI system`);
  assert.equal(sk.p, k.signal("bEnd"), `${label}: sankey Still waiting = KPI waiting at period end`);
  assert.equal(m.signal("mhDays"), k.signal("ndays"), `${label}: masthead days = KPI days`);
  assert.equal(m.signal("mhLo"), k.signal("lo"), `${label}: masthead first day = KPI first day`);
  return { figures: [sk.c, sk.b, sk.s, sk.p], days: k.signal("ndays"), lo: k.signal("lo"), procs: f.data("fl").map((r) => r.proc) };
}

test("sankey outcomes equal the KPI tiles whatever the picker start", { skip: !ready && "run npm run mock and npm run build first", timeout: 900000 }, async () => {
  const idx = {};
  for (const n of ["ia-workqueue-items", "ia-cost-daily", "ia-vdi-daily", "ia-reference"]) idx[n] = await loadNdjson(join(root, "mock", `${n}.ndjson`));
  const at = (iso) => ({ min: Date.parse(iso), max: END });
  const day = await check("day start", idx, at("2026-04-16T00:00:00Z"));
  const mid = await check("mid-day start", idx, at("2026-04-16T13:30:00Z"));
  const bst = await check("BST midnight start", idx, at("2026-04-15T23:00:00Z"));
  assert.equal(day.days, 90);
  // a mid-day start counts its whole day; a start within an hour before midnight counts from that midnight
  assert.deepEqual(mid.figures, day.figures);
  assert.deepEqual(bst.figures, day.figures);
  assert.equal(mid.days, day.days);
  assert.equal(bst.days, day.days);
  assert.equal(bst.lo, day.lo);

  // dashboard filter and must_not clauses reach both panels alike
  const clauses = { filter: [mp("spoke.name", "Consumer Lending")], mustNot: [mp("process.name", "Loan Application Processing")] };
  const filtered = await check("filtered", idx, at("2026-04-15T23:00:00Z"), clauses);
  assert.ok(filtered.figures[0] < day.figures[0], "filters reduce completed");
  assert.ok(filtered.procs.length > 0 && !filtered.procs.includes("Loan Application Processing") && !filtered.procs.includes("Pension Transfers"), "must_not and filter apply to the sankey");

  // a mid-day picker end
  const early = await check("mid-day end", idx, { min: Date.parse("2026-04-16T13:30:00Z"), max: Date.parse("2026-07-14T14:00:00Z") });
  assert.ok(early.figures[0] < day.figures[0], "an earlier end counts fewer items");
});

// FTE is shown as onshore + offshore, each on its own location's working assumptions.
test("Value & Finance FTE tile is onshore plus offshore", { skip: !ready && "run npm run mock and npm run build first", timeout: 900000 }, async () => {
  const file = join(root, "dist/specs/value-finance/kpis.vg.json");
  const idx = {};
  for (const n of ["ia-workqueue-items", "ia-cost-daily", "ia-vdi-daily", "ia-reference"]) idx[n] = await loadNdjson(join(root, "mock", `${n}.ndjson`));
  const v = await evaluate(file, idx, { min: Date.parse("2026-04-16T00:00:00Z"), max: END });
  const tot = v.data("tot")[0];
  assert.ok(tot.cur_hOff > 0 && tot.cur_hOn > 0, "the mock has both locations");
  assert.ok(Math.abs(tot.cur_h - (tot.cur_hOn + tot.cur_hOff)) < 1e-6, "hours = onshore + offshore");
  const days = v.signal("ndays");
  const [wd, ph, wdo, pho] = ["wd", "ph", "wdo", "pho"].map((n) => v.signal(n));
  assert.ok(wdo !== wd || pho !== ph, "the demo's offshore assumptions differ");
  const expected = tot.cur_hOn / (days * (wd / 365.25) * ph) + tot.cur_hOff / (days * (wdo / 365.25) * pho);
  const tile = v.data("tiles").find((t) => t.label === "FTE released");
  assert.equal(tile.value, expected.toFixed(1));
  assert.match(tile.sub, /onshore · .* offshore/);
});
