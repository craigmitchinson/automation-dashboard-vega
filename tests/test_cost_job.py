"""Checks etl/cost-job/stamp_costs.py against the JS reference implementation:
every ia-cost-daily and ia-vdi-daily document in mock/, and the cost stamped on
every mapped item for a sample of days. Run after `npm run mock`:
    python3 tests/test_cost_job.py
"""
import json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "etl" / "cost-job"))
from stamp_costs import day_documents  # noqa: E402

ref = json.loads((ROOT / "etl/reference/reference.json").read_text())

def docs(name):
    out = []
    with open(ROOT / "mock" / name) as f:
        for i, line in enumerate(f):
            if i % 2:
                out.append(json.loads(line))
    return out

cost = docs("ia-cost-daily.ndjson")
vdi = docs("ia-vdi-daily.ndjson")
by_day = {}
for c in cost:
    by_day.setdefault(c["date"], []).append(c)
vdi_by_day = {}
for v in vdi:
    vdi_by_day.setdefault(v["date"], []).append(v)

close = lambda a, b: abs(a - b) <= 1e-6 * max(1, abs(a), abs(b))
bad = 0
rates_by_day = {}
for day, js_docs in by_day.items():
    estate = js_docs[0]["estate_worktime_sec"]
    spoke_wt = {d["pool"]: d["worktime_sec"] for d in js_docs if d["pool_type"] == "spoke"}
    py_docs, py_vdi, rates = day_documents(ref, day, estate, spoke_wt)
    rates_by_day[day] = rates
    for a, b in zip(sorted(py_docs, key=lambda x: x["pool"]), sorted(js_docs, key=lambda x: x["pool"])):
        for k in ("people_gbp", "infra_gbp", "total_gbp", "cost_per_bot_sec", "working_days_per_year", "productive_hours_per_day"):
            if not close(a[k], b[k]):
                bad += 1
    for a, b in zip(sorted(py_vdi, key=lambda x: x["resource"]["name"]), sorted(vdi_by_day[day], key=lambda x: x["resource"]["name"])):
        if not close(a["daily_cost_gbp"], b["daily_cost_gbp"]) or a["operating_hours"] != b["operating_hours"] or a["resource"] != b["resource"]:
            bad += 1

# stamping on a sample of days
sample = set(sorted(by_day)[::37])
checked = 0
with open(ROOT / "mock/ia-workqueue-items.ndjson") as f:
    for i, line in enumerate(f):
        if not i % 2:
            continue
        it = json.loads(line)
        if it["outcome_date"] not in sample or not it["mapped"]:
            continue
        r = rates_by_day[it["outcome_date"]]
        sr = r["spokes"].get(it["spoke"]["name"], {"people": 0, "infra": 0})
        est = it["worktime_sec"] * (r["hub_people"] + r["hub_infra"] + sr["people"] + sr["infra"])
        checked += 1
        if abs(est - it["cost"]["estate_gbp"]) > 1e-6:
            bad += 1
print(f"days {len(by_day)}, pool docs {len(cost)}, vdi docs {len(vdi)}, items stamped-checked {checked}, mismatches {bad}")
sys.exit(1 if bad else 0)
