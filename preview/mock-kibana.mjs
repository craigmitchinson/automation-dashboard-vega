// ---------------------------------------------------------------------------
// mock-kibana.mjs: a copy of the dashboards with the mock data baked into each
// panel, for looking at in Kibana before any index exists. Reads the resolved
// specs from `npm run preview` (default state) and the real import, and writes
//   dist/mock/ia-dashboards-mock.ndjson   nine "IA mock" dashboards, no controls
//   dist/mock/panels/<dashboard>/<panel>.vg.json
// Responses are slimmed (unused bookkeeping fields dropped, numbers rounded)
// and checked to render the same as the full response.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vega from "vega";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "mock");
rmSync(out, { recursive: true, force: true });
for (const f of ["kibanaAddFilter", "kibanaRemoveFilter", "kibanaRemoveAllFilters", "kibanaSetTimeFilter"]) vega.expressionFunction(f, () => null);

const DROP = new Set(["key_as_string", "doc_count_error_upper_bound", "sum_other_doc_count", "took", "timed_out", "relation", "_index", "_id", "_score"]);
const slim = (v) => {
  if (Array.isArray(v)) return v.map(slim);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!DROP.has(k)) o[k] = slim(x);
    return o;
  }
  if (typeof v === "number" && !Number.isInteger(v)) return Number(v.toPrecision(10));
  return v;
};

const svg = async (spec) => {
  const v = new vega.View(vega.parse(spec), { renderer: "none" });
  const s = await v.toSVG();
  v.finalize();
  // clip ids count up across views; rounding moves paths by far less than a pixel
  return s.replace(/clip\d+/g, "clip").replace(/-?\d+\.\d+/g, (n) => (+n).toFixed(2));
};

const mockSpec = {};
const manifest = JSON.parse(readFileSync(join(root, "dist", "manifest.json"), "utf8"));
for (const e of manifest) {
  const resolved = JSON.parse(readFileSync(join(root, "preview", "out", "resolved", e.dashboard, `${e.panel}.default.json`), "utf8"));
  const small = structuredClone(resolved);
  for (const d of small.data ?? []) if (d.values !== undefined) d.values = slim(d.values);
  if ((await svg(resolved)) !== (await svg(small))) throw new Error(`${e.dashboard}/${e.panel}: slimmed data renders differently`);
  small.description = `MOCK DATA, as at 14 July 2026. ${small.description ?? ""}`.trim();
  mockSpec[`ia-${e.dashboard}-${e.panel}`] = small;
  const f = join(out, "panels", e.dashboard, `${e.panel}.vg.json`);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(small) + "\n");
}

const mockId = (id) => id.replace(/^ia-/, "ia-mock-");
const objects = [];
for (const line of readFileSync(join(root, "dist", "kibana", "ia-dashboards.ndjson"), "utf8").split("\n").filter(Boolean)) {
  const o = JSON.parse(line);
  if (o.type === "index-pattern") continue;
  if (o.type === "visualization") {
    const vs = JSON.parse(o.attributes.visState);
    if (o.id === "ia-nav") vs.params.markdown = "**MOCK DATA, as at 14 July 2026** · " + vs.params.markdown.replace(/#\/view\/ia-/g, "#/view/ia-mock-");
    else vs.params.spec = JSON.stringify(mockSpec[o.id] ?? (() => { throw new Error(`no mock for ${o.id}`); })());
    vs.title = o.attributes.title = o.attributes.title.replace(/^IA · /, "IA mock · ");
    o.attributes.visState = JSON.stringify(vs);
  } else if (o.type === "dashboard") {
    o.attributes.title = o.attributes.title.replace(/^IA · /, "IA mock · ");
    o.attributes.timeFrom = "2026-04-16T00:00:00.000Z";
    o.attributes.timeTo = "2026-07-14T23:59:59.999Z";
    delete o.attributes.controlGroupInput;
  }
  o.id = mockId(o.id);
  o.references = (o.references ?? []).filter((r) => r.type !== "index-pattern").map((r) => ({ ...r, id: mockId(r.id) }));
  objects.push(o);
}
writeFileSync(join(out, "ia-dashboards-mock.ndjson"), objects.map((o) => JSON.stringify(o)).join("\n") + "\n");
console.log(`mock: ${objects.length} saved objects, ${Object.keys(mockSpec).length} panels`);
