"""service_checks.py: the IA service checks, run on a schedule.

Runs the Service dashboard's queries (service-checks.json, generated from
vega/lib/service.mjs by `npm run build`) against Elasticsearch, applies the
same rules the dashboard applies, and writes one document per check per run
to ia-service-checks. The Kibana alerting rules (create_rules.py) watch that
index, so the run team is told when a check moves to Action and when it
clears, without anyone watching a dashboard.

    # every 15 minutes (cron, Kubernetes CronJob, or a Logstash heartbeat)
    IA_ES_URL=https://es:9200 IA_ES_API_KEY=... [IA_KIBANA_URL=https://kibana] python3 service_checks.py

    python3 service_checks.py --dry-run            # print, write nothing
    python3 service_checks.py --now 2026-07-14T15:00:00Z
    python3 service_checks.py --evaluate responses.json --now <epoch ms>   # rules only (tests)

Standard library only. The rules in evaluate() mirror serviceBlock() in
vega/lib/service.mjs line for line; tests/service.test.mjs holds them equal.
"""
import argparse
import datetime as dt
import json
import math
import os
import pathlib
import sys
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
SPEC = json.loads((HERE / "service-checks.json").read_text())
CFG = SPEC["service"]
CHECKS = SPEC["checks"]
RANK = SPEC["statusRank"]  # quiet 0, ok 1, warn 2, act 3
STATUS_OF_RANK = {1: "ok", 2: "warn", 3: "act"}
H = 3_600_000
D = 86_400_000
UNIT_MS = {"ms": 1, "s": 1000, "second": 1000, "m": 60_000, "minute": 60_000, "h": H, "hour": H, "d": D, "day": D, "w": 7 * D, "week": 7 * D}
INDEX = "ia-service-checks"


# --- the same text helpers the Vega expressions use -------------------------
def js_round(x):
    return math.floor(x + 0.5)


def fmt_age(m):
    if m < 90:
        return f"{js_round(m)} min"
    if m < 2880:
        return f"{js_round(m / 60)} h"
    return f"{js_round(m / 1440)} days"


def num(x):
    """A number as JavaScript prints it (sum aggregations come back as floats)."""
    return str(int(x)) if float(x).is_integer() else repr(x)


def pct(x):
    return f"{x * 100:.1f}%"


