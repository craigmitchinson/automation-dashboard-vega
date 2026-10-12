// Every panel must render, not error, on a fresh install: indices created by
// devtools-setup.txt but empty, only ia-reference loaded. Also with the
// reference index empty too.
import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vega from "vega";
import { loadNdjson, search } from "../preview/mini-es.mjs";
import { toSearch } from "../preview/kibana-context.mjs";

for (const f of ["kibanaAddFilter", "kibanaRemoveFilter", "kibanaRemoveAllFilters", "kibanaSetTimeFilter"]) vega.expressionFunction(f, () => null);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "dist", "manifest.json"), "utf8"));
const ref = await loadNdjson(join(root, "dist", "elasticsearch", "ia-reference.ndjson"));
const NOW = Date.now();
const state = { time: { min: NOW - 90 * 86400000, max: NOW }, must: [], mustNot: [], filter: [] };

for (const [label, refDocs] of [["reference loaded", ref], ["nothing loaded", []]]) {
  test(`every panel renders on empty indices (${label})`, async () => {
    const bad = [];
    for (const e of manifest) {
      const spec = JSON.parse(readFileSync(join(root, e.file), "utf8"));
      for (const d of spec.data ?? []) {
        if (!d.url || typeof d.url !== "object") continue;
        const { index, body } = toSearch(d.url, state);
        d.values = search(index.startsWith("ia-reference") ? refDocs : [], body);
        delete d.url;
      }
      try {
        const v = new vega.View(vega.parse(spec), { renderer: "none" });
        await v.runAsync();
        v.finalize();
      } catch (err) {
        bad.push(`${e.dashboard}/${e.panel}: ${err.message}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });
}
