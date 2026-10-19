# automation-dashboard-vega: source

This branch builds what `main` holds. Users and the Logstash developer only ever need `main`; its README is `publish/README.md` here.

| Path | What |
|---|---|
| `vega/` | Panel sources (`panels/`, one file per dashboard) and the design kit (`lib/`) |
| `etl/` | Logstash filters and pipelines, index templates, reference data, and the JavaScript reference implementation the others are tested against |
| `render/` | Renderer (Elasticsearch and Kibana emulators) |
| `dist/` | Generated output, including `previews/` (a page image per dashboard, a visual image per panel) |
| `tests/` | Spec, parity and service-check tests |
| `publish/` | The README and docs that go to `main` |
| `setup/` | `install.py` (scripted install for test clusters only) |

```bash
npm ci && npm run mock            # once
npm run build && npm test && npm run test:etl
npm run preview                   # when visuals change
git worktree add ../main-out main && scripts/publish.sh ../main-out   # then commit and push main
```