def day_label(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%d %b")


# --- query resolution: what Kibana does to the dashboard's queries ---------
def resolve(node, now_ms):
    """Replace {"%timefilter%": "max", shift, unit} with epoch ms and drop the
    dashboard-context placeholders (the job runs estate-wide)."""
    if isinstance(node, list):
        return [resolve(x, now_ms) for x in node if not (isinstance(x, str) and x.startswith("%dashboard_context-"))]
    if isinstance(node, dict):
        if "%timefilter%" in node:
            if node["%timefilter%"] != "max":
                raise ValueError("service queries only use the picker end")
            return now_ms + node.get("shift", 0) * UNIT_MS[node.get("unit", "d")]
        return {k: resolve(v, now_ms) for k, v in node.items()}
    return node


# --- the rules ----------------------------------------------------------------
def _first_key(buckets, default=""):
    return buckets[0]["key"] if buckets else default


def _summary(offenders):
    offenders.sort(key=lambda o: (-o["rank"], -o["m"], o["name"]))
    n = len(offenders)
    rank = max((o["rank"] for o in offenders), default=1)
    detail = "; ".join(o["txt"] for o in offenders[:2]) + (f"; +{n - 2} more" if n > 2 else "")
    return STATUS_OF_RANK[rank], n, detail


def evaluate(resp, now):
    """resp: {query name: the search response's "aggregations"}. now: epoch ms.
    Returns one result per check, in board order."""
    flow, pending = resp["sv_flow"], resp["sv_pending"]
    floor_, below, spike = CFG["usualFloor"], CFG["belowUsual"], CFG["sysSpike"]
    start, end = CFG["serviceHoursUtc"]
    in_hours = start <= dt.datetime.fromtimestamp(now / 1000, dt.timezone.utc).hour < end

    # processes
    procs = []
    for g in flow["pr"]["buckets"]:
        w = g["w"]["buckets"]
        a = [w[f"w{k}"]["a"]["value"] for k in range(5)]
        s0, ab, sb = w["w0"]["s"]["value"], w["base"]["a"]["value"], w["base"]["s"]["value"]
        usual = (a[1] + a[2] + a[3] + a[4]) / 4
        base_rate = max(spike["rateFloor"], sb / ab if ab else 0)
        rate0 = s0 / a[0] if a[0] else 0
        silent = "act" if usual >= floor_ and a[0] < usual * below["act"] else "warn" if usual >= floor_ and a[0] < usual * below["warn"] else "ok"
        spk = "act" if s0 >= spike["actItems"] and rate0 > spike["actX"] * base_rate else "warn" if s0 >= spike["warnItems"] and rate0 > spike["warnX"] * base_rate else "ok"
        procs.append(dict(name=g["key"], spoke=_first_key(g["sp"]["buckets"]), a0=a[0], s0=s0, usual=usual, base_rate=base_rate, rate0=rate0, silent=silent, spike=spk))
    off_processes = [dict(name=p["name"], spoke=p["spoke"], rank=RANK[p["silent"]], m=p["usual"] - p["a0"], txt=f"{p['name']}: {num(p['a0'])} in 24h vs usual {js_round(p['usual'])}") for p in procs if p["silent"] != "ok"]
    off_spike = [dict(name=p["name"], spoke=p["spoke"], rank=RANK[p["spike"]], m=p["s0"], txt=f"{p['name']}: {num(p['s0'])} system exceptions ({pct(p['rate0'])} vs usual {pct(p['base_rate'])})") for p in procs if p["spike"] != "ok"]
    usual_procs = sum(1 for p in procs if p["usual"] >= floor_)

    # digital workers
    vstatus = {g["key"]: _first_key(g["st"]["buckets"]) for g in resp["sv_vdi"]["r"]["buckets"]}
    est_last = flow["last"]["value"] or now
    workers = []
    for g in flow["rs"]["buckets"]:
        w = g["w"]["buckets"]
        wk = [w[f"w{k}"]["doc_count"] for k in range(5)]
        usual = (wk[1] + wk[2] + wk[3] + wk[4]) / 4
        last = g["last"]["value"]
        if vstatus.get(g["key"]) == "retired" or not (last >= now - 7 * D or usual >= floor_):
            continue
        gap_h = (est_last - max(last, math.floor(now / D) * D + start * H)) / H
        gap_x = usual / (end - start) * gap_h >= CFG["gapMinExpected"]
        age_min = (now - last) / 60000
        if usual >= floor_ and wk[0] < usual * below["act"]:
            state = "act"
        elif in_hours and gap_x and gap_h > CFG["workerGapHours"]["act"]:
            state = "act"
        elif in_hours and gap_x and gap_h > CFG["workerGapHours"]["warn"]:
            state = "warn"
        elif usual >= floor_ and wk[0] < usual * below["warn"]:
            state = "warn"
        else:
            state = "ok"
        workers.append(dict(name=g["key"], spoke=_first_key(g["sp"]["buckets"]), w0=wk[0], usual=usual, age_min=age_min, state=state))
    off_workers = [dict(name=w["name"], spoke=w["spoke"], rank=RANK[w["state"]], m=w["usual"] - w["w0"], txt=f"{w['name']}: last item {fmt_age(w['age_min'])} ago, {num(w['w0'])} in 24h vs usual {js_round(w['usual'])}") for w in workers if w["state"] != "ok"]

    # queues
    queues = []
    for g in pending["q"]["buckets"]:
        waiting = g["live"]["doc_count"]
        age_min = (now - g["live"]["oldest"]["value"]) / 60000 if waiting else 0
        stuck = g["stuck"]["doc_count"]
        lock_min = (now - g["stuck"]["oldest"]["value"]) / 60000 if stuck else 0
        past, soon = g["live"]["past"]["doc_count"], g["live"]["soon"]["doc_count"]
        state = "act" if past > 0 else "warn" if soon > 0 else "ok"
        queues.append(dict(name=g["key"], spoke=_first_key(g["sp"]["buckets"]), waiting=waiting, age_min=age_min, past=past, soon=soon, stuck=stuck, lock_min=lock_min, state=state))
    soon_h = CFG["slaSoonHours"]
    off_sla = [dict(name=q["name"], spoke=q["spoke"], rank=RANK[q["state"]], m=q["past"] + q["soon"] / 1000,
                    txt=f"{q['name']}: " + (f"{q['past']} past SLA" if q["past"] else f"{q['soon']} due within {soon_h} h") + f", oldest {fmt_age(q['age_min'])}")
               for q in queues if q["state"] != "ok"]
    off_locks = [dict(name=q["name"], spoke=q["spoke"], rank=3, m=q["stuck"], txt=f"{q['name']}: {q['stuck']} locked, longest {fmt_age(q['lock_min'])}") for q in queues if q["stuck"] > 0]
    tot_waiting = sum(q["waiting"] for q in queues)
    tot_stuck = sum(q["stuck"] for q in queues)
    tot_past = sum(q["past"] for q in queues)
    tot_soon = sum(q["soon"] for q in queues)

    # unmapped queues
    off_unmapped = [dict(name=g["key"], spoke="", rank=2, m=g["doc_count"], txt=f"{g['key']}: {g['doc_count']} items") for g in resp["sv_unmapped"]["q"]["buckets"]]
    tot_unmapped = sum(o["m"] for o in off_unmapped)

    # exception reasons
    base_codes = {g["key"] for g in flow["rb"]["code"]["buckets"]}
    off_new = []
    for g in flow["r0"]["code"]["buckets"]:
        if g["key"] in base_codes or g["doc_count"] < CFG["newReasonMin"]:
            continue
        reason = _first_key(g["rd"]["buckets"], g["key"])
        off_new.append(dict(name=reason, spoke="", rank=2, m=g["doc_count"], txt=f"{reason} ({g['doc_count']}, {_first_key(g['pr']['buckets'])})"))

    # pipeline
    last = resp["sv_fresh"]["last"]["value"]
    age = (now - last) / 60000 if last is not None else None
    fm = CFG["freshnessMin"]
    fresh = "quiet" if not in_hours else "act" if last is None else "act" if age > fm["act"] else "warn" if age > fm["warn"] else "ok"
    cost_last = resp["sv_cost"]["last"]["value"]
    lag = (math.floor(now / D) * D - math.floor(cost_last / D) * D) // D if cost_last is not None else None
    cl = CFG["costLagDays"]
    cost = "act" if lag is None else "act" if lag >= cl["act"] else "warn" if lag >= cl["warn"] else "ok"

    out = {}
    out["freshness"] = dict(
        status=fresh, count=0, offenders=[],
        headline="No updates in 7 days" if last is None else f"{fmt_age(age)} since the last update",
        detail=f"Outside service hours ({start:02d}:00 to {end}:00 UTC)" if fresh == "quiet" else "",
    )
    out["cost_job"] = dict(
        status=cost, count=0, offenders=[], detail="",
        headline="No costed days found" if cost_last is None else "Costed to today" if lag <= 0 else f"Costed to {day_label(cost_last)} ({lag}{' day' if lag == 1 else ' days'} behind)",
    )

    def add(cid, offenders, headline):
        status, n, detail = _summary(offenders)
        out[cid] = dict(status=status, count=n, detail=detail, offenders=offenders, headline=headline(n))

    lm = CFG["lockMinutes"]
    add("unmapped", off_unmapped, lambda n: f"{n}{' unmapped queue, ' if n == 1 else ' unmapped queues, '}{tot_unmapped:,} items in 24h" if n else "Every queue is in reference data")
    add("sla", off_sla, lambda n: "No items waiting" if not tot_waiting else f"{tot_waiting:,} waiting, " + (f"{tot_past:,} past SLA" if tot_past else f"{tot_soon:,} due within {soon_h} h" if tot_soon else "none near SLA"))
    add("locks", off_locks, lambda n: f"No items locked over {lm} min" if not tot_stuck else f"{tot_stuck} locked over {lm} min")
    add("workers", off_workers, lambda n: f"{n} of {len(workers)} workers quiet" if n else f"{len(workers)} workers active")
    add("processes", off_processes, lambda n: f"{n} running below usual" if n else f"{usual_procs} processes on their usual pattern")
    add("sys_spike", off_spike, lambda n: f"{n}{' process' if n == 1 else ' processes'} above usual" if n else "In line with the last 28 days")
    add("new_reasons", off_new, lambda n: f"{n} new in the last 24 hours" if n else "None")

    return [dict(id=c["id"], name=c["name"], group=c["group"], runbook=c["runbook"], **out[c["id"]]) for c in CHECKS]


# --- talking to Elasticsearch ------------------------------------------------
class Es:
    def __init__(self, url, api_key=None):
        self.url = url.rstrip("/")
        self.headers = {"Content-Type": "application/json"}
        if api_key:
            self.headers["Authorization"] = f"ApiKey {api_key}"

    def _req(self, path, data, ctype="application/json"):
        req = urllib.request.Request(f"{self.url}{path}", data=data.encode(), headers={**self.headers, "Content-Type": ctype}, method="POST")
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read())

    def search(self, index, body):
        return self._req(f"/{index}/_search", json.dumps(body))

    def bulk(self, index, docs, ids):
        lines = []
        for doc, _id in zip(docs, ids):
            lines += [json.dumps({"index": {"_index": index, "_id": _id}}), json.dumps(doc)]
        res = self._req("/_bulk", "\n".join(lines) + "\n", "application/x-ndjson")
        if res.get("errors"):
            raise RuntimeError(f"bulk errors writing {index}")


