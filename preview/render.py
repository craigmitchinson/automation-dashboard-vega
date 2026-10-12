"""render.py: draws each resolved dashboard state in headless Chromium the way
Kibana lays it out (48-column grid, 20px rows, 8px margins), using the real
Vega runtime, and saves one PNG per dashboard state plus a per-panel error log.

    python3 preview/render.py [dashboardId ...]
"""
import asyncio
import json
import pathlib
import sys

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "preview" / "out"
VEGA = ROOT / "node_modules" / "vega" / "build" / "vega.min.js"
import os
CANVAS_W = int(os.environ.get("CANVAS_W", "1560"))  # dashboard content width in px; CANVAS_W=1180 checks a 13-inch laptop
CHECK_ONLY = os.environ.get("CANVAS_W") is not None  # a size check writes preview/out only
COLS, ROW_H, MARGIN = 48, 20, 8
COL_W = (CANVAS_W - MARGIN * (COLS + 1)) / COLS

FONT_CSS = """
@font-face{font-family:Inter;font-weight:400;src:url(fonts/inter-400.woff2)}
@font-face{font-family:Inter;font-weight:500;src:url(fonts/inter-500.woff2)}
@font-face{font-family:Inter;font-weight:600;src:url(fonts/inter-600.woff2)}
@font-face{font-family:Inter;font-weight:700;src:url(fonts/inter-700.woff2)}
@font-face{font-family:'Roboto Mono';font-weight:400;src:url(fonts/roboto-mono-400.woff2)}
@font-face{font-family:'Roboto Mono';font-weight:500;src:url(fonts/roboto-mono-500.woff2)}
@font-face{font-family:'Roboto Mono';font-weight:600;src:url(fonts/roboto-mono-600.woff2)}
"""

NAV_GROUPS = json.loads((ROOT / "dist" / "nav.json").read_text())


def px(grid, y_offset):
    x = MARGIN + grid["x"] * (COL_W + MARGIN)
    y = MARGIN + (grid["y"] + y_offset) * (ROW_H + MARGIN)
    w = grid["w"] * COL_W + (grid["w"] - 1) * MARGIN
    h = grid["h"] * ROW_H + (grid["h"] - 1) * MARGIN
    return round(x), round(y), round(w), round(h)


