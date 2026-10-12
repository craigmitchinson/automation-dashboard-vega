"""install.py: set up the IA dashboards on an Elastic 8 cluster, step by step.

Every step is safe to re-run. Standard library only (Python 3.9+).

    export IA_ES_URL=https://es.example:9200     IA_ES_API_KEY=...
    export IA_KIBANA_URL=https://kibana.example  IA_KIBANA_API_KEY=...

    python3 setup/install.py check            # can we reach both, and which version is Kibana?
    python3 setup/install.py templates        # the five index templates
    python3 setup/install.py reference        # (re)load ia-reference from dist/elasticsearch
    python3 setup/install.py dashboards       # import dist/kibana/ia-dashboards.ndjson
    python3 setup/install.py mock             # OPTIONAL: load the mock data (npm run mock first)
    python3 setup/install.py verify           # counts and fields the dashboards rely on
    python3 setup/install.py all              # check, templates, reference, dashboards, verify

API keys: ES needs manage_index_templates plus write on ia-reference (and the
mock indices, if used); Kibana needs saved-object write in the target space.
Set IA_KIBANA_SPACE to import into a space other than the default.
"""
import base64
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEMPLATES = ["ia-workqueue-items", "ia-cost-daily", "ia-vdi-daily", "ia-reference", "ia-service-checks"]


def env(name):
    """IA_ES_URL (the name the jobs use) or plain ES_URL."""
    return os.environ.get(f"IA_{name}", os.environ.get(name))


def _auth(prefix):
    key = env(f"{prefix}_API_KEY")
    if key:
        return {"Authorization": f"ApiKey {key}"}
    user, pw = env(f"{prefix}_USER"), env(f"{prefix}_PASSWORD")
    if user:
        return {"Authorization": "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode()}
    return {}


def call(prefix, method, path, body=None, ctype="application/json", raw=False):
    base = env(f"{prefix}_URL")
    if not base:
        sys.exit(f"Set IA_{prefix}_URL (and IA_{prefix}_API_KEY, or IA_{prefix}_USER and IA_{prefix}_PASSWORD).")
    if prefix == "KIBANA" and env("KIBANA_SPACE"):
        path = f"/s/{env('KIBANA_SPACE')}{path}"
    headers = {**_auth(prefix), "Content-Type": ctype}
    if prefix == "KIBANA":
        headers["kbn-xsrf"] = "true"
    data = body if isinstance(body, (bytes, type(None))) else (body if isinstance(body, str) else json.dumps(body)).encode()
    req = urllib.request.Request(base.rstrip("/") + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            out = r.read()
            return out if raw else (json.loads(out) if out else {})
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "_body": e.read().decode(errors="replace")[:2000]}


def ok(msg):
    print(f"  ok    {msg}")


def fail(msg):
    print(f"  FAIL  {msg}")


def check():
    print("check")
    es = call("ES", "GET", "/")
    if "_error" in es:
        fail(f"Elasticsearch: {es}")
    else:
        ok(f"Elasticsearch {es['version']['number']} ({es.get('cluster_name')})")
    lic = call("ES", "GET", "/_license")
    if "_error" not in lic:
        ok(f"licence: {lic['license']['type']}")
    kb = call("KIBANA", "GET", "/api/status")
    if "_error" in kb:
        fail(f"Kibana: {kb}")
        return
    ver = kb["version"]["number"]
    ok(f"Kibana {ver}")
    built = json.loads((ROOT / "dist" / "kibana" / "ia-dashboards.ndjson").read_text().splitlines()[0]).get("coreMigrationVersion")
    if built and tuple(map(int, built.split("."))) > tuple(map(int, ver.split("-")[0].split("."))):
        fail(f"dist/ was built for Kibana {built}, newer than yours: run  KIBANA_VERSION={ver} npm run build  first")
    else:
        ok(f"dist/ saved objects target Kibana {built}: compatible")


def templates():
    print("templates")
    for t in TEMPLATES:
        body = json.loads((ROOT / "etl" / "index-templates" / f"{t}.json").read_text())
        r = call("ES", "PUT", f"/_index_template/{t}", body)
        ok(t) if r.get("acknowledged") else fail(f"{t}: {r}")


def _bulk(path, label, chunk=4000):
    lines = path.read_text().splitlines() if path.stat().st_size < 50_000_000 else None
    sent = errors = 0

    def send(batch):
        nonlocal sent, errors
        r = call("ES", "POST", "/_bulk?refresh=false", "\n".join(batch) + "\n", "application/x-ndjson")
        if "_error" in r:
            sys.exit(f"bulk {label}: {r}")
        errors += sum(1 for i in r["items"] if list(i.values())[0].get("error"))
        sent += len(batch) // 2

    batch = []
    src = lines if lines is not None else open(path)
    for line in src:
        line = line.rstrip("\n")
        if not line:
            continue
        batch.append(line)
        if len(batch) >= chunk * 2:
            send(batch)
            batch = []
            print(f"\r  ..    {label}: {sent:,}", end="", flush=True)
    if batch:
        send(batch)
    print("\r", end="")
    (ok if not errors else fail)(f"{label}: {sent:,} documents, {errors} errors")


def reference():
    print("reference")
    call("ES", "DELETE", "/ia-reference")  # so removed rows go too
    _bulk(ROOT / "dist" / "elasticsearch" / "ia-reference.ndjson", "ia-reference")
    call("ES", "POST", "/ia-reference/_refresh")


def dashboards():
    print("dashboards")
    f = ROOT / "dist" / "kibana" / "ia-dashboards.ndjson"
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{f.name}\"\r\nContent-Type: application/ndjson\r\n\r\n").encode() + f.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    r = call("KIBANA", "POST", "/api/saved_objects/_import?overwrite=true", body, f"multipart/form-data; boundary={boundary}")
    if r.get("success"):
        ok(f"{r.get('successCount')} saved objects imported")
    else:
        fail(json.dumps(r)[:1500])
        print("        If the errors mention controlGroupInput, run  NO_CONTROLS=1 npm run build  and import again,")
        print("        then add the five controls by hand (docs/BUILD-GUIDE.md, step 7).")