def previous_states(es):
    """Latest alert_state per check (none on the first run)."""
    try:
        res = es.search(INDEX, {"size": 0, "aggs": {"c": {"terms": {"field": "check.id", "size": 50}, "aggs": {"t": {"top_hits": {"size": 1, "sort": [{"@timestamp": {"order": "desc"}}], "_source": ["alert_state"]}}}}}})
    except Exception:  # index not created yet
        return {}
    return {b["key"]: b["t"]["hits"]["hits"][0]["_source"]["alert_state"] for b in res.get("aggregations", {}).get("c", {}).get("buckets", [])}


def documents(results, now, previous, kibana_url=None):
    """One document per check. alert_state is the status, except that 'Out of
    hours' keeps the last real state, so the evening doesn't look like a
    recovery and the morning doesn't look like a new incident."""
    ts = dt.datetime.fromtimestamp(now / 1000, dt.timezone.utc).isoformat().replace("+00:00", "Z")
    docs, ids = [], []
    for r in results:
        prev = previous.get(r["id"], "ok")
        alert_state = prev if r["status"] == "quiet" else r["status"]
        docs.append({
            "@timestamp": ts,
            "check": {"id": r["id"], "name": r["name"], "group": r["group"]},
            "status": r["status"],
            "status_rank": RANK[r["status"]],
            "alert_state": alert_state,
            "previous_state": prev,
            "changed": alert_state != prev,
            "headline": r["headline"],
            "detail": r["detail"],
            "count": r["count"],
            "runbook": r["runbook"],
            "offenders": [{"name": o["name"], "spoke": o["spoke"], "status": STATUS_OF_RANK[o["rank"]], "text": o["txt"]} for o in r["offenders"][:20]],
            "spokes": sorted({o["spoke"] for o in r["offenders"] if o["spoke"]}),
            "link": f"{kibana_url.rstrip('/')}/app/dashboards#/view/ia-service" if kibana_url else None,
        })
        ids.append(f"{ts}|{r['id']}")
    return docs, ids


