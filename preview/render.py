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
CANVAS_W = 1560  # dashboard content width in px
COLS, ROW_H, MARGIN = 48, 20, 8
COL_W = (CANVAS_W - MARGIN * (COLS + 1)) / COLS

FONT_CSS = """
@font-face{font-family:Gelasio;font-weight:400;src:url(fonts/gelasio-400.woff2)}
@font-face{font-family:Gelasio;font-weight:700;src:url(fonts/gelasio-700.woff2)}
@font-face{font-family:Carlito;font-weight:400;src:url(fonts/carlito-400.woff2)}
@font-face{font-family:Carlito;font-weight:700;src:url(fonts/carlito-700.woff2)}
@font-face{font-family:'JetBrains Mono';font-weight:400;src:url(fonts/jetbrains-mono-400.woff2)}
@font-face{font-family:'JetBrains Mono';font-weight:700;src:url(fonts/jetbrains-mono-500.woff2)}
"""

NAV = ["Overview", "Alerts", "Service", "Input & Outcome", "Process Analysis", "Exceptions", "Process detail", "VDI & Capacity", "Executive Summary", "Value & Finance", "Commercial"]


def px(grid, y_offset):
    x = MARGIN + grid["x"] * (COL_W + MARGIN)
    y = MARGIN + (grid["y"] + y_offset) * (ROW_H + MARGIN)
    w = grid["w"] * COL_W + (grid["w"] - 1) * MARGIN
    h = grid["h"] * ROW_H + (grid["h"] - 1) * MARGIN
    return round(x), round(y), round(w), round(h)


def page_html(title, state_label, panels):
    y_off = 2  # nav strip rows, as in the saved dashboard
    divs, specs = [], []
    bottom = 0
    for i, p in enumerate(panels):
        x, y, w, h = px(p["grid"], y_off)
        bottom = max(bottom, y + h)
        divs.append(f'<div class="panel" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px"><div id="p{i}"></div></div>')
        specs.append({"id": f"p{i}", "w": w - 2, "h": h - 2, "file": p["resolved"], "name": p["panel"]})
    nx, ny, nw, nh = px({"x": 0, "y": 0, "w": 48, "h": 2}, 0)
    nav = " · ".join(f'<b>{n}</b>' if n == title.replace("IA · ", "") else n for n in NAV)
    controls = "".join(f'<span class="ctl"><i>{c}</i>Any</span>' for c in ["Spoke", "Proposition", "Process", "Queue", "Tags"])
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{FONT_CSS}
body{{margin:0;background:#F7F8FC;font-family:Inter,Carlito,sans-serif}}
.top{{height:46px;background:#fff;border-bottom:1px solid #D3DAE6;display:flex;align-items:center;padding:0 16px;gap:16px;font-size:14px;color:#343741}}
.top .t{{font-weight:700}} .top .s{{margin-left:auto;font-size:12px;color:#69707D}}
.ctls{{display:flex;gap:8px;padding:8px 8px 0 8px}} .ctl{{flex:1;background:#fff;border:1px solid #D3DAE6;border-radius:4px;font-size:12px;padding:6px 8px;color:#343741}} .ctl i{{font-style:normal;color:#69707D;margin-right:8px}}
.grid{{position:relative;width:{CANVAS_W}px;height:{bottom + MARGIN}px}}
.panel{{position:absolute;background:#fff;border:1px solid #D3DAE6;border-radius:6px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}}
.nav{{position:absolute;left:{nx}px;top:{ny}px;width:{nw}px;height:{nh}px;background:#fff;border:1px solid #D3DAE6;border-radius:6px;font-size:12px;display:flex;align-items:center;padding:0 12px;box-sizing:border-box;color:#006BB8}}
.nav b{{color:#343741}}
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
  await document.fonts.load('700 16px Gelasio'); await document.fonts.load('400 12px Carlito'); await document.fonts.load('700 12px Carlito');
  await document.fonts.load('400 11px "JetBrains Mono"'); await document.fonts.load('700 11px "JetBrains Mono"');
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


def publish(png, name):
    """Committed copy for docs/previews: 1600px wide."""
    from PIL import Image

    im = Image.open(png).convert("RGB")
    w, h = im.size
    im = im.resize((1600, round(h * 1600 / w)), Image.LANCZOS)
    out = ROOT / "docs" / "previews" / name
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
            html = page_html(title, panels[0]["stateLabel"], panels)
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
            publish(png, f"{dash}.{state}.png")
            if state == "default" or dash in ("process-detail",):
                svg_dir = ROOT / "docs" / "previews" / "svg" / dash
                svg_dir.mkdir(parents=True, exist_ok=True)
                for r in results:
                    if r.get("svg"):
                        (svg_dir / f"{r['panel']}.{state}.svg").write_text(r.pop("svg"))
            for r in results:
                r.pop("svg", None)
            report[f"{dash}.{state}"] = {"results": results, "console": msgs}
            page_file.unlink()
            bad = [r for r in results if not r["ok"] or r["warnings"]]
            print(f"{dash} [{state}] -> {png.name}  {len(results) - len([r for r in results if not r['ok']])}/{len(results)} rendered" + (f"  issues: {json.dumps(bad)[:1500]}" if bad else ""))
        await browser.close()
    (OUT / "render-report.json").write_text(json.dumps(report, indent=2))


asyncio.run(main())
