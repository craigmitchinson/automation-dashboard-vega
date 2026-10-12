// Prints the JS reference implementation's documents for the first N CSV rows.
import { readFileSync } from "node:fs";
import { makeLookups, enrichItem } from "../etl/reference-impl/pipeline.mjs";
const ref = JSON.parse(readFileSync(new URL("../etl/reference/reference.json", import.meta.url), "utf8"));
const lk = makeLookups(ref);
const [, , file, limit = "5000"] = process.argv;
const lines = readFileSync(file, "utf8").split("\n");
const header = lines[0].split(",");
// the mock CSV has quoted reasons containing commas, so use a tiny parser
const parse = (l) => { const out = []; let f = "", q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ",") { out.push(f); f = ""; } else f += c; } out.push(f); return out; };
for (let i = 1; i <= Number(limit) && i < lines.length; i++) {
  if (!lines[i]) continue;
  const v = parse(lines[i]);
  const doc = enrichItem(Object.fromEntries(header.map((h, j) => [h, v[j] ?? ""])), ref, lk);
  if (doc) console.log(JSON.stringify(doc));
}
