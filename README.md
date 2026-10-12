# automation-dashboard-vega: source

This branch builds what `main` holds. Users and the Logstash developer only ever need `main`; its README is `publish/README.md` here.

| Path | What |
|---|---|
| `vega/` | Panel sources (`panels/`, one file per dashboard) and the design kit (`lib/`) |
| `etl/` | Logstash filter, cost and service jobs, index templates, reference data, and the JavaScript reference implementation the others are tested against |
| `preview/`, `previews/` | Renderer (Elasticsearch and Kibana emulators) and its output |
| `tests/` | Spec, parity and service-check tests |
| `publish/` | The README and docs that go to `main` |
| `setup/` | `install.py` (scripted install for test clusters), `crontab.example` |

```bash
npm ci && npm run mock            # once
npm run build && npm test && npm run test:etl
npm run preview                   # when visuals change
git worktree add ../main-out main && scripts/publish.sh ../main-out   # then commit and push main
```
