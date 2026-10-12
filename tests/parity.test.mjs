// The ETL reference implementation must reproduce the React app's own
// published totals for the deterministic mock data, to the penny.
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
  assert.equal(t.grossBenefitGBP, 2880767.34);
  assert.equal(t.estateCostGBP, 2354554.1);
  assert.equal(t.netBenefitGBP, 526213.24);
});
