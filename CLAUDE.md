# automation-dashboard-vega

- What: the automation-dashboard React app rebuilt as Kibana 8 dashboards of Vega panels. Read README.md, then docs/DATA-CONTRACT.md before touching the ETL.
- Specs are generated: edit `vega/panels/*.mjs` or `vega/lib/*`, never `dist/`. Colours/fonts only in `vega/lib/tokens.mjs` (Platform Health palette; spoke colours come from reference.json); number formats only in `vega/lib/fmt.mjs`.
- Commands: `npm run mock` (once), `npm run build`, `npm test`, `npm run test:etl`, `npm run preview` (writes previews/: pages, visuals and svg, all committed).
- Service checks (vega/lib/service.mjs) exist twice: Vega and etl/service-job/service_checks.py, which reads the queries and thresholds from the generated service-checks.json. Change both evaluations together; tests/service.test.mjs holds them equal. `npm run mock:service` regenerates the check history.
- The ETL rules exist three times (JS reference in etl/reference-impl, Ruby in etl/logstash, Python in etl/cost-job). Change all three and run `npm run test:etl`.
- Vega expression gotchas found so far: no `sum()`, `concat()` or function literals (use aggregate datasets and `indexof(pluck())`); named marks create datasets so names must be unique; `%context%` cannot sit alongside `body.query`; groups need `encode.update.clip` to hide children.
- UI copy: UK English, no em dashes.
