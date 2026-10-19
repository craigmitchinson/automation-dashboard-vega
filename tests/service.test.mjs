// The nine service checks, evaluated by the Service dashboard's Vega spec
// against the mock indices at a spread of moments (quiet hours, a weekend,
// each seeded incident). Each check must give the expected status, and the
// five that raise Kibana alerts must have a rule in the import file.
// Needs `npm run mock` and `npm run build`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as vega from "vega";
import { loadNdjson, search } from "../render/mini-es.mjs";
import { toSearch } from "../render/kibana-context.mjs";
import { CHECKS } from "../vega/lib/service.mjs";
import { RULES } from "../vega/alert-rules.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const specFile = join(root, "dist/specs/service/board.vg.json");
const ready = existsSync(join(root, "mock/ia-workqueue-items.ndjson")) && existsSync(specFile);

// order: freshness, cost_pipeline, unmapped, sla, locks, workers, processes, sys_spike, new_reasons
const IDS = CHECKS.map((c) => c.id);
const MOMENTS = [
  ["2026-07-14T15:00:00Z", "the preview's now: mid-afternoon, end of the data; one unmapped queue and one stuck lock added", ["ok", "ok", "warn", "act", "act", "ok", "ok", "warn", "ok"]],
  ["2026-07-14T03:00:00Z", "outside service hours", ["quiet", "ok", "ok", "act", "ok", "ok", "ok", "warn", "ok"]],
  ["2026-07-12T13:00:00Z", "Sunday", ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"]],
  ["2026-07-10T11:00:00Z", "credential change in Insurance New Business", ["ok", "ok", "ok", "ok", "ok", "act", "ok", "warn", "ok"]],
  ["2026-05-13T12:00:00Z", "Citrix outage in Investment Rebalancing", ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "act", "ok"]],
  ["2026-03-18T10:00:00Z", "lending platform slowdown", ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "warn", "ok"]],
  ["2026-02-10T16:30:00Z", "documentation quality dip (business exceptions)", ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"]],
  ["2026-07-18T12:00:00Z", "four days after the last data: nothing arriving, cost four days behind", ["act", "act", "ok", "act", "act", "act", "act", "ok", "ok"]],
];

test("Vega evaluates the nine checks at the seeded moments", { skip: !ready && "run npm run mock and npm run build first", timeout: 600000 }, async () => {
  const idx = {};
  for (const n of ["ia-workqueue-items", "ia-cost-daily", "ia-vdi-daily"]) idx[n] = await loadNdjson(join(root, "mock", `${n}.ndjson`));
  // a queue that went live without a reference row (the mock has none)
  for (let i = 0; i < 4; i++) {
    const t = `2026-07-14T1${i}:20:00.000Z`;
    idx["ia-workqueue-items"].push({ "@timestamp": t, mapped: false, outcome: "Completed", queue: { name: "NEW_QUEUE_NOT_IN_REFERENCE" }, item: { last_updated_at: t }, n: { completed: 1, attempt: 1, pending: 0 } });
  }
  // an item whose session died holding the lock (the mock has no pending item locked for long)
  idx["ia-workqueue-items"].push({ "@timestamp": "2026-07-14T10:00:00.000Z", mapped: true, outcome: "Pending", queue: { name: "STUCK_LOCK_QUEUE" }, process: { name: "Stuck Lock Process" }, spoke: { name: "Commercial" }, item: { last_updated_at: "2026-07-14T12:00:00.000Z", loaded_at: "2026-07-14T10:00:00.000Z", locked_at: "2026-07-14T12:00:00.000Z" }, n: { pending: 1, attempt: 0 } });
  const spec = JSON.parse(readFileSync(specFile, "utf8"));
  const statuses = new Set();

  for (const [iso, why, expected] of MOMENTS) {
    const now = Date.parse(iso);
    const state = { time: { min: now - 24 * 3600000, max: now }, must: [], mustNot: [], filter: [] };
    const resolved = structuredClone(spec);
    for (const d of resolved.data) {
      if (!d.url) continue;
      const { index, body } = toSearch(d.url, state);
      d.values = search(idx[index.replace(/\*$/, "")], body);
      delete d.url;
    }
    const view = new vega.View(vega.parse(resolved), { renderer: "none" });
    await view.runAsync();
    const got = view.data("checks");
    assert.deepEqual(got.map((c) => c.id), IDS);
    assert.deepEqual(got.map((c) => c.status), expected, `${iso} (${why})`);
    got.forEach((c) => statuses.add(c.status));
    if (iso === MOMENTS[0][0]) {
      const by = Object.fromEntries(got.map((c) => [c.id, c]));
      assert.equal(by.unmapped.headline, "1 unmapped queue, 4 items in 24h");
      assert.equal(by.cost_pipeline.headline, "Costed to today");
      assert.match(by.locks.headline, /^1 locked over 60 min$/);
    }
  }
  for (const s of ["ok", "warn", "act", "quiet"]) assert.ok(statuses.has(s), `no check reached ${s}`);
});

test("the five alerting checks each have a rule and the other four do not", () => {
  const alerting = CHECKS.filter((c) => c.alert).map((c) => c.id);
  assert.deepEqual(RULES.map((r) => r.check), alerting);
  assert.deepEqual(CHECKS.filter((c) => !c.alert).map((c) => c.id), ["workers", "processes", "sys_spike", "new_reasons"]);
});

test("the import file carries the five rules, disabled and without actions", { skip: !ready && "run npm run build first" }, () => {
  const objs = readFileSync(join(root, "dist/kibana/ia-dashboards.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((o) => o.type === "alert");
  assert.equal(objs.length, 5);
  for (const o of objs) {
    assert.match(o.attributes.name, /^IA · /);
    assert.equal(o.attributes.alertTypeId, ".es-query");
    assert.equal(o.attributes.enabled, false);
    assert.deepEqual(o.attributes.actions, []);
    assert.doesNotThrow(() => JSON.parse(o.attributes.params.esQuery));
  }
});
