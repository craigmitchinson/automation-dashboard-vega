// The service checks run twice: in Vega on the Service dashboard and in
// etl/service-job/service_checks.py, which raises the alerts. For a spread of
// moments in the mock data (quiet hours, a weekend, each seeded incident) both
// must give the same status, headline, detail and count for every check.
// Needs `npm run mock` and `npm run build`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import * as vega from "vega";
import { loadNdjson, search } from "../preview/mini-es.mjs";
import { toSearch } from "../preview/kibana-context.mjs";

const root = new URL("..", import.meta.url).pathname;
const specFile = join(root, "dist/specs/service/board.vg.json");
const ready = existsSync(join(root, "mock/ia-workqueue-items.ndjson")) && existsSync(specFile);

const MOMENTS = [
  "2026-07-14T15:00:00Z", // the preview's "now": mid-afternoon, end of the data
  "2026-07-14T03:00:00Z", // outside service hours
  "2026-07-12T13:00:00Z", // Sunday
  "2026-07-10T11:00:00Z", // credential change in Insurance New Business
  "2026-05-13T12:00:00Z", // Citrix outage in Investment Rebalancing
  "2026-03-18T10:00:00Z", // lending platform slowdown
  "2026-02-10T16:30:00Z", // documentation quality dip (business exceptions)
];

test("Vega and the check job agree on every check", { skip: !ready && "run npm run mock and npm run build first", timeout: 600000 }, async () => {
  const idx = {};
  for (const n of ["ia-workqueue-items", "ia-cost-daily", "ia-vdi-daily"]) idx[n] = await loadNdjson(join(root, "mock", `${n}.ndjson`));
  const spec = JSON.parse(readFileSync(specFile, "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "svc-"));
  let compared = 0;
  const statuses = new Set();

  for (const iso of MOMENTS) {
    const now = Date.parse(iso);
    const state = { time: { min: now - 24 * 3600000, max: now }, must: [], mustNot: [], filter: [] };
    const resolved = structuredClone(spec);
    const aggs = {};
    for (const d of resolved.data) {
      if (!d.url) continue;
      const { index, body } = toSearch(d.url, state);
      const res = search(idx[index.replace(/\*$/, "")], body);
      d.values = res;
      delete d.url;
      aggs[d.name] = res.aggregations;
    }
    const view = new vega.View(vega.parse(resolved), { renderer: "none" });
    await view.runAsync();
    const fromVega = view.data("checks");

    const file = join(dir, `${now}.json`);
    writeFileSync(file, JSON.stringify(aggs));
    const fromJob = JSON.parse(execFileSync("python3", [join(root, "etl/service-job/service_checks.py"), "--evaluate", file, "--now", String(now)], { encoding: "utf8" }));

    assert.equal(fromJob.length, fromVega.length);
    for (const v of fromVega) {
      const j = fromJob.find((r) => r.id === v.id);
      const at = `${iso} ${v.id}`;
      assert.equal(j.status, v.status, `${at} status`);
      assert.equal(j.headline, v.headline, `${at} headline`);
      assert.equal(j.detail, v.detail, `${at} detail`);
      assert.equal(j.count, v.n, `${at} count`);
      statuses.add(v.status);
      compared++;
    }
  }
  assert.equal(compared, MOMENTS.length * 8);
  // the moments must exercise every state, or the test proves little
  for (const s of ["ok", "warn", "act", "quiet"]) assert.ok(statuses.has(s), `no check reached ${s}`);
});
