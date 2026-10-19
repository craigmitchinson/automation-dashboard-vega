// Writes a copy of the demo reference.json with offshore grade rates and FTE
// assumptions, so the Ruby and JS enrich runs can be compared on location
// pricing (npm run test:etl).  node tests/make_offshore_reference.mjs out.json
import { readFileSync, writeFileSync } from "node:fs";
const ref = JSON.parse(readFileSync(new URL("../etl/reference/reference.json", import.meta.url), "utf8"));
const rows = [];
for (const g of ref.gradeRates) {
  rows.push(g);
  // an offshore card for some grades only (the rest fall back to the location-less row),
  // dated differently from the onshore rows, plus one spoke-specific offshore row
  if (["OPS3", "PSPC", "RANL"].includes(g.grade)) rows.push({ ...g, location: "Offshore", effectiveFrom: g.effectiveFrom, hourlyCostGBP: Math.round(g.hourlyCostGBP * 0.4 * 100) / 100 });
}
rows.push({ grade: "LOPS", gradeName: "Lending Ops", location: "Offshore", effectiveFrom: "2025-09-01", hourlyCostGBP: 11.5 });
rows.push({ grade: "LOPS", gradeName: "Lending Ops", location: "Offshore", spokeId: "4", effectiveFrom: "2025-09-01", hourlyCostGBP: 12.25 });
rows.push({ grade: "OPS3", gradeName: "Ops Grade 3", location: "Onshore", effectiveFrom: "2026-01-01", hourlyCostGBP: 30.5 });
ref.gradeRates = rows;
writeFileSync(process.argv[2], JSON.stringify(ref));
