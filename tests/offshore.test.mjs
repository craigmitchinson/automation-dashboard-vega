// T17: the onshore/offshore split. Totals must equal onshore + offshore on
// every item, a location falls back to the location-less row, and the
// offshore share moves work (not the total) between the two locations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { gradeRate, estateAssumptions } from "../etl/reference-impl/economics.mjs";
import { makeLookups, enrichItem, costDay, referenceDocs } from "../etl/reference-impl/pipeline.mjs";

const demo = JSON.parse(readFileSync(new URL("../etl/reference/reference.json", import.meta.url), "utf8"));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9, `${msg}: ${a} vs ${b}`);

test("gradeRate: location row first, else the location-less row, spoke before universal within a tier", () => {
  const ref = {
    gradeRates: [
      { grade: "G", effectiveFrom: "2024-01-01", hourlyCostGBP: 30 },
      { grade: "G", effectiveFrom: "2025-01-01", hourlyCostGBP: 32 },
      { grade: "G", location: "Offshore", effectiveFrom: "2024-06-01", hourlyCostGBP: 10 },
      { grade: "G", location: "Offshore", spokeId: "2", effectiveFrom: "2024-06-01", hourlyCostGBP: 12 },
      { grade: "G", location: "Onshore", effectiveFrom: "2025-06-01", hourlyCostGBP: 35 },
    ],
  };
  assert.equal(gradeRate(ref, "G", 1, "2024-03-01"), 30);
  assert.equal(gradeRate(ref, "G", 1, "2024-03-01", "Offshore"), 30, "no offshore row yet: location-less");
  assert.equal(gradeRate(ref, "G", 1, "2024-07-01", "Offshore"), 10);
  assert.equal(gradeRate(ref, "G", 2, "2024-07-01", "Offshore"), 12, "spoke row beats universal");
  assert.equal(gradeRate(ref, "G", 1, "2025-03-01", "Offshore"), 10, "an offshore row beats a later location-less row");
  assert.equal(gradeRate(ref, "G", 1, "2025-03-01"), 32);
  assert.equal(gradeRate(ref, "G", 1, "2025-07-01"), 35, "onshore row in force");
  assert.equal(gradeRate(ref, "G", 1, "2025-07-01", "Offshore"), 10, "offshore rows never price onshore work or the reverse");
  assert.equal(gradeRate(ref, "X", 1, "2025-07-01", "Offshore"), 0);
});

test("estateAssumptions: offshore falls back to the location-less row", () => {
  const ref = { estateCostHistory: [{ effectiveFrom: "2023-01-01", workingDaysPerYear: 252, productiveHoursPerDay: 7.5 }, { effectiveFrom: "2024-01-01", location: "Offshore", workingDaysPerYear: 260, productiveHoursPerDay: 8 }] };
  assert.deepEqual(estateAssumptions(ref, "2023-06-01", "Offshore"), { workingDaysPerYear: 252, productiveHoursPerDay: 7.5 });
  assert.deepEqual(estateAssumptions(ref, "2024-06-01", "Offshore"), { workingDaysPerYear: 260, productiveHoursPerDay: 8 });
  assert.deepEqual(estateAssumptions(ref, "2024-06-01"), { workingDaysPerYear: 252, productiveHoursPerDay: 7.5 });
  assert.deepEqual(estateAssumptions({ estateCostHistory: [] }, "2024-06-01", "Offshore"), { workingDaysPerYear: 252, productiveHoursPerDay: 7.5 });
});

function row(queue, extra = {}) {
  return { ID: "1", QueueName: queue, Resource: "", LoadedDate: "2025-10-01 09:00:00", CompletedDate: "2025-10-01 09:10:00", Worktime: "60", ...extra };
}

