// Writes the ia-reference index (targets, finance targets, process catalogue,
// spokes, config) from reference.json as _bulk NDJSON on stdout.
//   node etl/reference-impl/reference-ndjson.mjs [reference.json] > ia-reference.ndjson
// Re-run and re-load whenever reference.json changes (delete the index first
// so removed rows disappear).
import { readFileSync } from "node:fs";
import { referenceDocs } from "./pipeline.mjs";

const path = process.argv[2] ?? new URL("../reference/reference.json", import.meta.url);
const ref = JSON.parse(readFileSync(path, "utf8"));
const today = new Date().toISOString().slice(0, 10);
for (const d of referenceDocs(ref, today)) {
  process.stdout.write(JSON.stringify({ index: { _index: "ia-reference" } }) + "\n" + JSON.stringify(d) + "\n");
}
