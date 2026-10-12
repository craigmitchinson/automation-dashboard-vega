// Every built spec must be valid Vega that parses, with unique dataset names
// and no Elasticsearch body that Kibana would reject.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as vega from "vega";

const manifest = JSON.parse(readFileSync(new URL("../dist/manifest.json", import.meta.url), "utf8"));
for (const fn of ["kibanaAddFilter", "kibanaRemoveFilter", "kibanaRemoveAllFilters", "kibanaSetTimeFilter"]) vega.expressionFunction(fn, () => true);

for (const m of manifest) {
  test(`${m.dashboard}/${m.panel}`, () => {
    const spec = JSON.parse(readFileSync(new URL(`../${m.file}`, import.meta.url), "utf8"));
    const names = (spec.data ?? []).map((d) => d.name);
    assert.equal(new Set(names).size, names.length, "duplicate dataset names");
    for (const d of spec.data ?? []) {
      if (!d.url) continue;
      assert.ok(d.url.index, `${d.name}: Kibana url needs an index`);
      if (d.url["%context%"]) assert.ok(!d.url.body?.query, `${d.name}: %context% cannot be combined with body.query`);
    }
    // parse with inline empty data so the ES urls are not fetched
    const s = structuredClone(spec);
    for (const d of s.data ?? []) if (d.url) { delete d.url; d.values = {}; }
    assert.doesNotThrow(() => vega.parse(s));
  });
}
