"""stamp_costs.py: stage 2 of the ETL, the daily cost job.

Costing an item needs every item for its day first (each item's share of the
day's pools is its worktime over the day's total), so this runs on a schedule
after Logstash, not inside it. For each day it:

  1. totals worktime for the day, estate-wide and per spoke (ES aggregation,
     mapped AND unmapped items, as the React app does);
  2. works out the pools from reference.json (people cost in force / 365.25,
     plus each VDI's daily cost inside its renewal coverage window);
  3. writes one ia-cost-daily doc per pool and one ia-vdi-daily doc per VDI;
  4. stamps cost.* onto that day's mapped items with update_by_query.

Days processed: the last LOOKBACK_DAYS, plus any day holding a mapped item
with no cost yet (new or re-ingested items arrive with cost = null).

The rules are in docs/JOBS.md.

    IA_ES_URL=https://cluster:9200 IA_ES_API_KEY=... \\
    python3 stamp_costs.py --reference reference.json [--lookback 14] [--dry-run]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys

DAY = dt.timedelta(days=1)


# --- pure economics (mirrors economics.mjs T2, T5, T6, T7) -------------------------
def d(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def in_force(rows, date_iso):
    best = None
    for r in rows:
        if r["effectiveFrom"] <= date_iso and (best is None or r["effectiveFrom"] > best["effectiveFrom"]):
            best = r
    return best


def vdi_class_rate(ref, cost_class, date_iso, spoke_id):
    rows = [v for v in ref["vdiCostHistory"] if v["costClass"] == cost_class]
    if spoke_id is not None:
        via = in_force([v for v in rows if v.get("spokeId") == str(spoke_id)], date_iso)
        if via:
            return via["annualCostPerVDIGBP"]
    uni = in_force([v for v in rows if v.get("spokeId") is None], date_iso)
    return uni["annualCostPerVDIGBP"] if uni else 0


def cycle_start(renewal_iso: str, date_iso: str) -> dt.date:
    renewal, date = d(renewal_iso), d(date_iso)
    idx = math.floor((date - renewal).days / 365)
    return renewal + dt.timedelta(days=idx * 365)


def vdi_daily_cost(ref, vdi, date_iso: str) -> float:
    date = d(date_iso)
    cs = cycle_start(vdi["renewalDate"], date_iso)
    end = cs + dt.timedelta(days=365)
    if vdi.get("licenseExpiryDate"):
        end = min(end, d(vdi["licenseExpiryDate"]) + DAY)
    if vdi.get("status") == "retired" and vdi.get("activeTo"):
        end = min(end, d(vdi["activeTo"]) + DAY)
    start = max(cs, d(vdi["activeFrom"]))
    if date < start or date >= end:
        return 0.0
    window = (end - start).days
    annual = vdi.get("annualCostGBP")
    if annual is None:
        annual = vdi_class_rate(ref, vdi["costClass"], cs.isoformat(), vdi.get("spokeId"))
    return annual / window if window > 0 else 0.0


def people_cost_on(ref, owner_id: str, date_iso: str) -> float:
    r = in_force([p for p in ref["peopleCostHistory"] if p["ownerId"] == owner_id], date_iso)
    return r["annualCostGBP"] if r else 0.0


def pools_on(ref, date_iso: str) -> dict:
    hub_people = people_cost_on(ref, "HUB", date_iso) / 365.25
    hub_infra = 0.0
    spokes = {s["spokeId"]: {"name": s["spokeName"], "people": people_cost_on(ref, str(s["spokeId"]), date_iso) / 365.25, "infra": 0.0} for s in ref["spokes"]}
    for r in ref["resources"]:
        c = vdi_daily_cost(ref, r, date_iso)
        if r.get("spokeId") is None:
            hub_infra += c
        else:
            spokes[r["spokeId"]]["infra"] += c
    est = in_force(ref["estateCostHistory"], date_iso) or {}
    return {
        "hub_people": hub_people,
        "hub_infra": hub_infra,
        "spokes": spokes,
        "working_days_per_year": est.get("workingDaysPerYear", 252),
        "productive_hours_per_day": est.get("productiveHoursPerDay", 7.5),
    }


def day_documents(ref, date_iso: str, estate_wt: float, spoke_wt: dict[str, float]):
    """ia-cost-daily docs, ia-vdi-daily docs and the per-bot-second rates for one day."""
    p = pools_on(ref, date_iso)
    ts = f"{date_iso}T00:00:00.000Z"
    common = {"@timestamp": ts, "date": date_iso, "estate_worktime_sec": estate_wt, "working_days_per_year": p["working_days_per_year"], "productive_hours_per_day": p["productive_hours_per_day"]}
    hub_total = p["hub_people"] + p["hub_infra"]
    cost_docs = [{**common, "pool": "HUB", "pool_type": "hub", "spoke": None, "people_gbp": p["hub_people"], "infra_gbp": p["hub_infra"], "total_gbp": hub_total, "worktime_sec": estate_wt, "cost_per_bot_sec": hub_total / estate_wt if estate_wt else 0}]
    rates = {"hub_people": p["hub_people"] / estate_wt if estate_wt else 0, "hub_infra": p["hub_infra"] / estate_wt if estate_wt else 0, "spokes": {}}
    for s in p["spokes"].values():
        wt = spoke_wt.get(s["name"], 0)
        total = s["people"] + s["infra"]
        cost_docs.append({**common, "pool": s["name"], "pool_type": "spoke", "spoke": {"name": s["name"]}, "people_gbp": s["people"], "infra_gbp": s["infra"], "total_gbp": total, "worktime_sec": wt, "cost_per_bot_sec": total / wt if wt else 0})
        rates["spokes"][s["name"]] = {"people": s["people"] / wt if wt else 0, "infra": s["infra"] / wt if wt else 0}
    spoke_name = {s["spokeId"]: s["spokeName"] for s in ref["spokes"]}
    vdi_docs = []
    for r in ref["resources"]:
        c = vdi_daily_cost(ref, r, date_iso)
        vdi_docs.append({
            "@timestamp": ts,
            "date": date_iso,
            "resource": {"name": r["resourceName"], "bot": r["botName"], "owner_spoke": spoke_name.get(r.get("spokeId"), "Hub") if r.get("spokeId") is not None else "Hub", "cost_class": r["costClass"], "status": r["status"]},
            "available": c > 0,
            "daily_cost_gbp": c,
            "operating_hours": ref["vdiOperatingHoursPerDay"] if c > 0 else 0,
        })
    return cost_docs, vdi_docs, rates


# Painless twin of pipeline.mjs's stamping loop: worktime x (hub + own spoke) per component.
STAMP_SCRIPT = """
double w = ctx._source.worktime_sec;
def sr = params.spokes[ctx._source.spoke.name];
double sp = sr == null ? 0 : sr.people;
double si = sr == null ? 0 : sr.infra;
Map c = new HashMap();
c.hub_people_gbp = w * params.hub_people;
c.hub_infra_gbp = w * params.hub_infra;
c.spoke_people_gbp = w * sp;
c.spoke_infra_gbp = w * si;
c.people_gbp = c.hub_people_gbp + c.spoke_people_gbp;
c.infra_gbp = c.hub_infra_gbp + c.spoke_infra_gbp;
c.estate_gbp = c.people_gbp + c.infra_gbp;
c.stamped_at = params.now;
ctx._source.cost = c;
"""


# --- Elasticsearch side -------------------------------------------------------------
class Es:
    def __init__(self, url: str, api_key: str, dry_run: bool = False):
        import requests  # only needed when talking to a cluster

        self.url = url.rstrip("/")
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"ApiKey {api_key}", "Content-Type": "application/json"})
        self.dry_run = dry_run

    def post(self, path, body, params=None):
        r = self.s.post(f"{self.url}{path}", data=json.dumps(body), params=params, timeout=600)
        r.raise_for_status()
        return r.json()

    def bulk(self, index, docs, id_of):
        if self.dry_run or not docs:
            return
        lines = []
        for doc in docs:
            lines.append(json.dumps({"index": {"_index": index, "_id": id_of(doc)}}))
            lines.append(json.dumps(doc))
        r = self.s.post(f"{self.url}/_bulk", data="\n".join(lines) + "\n", headers={"Content-Type": "application/x-ndjson"}, timeout=600)
        r.raise_for_status()
        if r.json().get("errors"):
            raise RuntimeError(f"bulk errors writing {index}")


def days_to_process(es: Es, lookback: int) -> list[str]:
    today = dt.datetime.now(dt.timezone.utc).date()
    days = {(today - dt.timedelta(days=i)).isoformat() for i in range(lookback)}
    res = es.post("/ia-workqueue-items/_search", {
        "size": 0,
        "query": {"bool": {"filter": [{"term": {"mapped": True}}], "must_not": [{"exists": {"field": "cost.estate_gbp"}}]}},
        "aggs": {"d": {"terms": {"field": "outcome_date", "size": 5000, "format": "yyyy-MM-dd"}}},
    })
    days |= {b["key_as_string"] for b in res["aggregations"]["d"]["buckets"]}
    return sorted(days)


def worktime_totals(es: Es, date_iso: str):
    res = es.post("/ia-workqueue-items/_search", {
        "size": 0,
        "query": {"term": {"outcome_date": date_iso}},
        "aggs": {"all": {"sum": {"field": "worktime_sec"}}, "sp": {"terms": {"field": "spoke.name", "size": 100}, "aggs": {"w": {"sum": {"field": "worktime_sec"}}}}},
    })
    a = res["aggregations"]
    return a["all"]["value"], {b["key"]: b["w"]["value"] for b in a["sp"]["buckets"]}


def run(ref, es: Es, lookback: int):
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    for day in days_to_process(es, lookback):
        estate_wt, spoke_wt = worktime_totals(es, day)
        cost_docs, vdi_docs, rates = day_documents(ref, day, estate_wt, spoke_wt)
        es.bulk("ia-cost-daily", cost_docs, lambda x: f"{x['date']}|{x['pool']}")
        es.bulk("ia-vdi-daily", vdi_docs, lambda x: f"{x['date']}|{x['resource']['name']}")
        if not es.dry_run:
            es.post("/ia-workqueue-items/_update_by_query", {
                "query": {"bool": {"filter": [{"term": {"outcome_date": day}}, {"term": {"mapped": True}}]}},
                "script": {"lang": "painless", "source": STAMP_SCRIPT, "params": {**{k: rates[k] for k in ("hub_people", "hub_infra")}, "spokes": rates["spokes"], "now": now}},
            }, params={"conflicts": "proceed", "refresh": "true"})
        print(f"{day}: estate worktime {estate_wt:,.0f}s, {len(cost_docs)} pools, {len(vdi_docs)} VDIs", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reference", required=True)
    ap.add_argument("--lookback", type=int, default=14)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    ref = json.load(open(args.reference, encoding="utf-8"))
    es = Es(os.environ["IA_ES_URL"], os.environ["IA_ES_API_KEY"], args.dry_run)
    run(ref, es, args.lookback)


if __name__ == "__main__":
    main()
