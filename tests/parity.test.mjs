// The ETL reference implementation must reproduce the React app's own
// published totals for the deterministic mock data, to the penny, apart from
// one deliberate difference: T13 earns a multi-stage process's benefit once
// per case (split across stages by stageShare). The React app earns the full
// SMV at every stage, so its gross is higher by exactly stageAdjustmentGBP.
// Needs `npm run mock` first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const file = new URL("../mock/totals.json", import.meta.url);

test("mock totals match the React app build", { skip: !existsSync(file) && "run npm run mock first" }, () => {
  const t = JSON.parse(readFileSync(file, "utf8"));
  // From automation-dashboard `npm run data:all` on the same mock CSV.
  assert.equal(t.items, 231660);
  assert.equal(t.completed, 211972);
  assert.equal(t.exceptions, 19413);
  assert.equal(t.business, 11966);
  assert.equal(t.system, 7447);
  assert.equal(t.estateCostGBP, 2354554.1);
  // React: gross 2,880,767.34, net 526,213.24
  // (each side is rounded to the penny separately, so allow a penny either way)
  assert.ok(Math.abs(t.grossBenefitGBP + t.stageAdjustmentGBP - 2880767.34) <= 0.05);
  assert.ok(Math.abs(t.netBenefitGBP + t.stageAdjustmentGBP - 526213.24) <= 0.05);
  assert.equal(t.casesCompleted, 201433);
});