def page_html(title, state_label, panels, ctl_titles=None):
    y_off = 2  # nav strip rows, as in the saved dashboard
    divs, specs = [], []
    bottom = 0
    for i, p in enumerate(panels):
        x, y, w, h = px(p["grid"], y_off)
        bottom = max(bottom, y + h)
        divs.append(f'<div class="panel" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px"><div id="p{i}"></div></div>')
        specs.append({"id": f"p{i}", "w": w - 2, "h": h - 2, "file": p["resolved"], "name": p["panel"]})
    nx, ny, nw, nh = px({"x": 0, "y": 0, "w": 48, "h": 2}, 0)
    cur = title.replace("IA · ", "")
    nav = " &nbsp;|&nbsp; ".join(f'<i class="g">{g}</i> ' + " · ".join(f'<b>{n}</b>' if n == cur else n for n in names) for g, names in NAV_GROUPS)
    controls = "".join(f'<span class="ctl"><i>{c}</i>Any</span>' for c in (ctl_titles or ["Spoke", "Proposition", "Process", "Queue", "Tags"]))
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{FONT_CSS}
body{{margin:0;background:#F7F8FC;font-family:Inter,sans-serif}}
.top{{height:46px;background:#fff;border-bottom:1px solid #D3DAE6;display:flex;align-items:center;padding:0 16px;gap:16px;font-size:14px;color:#343741}}
.top .t{{font-weight:700}} .top .s{{margin-left:auto;font-size:12px;color:#69707D}}
.ctls{{display:flex;gap:8px;padding:8px 8px 0 8px}} .ctl{{flex:1;background:#fff;border:1px solid #D3DAE6;border-radius:4px;font-size:12px;padding:6px 8px;color:#343741}} .ctl i{{font-style:normal;color:#69707D;margin-right:8px}}
.grid{{position:relative;width:{CANVAS_W}px;height:{bottom + MARGIN}px}}
.panel{{position:absolute;background:#fff;border:1px solid #D3DAE6;border-radius:6px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}}
.nav{{position:absolute;left:{nx}px;top:{ny}px;width:{nw}px;height:{nh}px;background:#fff;border:1px solid #D3DAE6;border-radius:6px;font-size:12px;display:flex;align-items:center;padding:0 12px;box-sizing:border-box;color:#006BB8}}
.nav b{{color:#343741}} .nav .g{{font-style:normal;font-weight:700;color:#343741;margin-right:4px}}
.err{{color:#BD271E;font:12px monospace;padding:8px;white-space:pre-wrap}}
</style><script src="file://{VEGA}"></script></head><body>
<div class="top"><span class="t">{title}</span><span class="s">Kibana preview · {state_label} · data to 14 Jul 2026</span></div>
<div class="ctls">{controls}</div>
<div class="grid"><div class="nav">{nav}</div>{''.join(divs)}</div>
<script>
const SPECS = {json.dumps(specs)};
window.__log = [];
vega.expressionFunction('kibanaAddFilter', function() {{ window.__log.push(['kibanaAddFilter', JSON.stringify([...arguments])]); return true; }});
vega.expressionFunction('kibanaRemoveFilter', function() {{ return true; }});
vega.expressionFunction('kibanaRemoveAllFilters', function() {{ return true; }});
vega.expressionFunction('kibanaSetTimeFilter', function() {{ return true; }});
window.renderAll = async function(specTexts) {{
  for (const w of ['400', '500', '600', '700']) await document.fonts.load(w + ' 14px Inter');
  for (const w of ['400', '500', '600']) await document.fonts.load(w + ' 11px "Roboto Mono"');
  const results = [];
  for (const s of SPECS) {{
    const el = document.getElementById(s.id);
    try {{
      const spec = specTexts[s.file];
      const warns = [];
      const view = new vega.View(vega.parse(spec), {{ renderer: 'svg', container: el, hover: true, logLevel: vega.Warn,
        logger: {{ level(){{return this;}}, warn(...a){{ warns.push(a.join(' ')); return this; }}, info(){{return this;}}, debug(){{return this;}}, error(...a){{ warns.push('ERROR ' + a.join(' ')); return this; }} }} }});
      view.width(s.w).height(s.h);
      await view.runAsync();
      const svg = await view.toSVG();
      results.push({{ panel: s.name, ok: true, warnings: warns, svg }});
    }} catch (e) {{
      el.innerHTML = '<div class="err">' + s.name + ': ' + (e && e.message) + '</div>';
      results.push({{ panel: s.name, ok: false, error: String(e && e.stack || e) }});
    }}
  }}
  return results;
}};
</script></body></html>"""


PREVIEWS = ROOT / "previews"
MANIFEST = json.loads((ROOT / "dist" / "manifest.json").read_text())
DASH_ORDER = list(dict.fromkeys(m["dashboard"] for m in MANIFEST))
STATE_SUFFIX = {"default": "", "spoke": "-one-spoke", "process": "-one-process", "fy": "-12-months"}


def page_name(dash, state):
    """previews/pages/03-overview.png: numbered in navigation order."""
    return f"{DASH_ORDER.index(dash) + 1:02d}-{dash}{STATE_SUFFIX[state]}"


def visual_name(dash, panel, state):
    """previews/visuals/03-overview--02-daily-flow.png: page, then position on the page."""
    order = [m["panel"] for m in MANIFEST if m["dashboard"] == dash]
    return f"{DASH_ORDER.index(dash) + 1:02d}-{dash}--{order.index(panel) + 1:02d}-{panel}{STATE_SUFFIX[state]}"


def write_gallery():
    """previews/README.md: every page and visual, in navigation order."""
    titles = {m["dashboard"]: m["dashboardTitle"].replace("IA · ", "") for m in MANIFEST}
    lines = ["# Previews", "", "Every dashboard and every visual, rendered from the dashboard import against demonstration data as at 14 July 2026. `pages/` has one image per dashboard, `visuals/` one per visual, named page then position.", ""]
    for d in DASH_ORDER:
        lines += [f"- [{titles[d]}](#{d})"]
    for d in DASH_ORDER:
        lines += ["", f'<a id="{d}"></a>', f"## {titles[d]}", ""]
        for f in sorted((PREVIEWS / "pages").glob(f"{DASH_ORDER.index(d) + 1:02d}-{d}*.png")):
            lines += [f"![{f.stem}](pages/{f.name})", ""]
        for f in sorted((PREVIEWS / "visuals").glob(f"{DASH_ORDER.index(d) + 1:02d}-{d}--*.png")):
            lines += [f"**{f.stem.split('--', 1)[1][3:].replace('-', ' ')}**", "", f"![{f.stem}](visuals/{f.name})", ""]
    (PREVIEWS / "README.md").write_text("\n".join(lines) + "\n")


def publish(png, name):
    """Committed copy for previews/pages: 1600px wide."""
    from PIL import Image

    im = Image.open(png).convert("RGB")
    w, h = im.size
    im = im.resize((1600, round(h * 1600 / w)), Image.LANCZOS)
    out = PREVIEWS / "pages" / name
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, optimize=True)


async def main():
    resolved = json.loads((OUT / "resolved.json").read_text())
    only = set(sys.argv[1:])
    groups = {}
    for r in resolved:
        if only and r["dashboard"] not in only:
            continue
        groups.setdefault((r["dashboard"], r["state"]), []).append(r)
    report = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for (dash, state), panels in groups.items():
            title = panels[0]["dashboardTitle"]
            html = page_html(title, panels[0]["stateLabel"], panels, panels[0].get("controls"))
            page_file = ROOT / "preview" / f"_page_{dash}_{state}.html"
            page_file.write_text(html)
            page = await browser.new_page(viewport={"width": CANVAS_W, "height": 900}, device_scale_factor=1.5)
            msgs = []
            page.on("console", lambda m: msgs.append(m.text))
            page.on("pageerror", lambda e: msgs.append("PAGEERROR " + str(e)))
            await page.goto(page_file.as_uri())
            texts = {pp["resolved"]: json.loads(pathlib.Path(pp["resolved"]).read_text()) for pp in panels}
            results = await page.evaluate("t => window.renderAll(t)", texts)
            await page.wait_for_timeout(300)
            png = OUT / f"{dash}.{state}.png"
            await page.screenshot(path=str(png), full_page=True)
            if not CHECK_ONLY:
                publish(png, f"{page_name(dash, state)}.png")
            # one PNG per visual, cropped to its panel at the render's 1.5x scale
            pdir = PREVIEWS / "visuals"
            pdir.mkdir(parents=True, exist_ok=True)
            for i, pp in enumerate(panels if not CHECK_ONLY else []):
                el = await page.query_selector(f"#p{i}")
                target = await el.evaluate_handle("e => e.parentElement")
                await target.as_element().screenshot(path=str(pdir / f"{visual_name(dash, pp['panel'], state)}.png"))
            for r in results:
                r.pop("svg", None)
            report[f"{dash}.{state}"] = {"results": results, "console": msgs}
            page_file.unlink()
            bad = [r for r in results if not r["ok"] or r["warnings"]]
            print(f"{dash} [{state}] -> {png.name}  {len(results) - len([r for r in results if not r['ok']])}/{len(results)} rendered" + (f"  issues: {json.dumps(bad)[:1500]}" if bad else ""))
        await browser.close()
    (OUT / "render-report.json").write_text(json.dumps(report, indent=2))
    if not CHECK_ONLY:
        write_gallery()


asyncio.run(main())