def mock():
    print("mock (demo data; skip this on a real estate)")
    for name in ["ia-cost-daily", "ia-vdi-daily", "ia-service-checks", "ia-workqueue-items"]:
        p = ROOT / "mock" / f"{name}.ndjson"
        if not p.exists():
            fail(f"{p} missing: run npm run mock (and npm run mock:service)")
            continue
        _bulk(p, name)
        call("ES", "POST", f"/{name}/_refresh")


def verify():
    print("verify")
    q = lambda idx, body: call("ES", "POST", f"/{idx}/_search", body)  # noqa: E731
    r = q("ia-workqueue-items", {"size": 0, "track_total_hits": True, "aggs": {"m": {"terms": {"field": "mapped"}}, "last": {"max": {"field": "@timestamp"}}, "cost": {"filter": {"exists": {"field": "cost.estate_gbp"}}}, "sla": {"filter": {"exists": {"field": "item.sla_due_at"}}}}})
    if "_error" in r:
        fail(f"ia-workqueue-items: {r}")
    else:
        total = r["hits"]["total"]["value"]
        mapped = {str(b.get("key_as_string", b["key"])).lower().replace("1", "true").replace("0", "false"): b["doc_count"] for b in r["aggregations"]["m"]["buckets"]}
        (ok if total else fail)(f"ia-workqueue-items: {total:,} items, last at {r['aggregations']['last'].get('value_as_string')}")
        unmapped = mapped.get("false", 0)
        (ok if mapped.get("true", 0) else fail)(f"mapped to reference data: {mapped.get('true', 0):,}; unmapped: {unmapped:,}" + (" (these are missing from every figure: add their queues to queueMap)" if unmapped else ""))
        (ok if r["aggregations"]["cost"]["doc_count"] else fail)(f"items with stamped cost: {r['aggregations']['cost']['doc_count']:,} (0 means the cost job has not run)")
        (ok if r["aggregations"]["sla"]["doc_count"] else fail)(f"items with an SLA due time: {r['aggregations']['sla']['doc_count']:,} (0 means stage 1 predates T14)")
    for idx in ["ia-cost-daily", "ia-vdi-daily", "ia-reference", "ia-service-checks"]:
        r = q(idx, {"size": 0, "track_total_hits": True})
        n = r.get("hits", {}).get("total", {}).get("value", 0) if "_error" not in r else 0
        (ok if n else fail)(f"{idx}: {n:,} documents" + (" (the service check job has not run yet)" if idx == "ia-service-checks" and not n else ""))
    found = call("KIBANA", "GET", "/api/saved_objects/_find?type=dashboard&search=IA&search_fields=title&per_page=50")
    titles = sorted(o["attributes"]["title"] for o in found.get("saved_objects", []))
    (ok if len(titles) >= 9 else fail)(f"{len(titles)} IA dashboards in Kibana: {', '.join(t.replace('IA · ', '') for t in titles)}")


STEPS = {"check": check, "templates": templates, "reference": reference, "dashboards": dashboards, "mock": mock, "verify": verify}

if __name__ == "__main__":
    want = sys.argv[1:] or ["check"]
    if want == ["all"]:
        want = ["check", "templates", "reference", "dashboards", "verify"]
    for step in want:
        if step not in STEPS:
            sys.exit(f"unknown step {step}: choose from {', '.join(STEPS)} or all")
        STEPS[step]()
