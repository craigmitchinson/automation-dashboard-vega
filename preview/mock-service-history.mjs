// ---------------------------------------------------------------------------
// mock-service-history.mjs: runs the real check job (etl/service-job) every
// 15 minutes across the 24 hours before the preview's "now", against the
// mock indices served by mini-es over HTTP, and saves what it wrote as
// mock/ia-service-checks.ndjson. That gives the Service dashboard's history
// panel something to show, and exercises the job end to end: queries,
// previous-state lookup and bulk writes.
//
//   node --max-old-space-size=6000 preview/mock-service-history.mjs
//
// Mock caveat: the data holds each item's final state, so an item that was
// waiting at 02:00 but completed at 09:00 is simply absent at 02:00. Early
// runs therefore understate the backlog a little.
// ---------------------------------------------------------------------------
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadNdjson, search } from "./mini-es.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.parse("2026-07-14T15:00:00Z");
const STEP = 15 * 60000;

const idx = { "ia-service-checks": [] };
for (const n of ["ia-workqueue-items", "ia-cost-daily", "ia-vdi-daily"]) idx[n] = await loadNdjson(join(root, "mock", `${n}.ndjson`));
const ids = new Map();

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      let out;
      if (req.url === "/_bulk") {
        const lines = body.split("\n").filter(Boolean);
        for (let i = 0; i < lines.length; i += 2) {
          const { index } = JSON.parse(lines[i]);
          const doc = JSON.parse(lines[i + 1]);
          const key = `${index._index}|${index._id}`;
          (idx[index._index] ??= []);
          if (ids.has(key)) idx[index._index][ids.get(key)] = doc;
          else ids.set(key, idx[index._index].push(doc) - 1);
        }
        out = { errors: false };
      } else {
        const m = /^\/([^/]+)\/_search$/.exec(req.url);
        if (!m) throw new Error(`unsupported ${req.method} ${req.url}`);
        out = search(idx[m[1].replace(/\*$/, "")] ?? [], JSON.parse(body || "{}"));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: String(e) }));
    }
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;

const run = promisify(execFile);
for (let t = NOW - 24 * 3600000; t <= NOW; t += STEP) {
  await run("python3", [join(root, "etl/service-job/service_checks.py"), "--now", String(t)], { env: { ...process.env, IA_ES_URL: url, IA_KIBANA_URL: "https://kibana.example" } });
  process.stdout.write(".");
}
server.close();

const docs = idx["ia-service-checks"];
const lines = [];
for (const d of docs) lines.push(JSON.stringify({ index: { _index: "ia-service-checks", _id: `${d["@timestamp"]}|${d.check.id}` } }), JSON.stringify(d));
writeFileSync(join(root, "mock", "ia-service-checks.ndjson"), lines.join("\n") + "\n");
const changes = docs.filter((d) => d.changed);
console.log(`\n${docs.length} check documents, ${changes.length} state changes:`);
for (const d of changes) console.log(`  ${d["@timestamp"]}  ${d.check.name}: ${d.previous_state} -> ${d.alert_state}  (${d.headline})`);
