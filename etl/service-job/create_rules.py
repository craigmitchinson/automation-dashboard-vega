"""create_rules.py: the Kibana alerting rules that turn ia-service-checks into
notifications. Run once (and again after changing anything here; it updates
rules in place).

    KIBANA_URL=https://kibana:5601 KIBANA_API_KEY=... python3 create_rules.py \
        --connector <id> --connector-type teams [--warn-connector <id>]
    python3 create_rules.py --dry-run          # print the rule bodies

Four rules, all the built-in "Elasticsearch query" type (Basic licence):

  IA service: action needed   a check moved to Action
  IA service: warning         a check moved to Warning (send to a quieter channel, or leave off)
  IA service: cleared         a check that was Action or Warning is OK again
  IA service: check job down  no check results for 45 minutes, so nothing above can fire

The job writes `changed: true` only on the run where a check's state moves, so
each rule fires once per change rather than every 15 minutes.

Connector types: teams, slack and webhook take a single message; email needs
--to. Create the connector itself under Stack Management > Connectors first.
"""
import argparse
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

SPEC = json.loads((pathlib.Path(__file__).resolve().parent / "service-checks.json").read_text())
INDEX = "ia-service-checks"

LIST = (
    "{{#context.hits}}"
    "{{_source.check.name}}: {{_source.headline}}\n"
    "{{_source.detail}}\n"
    "First step: {{_source.runbook}}\n\n"
    "{{/context.hits}}"
    "Service dashboard: {{context.hits.0._source.link}}"
)


def changed_to(states, previous=None):
    f = [{"term": {"changed": True}}, {"terms": {"alert_state": states}}]
    if previous:
        f.append({"terms": {"previous_state": previous}})
    return {"query": {"bool": {"filter": f}}}


RULES = [
    dict(id="ia-service-action", name="IA service: action needed", query=changed_to(["act"]), comparator=">", threshold=0, window=20,
         subject="IA service: action needed", message="These checks need action now.\n\n" + LIST, warn=False),
    dict(id="ia-service-warning", name="IA service: warning", query=changed_to(["warn"]), comparator=">", threshold=0, window=20,
         subject="IA service: warning", message="These checks moved to Warning. Nothing to do yet unless they reach Action.\n\n" + LIST, warn=True),
    dict(id="ia-service-cleared", name="IA service: cleared", query=changed_to(["ok"], ["act", "warn"]), comparator=">", threshold=0, window=20,
         subject="IA service: cleared", message="These checks are OK again.\n\n{{#context.hits}}{{_source.check.name}}: {{_source.headline}}\n{{/context.hits}}", warn=False),
    dict(id="ia-service-job-down", name="IA service: check job down", query={"query": {"match_all": {}}}, comparator="<", threshold=1, window=SPEC["service"]["jobSilentMinutes"],
         subject="IA service: check job down",
         message=f"No service check results for {SPEC['service']['jobSilentMinutes']} minutes. Until etl/service-job/service_checks.py runs again, no service alerts can fire. Check its schedule and its log.",
         warn=False, all_hits=False),
]


def action(connector, ctype, subject, message, to):
    if ctype == "email":
        params = {"to": to, "subject": subject, "message": message}
    elif ctype == "webhook":
        params = {"body": json.dumps({"title": subject, "text": message})}
    else:  # teams, slack
        params = {"message": f"{subject}\n\n{message}"}
    return {"group": "query matched", "id": connector, "params": params}


def body(rule, args):
    connector = args.warn_connector if rule["warn"] else args.connector
    actions = [action(connector, args.connector_type, rule["subject"], rule["message"], args.to)] if connector else []
    return {
        "name": rule["name"],
        "tags": ["ia-service"],
        "schedule": {"interval": "5m"},
        "notify_when": "onActiveAlert",
        "params": {
            "searchType": "esQuery",
            "index": [INDEX],
            "timeField": "@timestamp",
            "esQuery": json.dumps(rule["query"]),
            "timeWindowSize": rule["window"],
            "timeWindowUnit": "m",
            "threshold": [rule["threshold"]],
            "thresholdComparator": rule["comparator"],
            "size": 20,
            "excludeHitsFromPreviousRun": rule.get("all_hits", True),
        },
        "actions": actions,
    }


def call(method, path, payload):
    url = os.environ.get("KIBANA_URL", "http://localhost:5601").rstrip("/") + path
    headers = {"Content-Type": "application/json", "kbn-xsrf": "true"}
    if os.environ.get("KIBANA_API_KEY"):
        headers["Authorization"] = f"ApiKey {os.environ['KIBANA_API_KEY']}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--connector", help="connector id for action, cleared and job-down alerts")
    ap.add_argument("--warn-connector", help="connector id for warnings (omit to record warnings in Kibana without notifying)")
    ap.add_argument("--connector-type", default="teams", choices=["teams", "slack", "webhook", "email"])
    ap.add_argument("--to", nargs="*", default=[], help="email recipients (email connector only)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if a.connector_type == "email" and (a.connector or a.warn_connector) and not a.to:
        ap.error("--to is needed for an email connector")
    for rule in RULES:
        b = body(rule, a)
        if a.dry_run:
            print(json.dumps({"id": rule["id"], **b}, indent=2))
            continue
        try:
            call("POST", f"/api/alerting/rule/{rule['id']}", {**b, "rule_type_id": ".es-query", "consumer": "stackAlerts"})
            print(f"created  {rule['name']}")
        except urllib.error.HTTPError as e:
            if e.code != 409:
                sys.exit(f"{rule['name']}: {e.code} {e.read().decode()[:500]}")
            call("PUT", f"/api/alerting/rule/{rule['id']}", b)
            print(f"updated  {rule['name']}")


if __name__ == "__main__":
    main()