def run(es, now, kibana_url=None, dry_run=False):
    resp = {}
    for name, q in SPEC["queries"].items():
        resp[name] = es.search(q["index"], resolve(q["body"], now)).get("aggregations", {})
    results = evaluate(resp, now)
    docs, ids = documents(results, now, previous_states(es), kibana_url)
    if dry_run:
        for d in docs:
            print(f"{d['status']:>5}  {d['check']['name']}: {d['headline']}" + (f" | {d['detail']}" if d["detail"] else ""))
    else:
        es.bulk(INDEX, docs, ids)
    return docs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--now", help="ISO time or epoch ms (default: the current time)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--evaluate", help="a JSON file of {query name: aggregations}; print the results and exit")
    a = ap.parse_args()
    if a.now is None:
        now = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    elif a.now.isdigit():
        now = int(a.now)
    else:
        now = int(dt.datetime.fromisoformat(a.now.replace("Z", "+00:00")).timestamp() * 1000)
    if a.evaluate:
        json.dump(evaluate(json.loads(pathlib.Path(a.evaluate).read_text()), now), sys.stdout)
        return
    env = lambda k, d=None: os.environ.get(f"IA_{k}", os.environ.get(k, d))  # noqa: E731
    es = Es(env("ES_URL", "http://localhost:9200"), env("ES_API_KEY"))
    run(es, now, env("KIBANA_URL"), a.dry_run)


if __name__ == "__main__":
    main()