test("enrichItem: parts add to the totals and are priced at their own location rate", () => {
  const ref = structuredClone(demo);
  ref.gradeRates.push({ grade: "OPS3", location: "Offshore", effectiveFrom: "2023-01-01", hourlyCostGBP: 10 });
  const lk = makeLookups(ref);
  const done = enrichItem(row("INSURANCE_NEW_BUS"), ref, lk).value; // process 101: SMV 18, OPS3, share 0.4
  near(done.hours_saved, 0.3, "hours");
  near(done.hours_saved_onshore, 0.18, "onshore hours");
  near(done.hours_saved_offshore, 0.12, "offshore hours");
  assert.equal(done.hourly_rate_offshore_gbp, 10);
  near(done.benefit_onshore_gbp, (18 * 0.6 * done.hourly_rate_gbp) / 60, "onshore benefit");
  near(done.benefit_offshore_gbp, (18 * 0.4 * 10) / 60, "offshore benefit");
  near(done.benefit_gbp, done.benefit_onshore_gbp + done.benefit_offshore_gbp, "benefit total");
  const exc = enrichItem(row("INSURANCE_NEW_BUS", { CompletedDate: "", ExceptionDate: "2025-10-01 09:10:00", ExceptionReason: "x" }), ref, lk).value;
  near(exc.rework_hours, exc.rework_hours_onshore + exc.rework_hours_offshore, "rework hours");
  near(exc.rework_gbp, exc.rework_onshore_gbp + exc.rework_offshore_gbp, "rework gbp");
  near(exc.rework_hours_offshore, 18 * 0.4 / 60, "offshore rework hours");
  assert.equal(exc.hours_saved_offshore, 0);
  const pending = enrichItem(row("INSURANCE_NEW_BUS", { CompletedDate: "" }), ref, lk).value;
  assert.equal(pending.benefit_offshore_gbp + pending.rework_offshore_gbp + pending.hours_saved_offshore + pending.rework_hours_offshore, 0);
});

test("no offshoreShare means everything is onshore; share 1 means everything is offshore", () => {
  const lk = makeLookups(demo);
  const onshore = enrichItem(row("INSURANCE_RENEWALS"), demo, lk).value; // process 102, no share
  assert.equal(onshore.hours_saved_offshore, 0);
  assert.equal(onshore.benefit_offshore_gbp, 0);
  assert.equal(onshore.hours_saved_onshore, onshore.hours_saved);
  assert.equal(onshore.benefit_onshore_gbp, onshore.benefit_gbp);
  const off = enrichItem(row("COMM_BROKER_RECON"), demo, lk).value; // process 302, share 1
  assert.equal(off.hours_saved_onshore, 0);
  assert.equal(off.benefit_onshore_gbp, 0);
  assert.equal(off.benefit_offshore_gbp, off.benefit_gbp);
});

test("every mock item: totals equal onshore + offshore", { skip: !existsSync(new URL("../mock/ia-workqueue-items.ndjson", import.meta.url)) && "run npm run mock first" }, () => {
  const lines = readFileSync(new URL("../mock/ia-workqueue-items.ndjson", import.meta.url), "utf8").split("\n");
  let n = 0, offshore = 0;
  for (let i = 1; i < lines.length; i += 2) {
    if (!lines[i]) continue;
    const v = JSON.parse(lines[i]).value;
    n++;
    if (v.hours_saved_offshore + v.rework_hours_offshore > 0) offshore++;
    near(v.hours_saved, v.hours_saved_onshore + v.hours_saved_offshore, "hours_saved");
    near(v.benefit_gbp, v.benefit_onshore_gbp + v.benefit_offshore_gbp, "benefit_gbp");
    near(v.rework_hours, v.rework_hours_onshore + v.rework_hours_offshore, "rework_hours");
    near(v.rework_gbp, v.rework_onshore_gbp + v.rework_offshore_gbp, "rework_gbp");
  }
  assert.ok(n > 1000 && offshore > 0 && offshore < n, "the mock has both locations");
});

test("costDay and the process catalogue carry the offshore assumptions", () => {
  const out = costDay(demo, "2025-10-01", []);
  const hub = out.costDaily[0];
  assert.equal(hub.working_days_per_year, 252);
  assert.equal(hub.working_days_per_year_offshore, 260);
  assert.equal(hub.productive_hours_per_day_offshore, 8);
  const proc = referenceDocs(demo, "2026-07-14").find((d) => d.doc_type === "process" && d.process.id === "101").process;
  assert.equal(proc.offshore_share, 0.4);
  assert.equal(typeof proc.current_rate_offshore_gbp, "number");
});
