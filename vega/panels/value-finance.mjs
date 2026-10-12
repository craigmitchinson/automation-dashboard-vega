// Value & Finance: net value, ROI, cost composition, unit economics with
// forecasts, spoke P&L and the process value league.
// React source: src/pages/ValueFinance.tsx (+ components/viz-finance.tsx, value-rules.ts)
import { C, FONT, IDX } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, kpiTiles, table, emptyNote, timeChart, segmented, PAD } from "../lib/kit.mjs";
import { bucketsOf, dailyBlock, T, targetsBlock, globalTarget, fyBlock, financeTargets, spokeColours, spokeColorExpr } from "../lib/blocks.mjs";
import { plain, wide, sums, WINDOW_AGG, DAY_MS } from "../lib/es.mjs";
import { workingTime, fteExpr, processCatalogue, byProcess, addFilter } from "../lib/common.mjs";
import { costPerCase, cumulative } from "./unit-economics.mjs";

const D = 86400000;
const NET = `(${T("cur_gb")} - ${T("cur_ec")})`;
const NETP = `(${T("prev_gb")} - ${T("prev_ec")})`;

const kpis = () => {
  const runRateNet = `(ndays ? ${NET} * 365.25 / ndays : 0)`;
  const roi = `(${T("cur_ec")} ? ${T("cur_gb")} / ${T("cur_ec")} : 0)`;
  const fte = fteExpr(T("cur_h"));
  const fteP = fteExpr(T("prev_h"));
  const cpc = `(${T("cur_c")} ? ${T("cur_ec")} / ${T("cur_c")} : 0)`;
  const cpcP = `(${T("prev_c")} ? ${T("prev_ec")} / ${T("prev_c")} : 0)`;
  return merge(dailyBlock({ keys: ["c", "h", "gb", "ec"] }), targetsBlock(), workingTime(), {
    data: [
      {
        name: "tiles",
        values: [
          { i: 0, label: "Net benefit (window)", accent: C.completed, deltaGood: "up" },
          { i: 1, label: "Annualised net (this window)", accent: C.good },
          { i: 2, label: "ROI", accent: C.business },
          { i: 3, label: "Colleague hours released", accent: C.system, deltaGood: "up" },
          { i: 4, label: "FTE released", accent: C.business, deltaGood: "up" },
          { i: 5, label: "Cost per item vs target", accent: C.accent, deltaGood: "down" },
        ],
        transform: [
          { type: "formula", as: "value", expr: `[${F.gbpc(NET)}, ${F.gbpc(runRateNet)}, ${T("cur_ec")} ? format(${roi}, '.1f') + '×' : '–', ${F.compact(T("cur_h"))} + ' h', format(${fte}, '.1f'), ${F.money2(cpc)}][datum.i]` },
          { type: "formula", as: "delta", expr: `[${NETP} ? (${NET} - ${NETP}) / abs(${NETP}) : null, null, null, ${T("prev_h")} ? (${T("cur_h")} - ${T("prev_h")}) / ${T("prev_h")} : null, ${fteP} ? (${fte} - ${fteP}) / abs(${fteP}) : null, ${cpcP} ? (${cpc} - ${cpcP}) / ${cpcP} : null][datum.i]` },
          { type: "formula", as: "sub", expr: "['vs prev. period', 'net × 365.25 / window days', 'benefit per £1 spent', 'vs prev. period', 'colleague FTE-equivalent', 'vs prev. period'][datum.i]" },
          { type: "formula", as: "target", expr: `datum.i === 5 ? '≤ ' + ${F.money2("tgt_costPerCase")} : ''` },
          { type: "formula", as: "met", expr: `${cpc} <= tgt_costPerCase` },
        ],
      },
    ],
  }, kpiTiles({ n: 6 }));
};

const attainment = () =>
  merge(
    dailyBlock({ keys: ["gb", "ec"] }),
    targetsBlock(),
    fyBlock(),
    financeTargets(),
    frame({ title: "FY target attainment", subtitleSignal: "'Fiscal-year-to-date net benefit, projected to year end at the year-to-date daily rate (the same projection as Executive Summary) · ' + fyLabel" }),
    {
      signals: [
        { name: "att", update: "isValid(estateTarget) && estateTarget ? projected / estateTarget : null" },
        { name: "onTrack", update: "isValid(estateTarget) ? projected >= estateTarget : false" },
      ],
      marks: [
        ...[
          ["FY-to-date net", F.gbpc("fytdNet"), `'${C.ink}'`, false],
          ["Projected FY-end", F.gbpc("projected"), `'${C.ink}'`, false],
          ["Prior FY to the same point", F.gbpc("pfytdNet"), `'${C.ink}'`, false],
          ["Annual target", F.gbpc("estateTarget"), `'${C.ink}'`, true],
          ["Projected vs target", `isValid(att) ? ${F.pct("att")} : '–'`, `isValid(att) ? (onTrack ? '${C.positive}' : '${C.bad}') : '${C.inkSoft}'`, true],
        ].flatMap(([k, v, col, needsTarget], i) => {
          const op = needsTarget ? { opacity: { signal: "isValid(estateTarget) ? 1 : 0" } } : {};
          return [
            { type: "text", encode: { update: { x: { signal: `${PAD} + ${i} * (cw / 5)` }, y: { signal: "top + 4" }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: k.toUpperCase() }, ...op } } },
            { type: "text", encode: { update: { x: { signal: `${PAD} + ${i} * (cw / 5)` }, y: { signal: "top + 20" }, baseline: { value: "top" }, font: { value: FONT.display }, fontSize: { value: 20 }, fontWeight: { value: 600 }, fill: { signal: col }, text: { signal: v }, ...op } } },
          ];
        }),
        {
          type: "text",
          encode: {
            update: {
              x: { value: PAD },
              y: { signal: "top + 60" },
              baseline: { value: "top" },
              font: { value: FONT.body },
              fontSize: { value: 12.5 },
              fill: { value: C.inkSoft },
              limit: { signal: "cw" },
              text: {
                signal: `(isValid(estateTarget) ? 'At the current run-rate the estate is projected to finish the year ' + (onTrack ? 'on track to meet' : 'behind') + ' its ' + ${F.gbpc("estateTarget")} + ' target. ' : 'No estate target is set yet, so attainment is hidden across the dashboards: add financeTargets to reference.json. ') + 'Projected ≈' + ${F.gbpc("projected")} + ' by year end at the year-to-date rate. Year to date is ' + ${F.gbpc("abs(fytdNet - pfytdNet)")} + (fytdNet >= pfytdNet ? ' ahead of' : ' behind') + ' the prior year at the same point.'`,
              },
            },
          },
        },
      ],
    },
  );

const waterfall = () =>
  merge(
    dailyBlock({ keys: ["gb", "ec", "cp", "ci"] }),
    frame({
      title: "Benefit waterfall",
      subtitle: "Gross benefit less the apportioned estate cost (Teams, Machines), reconciling to net benefit",
      legend: [
        { label: "Gross · Net", color: C.positive },
        { label: "Teams", color: C.teams },
        { label: "Machines (VDIs)", color: C.machines },
      ],
      legendBelow: true,
    }),
    {
      data: [
        plain("unatt_raw", {
          index: IDX.costDaily,
          body: { query: { bool: { filter: [{ range: { "@timestamp": { "%timefilter%": true } } }, { term: { estate_worktime_sec: 0 } }] } }, aggs: { t: { sum: { field: "total_gbp" } } } },
          property: "aggregations.t",
        }),
        {
          name: "steps",
          values: [
            { i: 0, label: "Gross" },
            { i: 1, label: "Teams" },
            { i: 2, label: "Machines (VDIs)" },
            { i: 3, label: "Net" },
            { i: 4, label: "Unattributed idle (memo)" },
          ],
          transform: [
            { type: "formula", as: "g", expr: T("cur_gb") },
            { type: "formula", as: "tm", expr: T("cur_cp") },
            { type: "formula", as: "mc", expr: T("cur_ci") },
            { type: "formula", as: "un", expr: "length(data('unatt_raw')) ? data('unatt_raw')[0].value : 0" },
            { type: "formula", as: "y0", expr: "[0, datum.g, datum.g - datum.tm, 0, 0][datum.i]" },
            { type: "formula", as: "y1", expr: "[datum.g, datum.g - datum.tm, datum.g - datum.tm - datum.mc, datum.g - datum.tm - datum.mc, -datum.un][datum.i]" },
            { type: "formula", as: "v", expr: "[datum.g, -datum.tm, -datum.mc, datum.g - datum.tm - datum.mc, -datum.un][datum.i]" },
            { type: "formula", as: "col", expr: `[datum.g >= 0 ? '${C.positive}' : '${C.accent}', '${C.teams}', '${C.machines}', datum.y1 >= 0 ? '${C.positive}' : '${C.accent}', '${C.unattributed}'][datum.i]` },
            { type: "formula", as: "pct", expr: "datum.i === 1 || datum.i === 2 ? (datum.g ? -datum.v / datum.g : 0) : null" },
            // the idle-pool memo only earns its place when there is some
            { type: "filter", expr: "datum.i < 4 || datum.un >= 1" },
          ],
        },
      ],
      scales: [
        { name: "wx", type: "band", domain: { data: "steps", field: "label", sort: { field: "i", op: "min" } }, range: [0, { signal: "cw" }], paddingInner: 0.12, paddingOuter: 0.05 },
        { name: "wy", type: "linear", domain: { fields: [{ data: "steps", field: "y0" }, { data: "steps", field: "y1" }] }, range: [{ signal: "ch - 70" }, 30], nice: true, zero: true },
      ],
      marks: [
        {
          type: "group",
          encode: { update: { x: { value: PAD }, y: { signal: "top" }, width: { signal: "cw" }, height: { signal: "ch" } } },
          marks: [
            { type: "rule", encode: { update: { x: { value: 0 }, x2: { signal: "cw" }, y: { scale: "wy", value: 0 }, stroke: { value: C.inkSoft } } } },
            {
              type: "rect",
              from: { data: "steps" },
              encode: {
                update: {
                  x: { scale: "wx", field: "label" },
                  width: { scale: "wx", band: 1 },
                  y: { scale: "wy", field: "y0" },
                  y2: { signal: "abs(scale('wy', datum.y1) - scale('wy', datum.y0)) < 3 ? scale('wy', datum.y0) + (datum.y1 < datum.y0 ? 3 : -3) : scale('wy', datum.y1)" },
                  fill: { field: "col" },
                  fillOpacity: { signal: "datum.i === 4 ? 0.35 : 1" },
                  stroke: { signal: `datum.i === 4 ? '${C.unattributed}' : null` },
                  strokeDash: { value: [3, 2] },
                  cornerRadius: { value: 2 },
                  tooltip: { signal: `{'Step': datum.label, 'Value': ${F.gbp("datum.v")}}` },
                },
              },
            },
            {
              type: "text",
              from: { data: "steps" },
              encode: {
                update: {
                  x: { scale: "wx", field: "label", band: 0.5 },
                  y: { signal: "min(scale('wy', datum.y0), scale('wy', datum.y1)) - 6" },
                  align: { value: "center" },
                  font: { value: FONT.mono },
                  fontSize: { value: 12 },
                  fontWeight: { value: 600 },
                  fill: { value: C.ink },
                  text: { signal: `${F.gbpc("datum.v")} + (datum.i === 4 ? ' (memo)' : '')` },
                },
              },
            },
            {
              type: "text",
              from: { data: "steps" },
              encode: {
                update: {
                  x: { scale: "wx", field: "label", band: 0.5 },
                  y: { signal: "max(scale('wy', datum.y0), scale('wy', datum.y1)) + 14" },
                  align: { value: "center" },
                  font: { value: FONT.mono },
                  fontSize: { value: 10 },
                  fill: { value: C.inkSoft },
                  text: { signal: `isValid(datum.pct) ? format(datum.pct * 100, '.1f') + '% of gross' : ''` },
                },
              },
            },
            {
              type: "text",
              from: { data: "steps" },
              encode: { update: { x: { scale: "wx", field: "label", band: 0.5 }, y: { signal: "ch - 40" }, align: { value: "center" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fill: { value: C.inkSoft }, text: { field: "label" }, limit: { signal: "bandwidth('wx')" } } },
            },
            {
              type: "text",
              encode: { update: { x: { value: 0 }, y: { signal: "ch - 6" }, font: { value: FONT.body }, fontSize: { value: 11.5 }, fill: { value: C.inkSoft }, text: { value: "The CoE's shared costs are spread across all work by bot time; each spoke's own costs across just that spoke's work." }, limit: { signal: "cw" } } },
            },
          ],
        },
      ],
    },
  );

const monthlyTrend = () =>
  merge(
    dailyBlock({ keys: ["gb", "ec", "cp", "ci"] }),
    targetsBlock(),
    fyBlock(),
    frame({
      title: "Monthly value trend",
      subtitle: "Stamped people and machine cost per month, with net benefit; the last month is to date",
      legend: [
        { label: "Teams", color: C.teams },
        { label: "Machines (VDIs)", color: C.machines },
        { label: "Net", color: C.netLine },
      ],
      legendBelow: true,
    }),
    {
      data: [
        {
          name: "mon",
          source: "series",
          transform: [
            { type: "formula", as: "m", expr: "utc(utcyear(datum.t), utcmonth(datum.t), 1)" },
            { type: "aggregate", groupby: ["m"], ops: ["sum", "sum", "sum", "sum"], fields: ["gb", "ec", "cp", "ci"], as: ["gb", "ec", "teams", "mach"] },
            { type: "formula", as: "net", expr: "datum.gb - datum.ec" },
            { type: "collect", sort: { field: "m" } },
          ],
        },
      ],
      scales: [
        { name: "mx", type: "band", domain: { data: "mon", field: "m", sort: true }, range: [0, { signal: "cw - 56" }], paddingInner: 0.4, paddingOuter: 0.2 },
        { name: "my", type: "linear", domain: { fields: [{ data: "mon", field: "ec" }, { data: "mon", field: "net" }] }, range: [{ signal: "ch - 46" }, 0], nice: true, zero: true },
      ],
      marks: [
        {
          type: "group",
          encode: { update: { x: { signal: `${PAD} + 56` }, y: { signal: "top + 4" }, width: { signal: "cw - 56" }, height: { signal: "ch - 46" } } },
          axes: [
            { scale: "my", orient: "left", grid: true, tickCount: 5, labelPadding: 8, encode: { labels: { update: { text: { signal: F.gbpc("datum.value") } } } } },
            { scale: "mx", orient: "bottom", labelPadding: 6, encode: { labels: { update: { text: { signal: F.month("datum.value") } } } } },
          ],
          marks: [
            { type: "rect", from: { data: "mon" }, encode: { update: { x: { scale: "mx", field: "m" }, width: { scale: "mx", band: 1 }, y: { scale: "my", field: "teams" }, y2: { scale: "my", value: 0 }, fill: { value: C.teams }, tooltip: { signal: `{'Month': ${F.month("datum.m")}, 'Teams': ${F.gbp("datum.teams")}, 'Machines': ${F.gbp("datum.mach")}, 'Net': ${F.gbp("datum.net")}}` } } } },
            { type: "rect", from: { data: "mon" }, encode: { update: { x: { scale: "mx", field: "m" }, width: { scale: "mx", band: 1 }, y: { scale: "my", signal: "datum.teams + datum.mach" }, y2: { scale: "my", field: "teams" }, fill: { value: C.machines } } } },
            { type: "line", from: { data: "mon" }, encode: { update: { x: { scale: "mx", field: "m", band: 0.5 }, y: { scale: "my", field: "net" }, stroke: { value: C.netLine }, strokeWidth: { value: 2 } } } },
            { type: "symbol", from: { data: "mon" }, encode: { update: { x: { scale: "mx", field: "m", band: 0.5 }, y: { scale: "my", field: "net" }, size: { value: 30 }, fill: { value: C.paper }, stroke: { value: C.netLine }, strokeWidth: { value: 1.5 } } } },
          ],
        },
        {
          type: "text",
          encode: {
            update: {
              x: { value: PAD },
              y: { signal: "height - 18" },
              font: { value: FONT.body },
              fontSize: { value: 12 },
              fill: { value: C.inkSoft },
              text: { signal: `'FYTD (since ' + ${F.day("fyStart")} + '): ' + ${F.gbpc("fytdNet")} + ' net, ' + (fytdNet > 0 && pfytdNet > 0 ? (fytdNet >= pfytdNet ? 'up ' : 'down ') + format(abs((fytdNet - pfytdNet) / pfytdNet) * 100, '.1f') + '% on the prior FYTD' : (fytdNet >= pfytdNet ? 'improved from ' : 'worsened from ') + ${F.gbpc("pfytdNet")} + ' at the same point last year')` },
            },
          },
        },
      ],
    },
  );

// Per-spoke daily figures over the long window: window totals, FYTD and a
// 12-week trend all come from the one query.
function spokeDaily() {
  return {
    data: [
      wide("sd_raw", {
        body: { aggs: { s: { terms: { field: "spoke.name", size: 50 }, aggs: { d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: sums("gb", "ec", "cp", "ci", "c") } } } } },
        property: "aggregations.s.buckets",
      }),
      {
        name: "sd",
        source: "sd_raw",
        transform: [
          { type: "flatten", fields: ["d.buckets"], as: ["bk"] },
          { type: "formula", as: "spoke", expr: "datum.key" },
          { type: "formula", as: "t", expr: "datum.bk.key" },
          ...["gb", "ec", "cp", "ci", "c"].map((k) => ({ type: "formula", as: k, expr: `datum.bk.${k}.value` })),
          { type: "project", fields: ["spoke", "t", "gb", "ec", "cp", "ci", "c"] },
        ],
      },
    ],
  };
}

const spokePL = () =>
  merge(
    dailyBlock({ keys: ["gb", "ec"] }),
    targetsBlock(),
    fyBlock(),
    financeTargets(),
    spokeColours(),
    spokeDaily(),
    frame({ title: "Spoke P&L", subtitleSignal: "'Gross benefit, apportioned cost and margin by spoke, data through ' + utcFormat(hi, '%Y-%m-%d') + ' · click a heading to sort'" }),
    {
      data: [
        {
          name: "pl",
          source: "sd",
          transform: [
            ...["gb", "ec", "cp", "ci", "c"].map((k) => ({ type: "formula", as: `w_${k}`, expr: `datum.t >= lo && datum.t <= hi ? datum.${k} : 0` })),
            { type: "formula", as: "fy", expr: "datum.t >= fyStart && datum.t <= hi ? datum.gb - datum.ec : 0" },
            { type: "aggregate", groupby: ["spoke"], ops: ["sum", "sum", "sum", "sum", "sum", "sum"], fields: ["w_gb", "w_ec", "w_cp", "w_ci", "w_c", "fy"], as: ["gross", "cost", "people", "infra", "completed", "fytd"] },
            { type: "filter", expr: "datum.gross !== 0 || datum.cost !== 0" },
            { type: "formula", as: "net", expr: "datum.gross - datum.cost" },
            { type: "formula", as: "margin", expr: "datum.gross ? datum.net / datum.gross : 0" },
            { type: "formula", as: "cpc", expr: "datum.completed ? datum.cost / datum.completed : 0" },
            { type: "lookup", from: "ftg", key: "spoke", fields: ["spoke"], values: ["target"], as: ["target"] },
            { type: "formula", as: "vsTarget", expr: "isValid(datum.target) && datum.target ? datum.fytd / datum.target : null" },
          ],
        },
        { name: "pltot", source: "pl", transform: [{ type: "aggregate", ops: ["sum", "sum", "sum", "sum", "sum", "sum"], fields: ["gross", "people", "infra", "cost", "net", "completed"], as: ["gross", "people", "infra", "cost", "net", "completed"] }] },
      ],
    },
    table({
      data: "pl",
      name: "pl",
      rowH: 32,
      sort: { key: "net", dir: "descending" },
      columns: [
        { label: "Spoke", sortKey: "spoke", text: "datum.spoke", swatch: spokeColorExpr("datum.spoke") },
        { label: "Gross", sortKey: "gross", w: 100, align: "right", text: F.gbpc("datum.gross") },
        { label: "People cost", sortKey: "people", w: 110, align: "right", text: F.gbpc("datum.people") },
        { label: "Infra cost", sortKey: "infra", w: 100, align: "right", text: F.gbpc("datum.infra") },
        { label: "Net", sortKey: "net", w: 100, align: "right", bold: true, text: F.gbpc("datum.net"), color: `datum.net < 0 ? '${C.bad}' : '${C.ink}'` },
        { label: "Margin %", sortKey: "margin", w: 90, align: "right", text: F.pct("datum.margin") },
        { label: "Cost/item", sortKey: "cpc", w: 90, align: "right", text: F.money2("datum.cpc") },
        { label: "Items", sortKey: "completed", w: 100, align: "right", text: F.int("datum.completed") },
        { label: "FYTD", labelExpr: "length(data('ftg')) ? 'vs target (FYTD)' : 'FYTD net'", sortKey: "fytd", w: 130, align: "right", text: `length(data('ftg')) ? (isValid(datum.vsTarget) ? ${F.pct("datum.vsTarget")} : '–') : ${F.gbpc("datum.fytd")}` },
        { label: "12-week trend", w: 120, align: "right", text: "''" },
      ],
      totals: [
        "'Total'",
        F.gbpc("data('pltot')[0].gross"),
        F.gbpc("data('pltot')[0].people"),
        F.gbpc("data('pltot')[0].infra"),
        F.gbpc("data('pltot')[0].net"),
        "data('pltot')[0].gross ? format(data('pltot')[0].net / data('pltot')[0].gross * 100, '.1f') + '%' : '–'",
        F.money2("data('pltot')[0].completed ? data('pltot')[0].cost / data('pltot')[0].completed : 0"),
        F.int("data('pltot')[0].completed"),
        "'–'",
        "''",
      ],
    }),
    {
      data: [
        {
          // 12 weekly net buckets over the 84 days ending "hi", per spoke
          name: "wk",
          source: "sd",
          transform: [
            { type: "filter", expr: `datum.t > hi - 84 * ${D} && datum.t <= hi` },
            { type: "formula", as: "w", expr: `min(11, max(0, floor((datum.t - (hi - 84 * ${D} + ${D})) / (7 * ${D}))))` },
            { type: "formula", as: "net", expr: "datum.gb - datum.ec" },
            { type: "aggregate", groupby: ["spoke", "w"], ops: ["sum"], fields: ["net"], as: ["net"] },
            { type: "lookup", from: "pl_rows", key: "spoke", fields: ["spoke"], values: ["rank"], as: ["rank"] },
            { type: "filter", expr: "isValid(datum.rank)" },
          ],
        },
      ],
      marks: [
        {
          type: "group",
          from: { facet: { data: "wk", name: "wkf", groupby: ["spoke", "rank"] } },
          encode: { update: { x: { signal: `${PAD} + cw - 110` }, y: { signal: "top + 30 + (datum.rank - 1) * pl_rh + pl_rh / 2 - 9" }, width: { value: 96 }, height: { value: 18 } } },
          signals: [{ name: "wkLast", update: "parent.spoke" }],
          scales: [
            { name: "kx", type: "linear", domain: [0, 11], range: [1, 95] },
            { name: "ky", type: "linear", domain: { data: "wkf", field: "net" }, range: [17, 1], zero: false },
          ],
          marks: [
            { type: "area", from: { data: "wkf" }, encode: { update: { x: { scale: "kx", field: "w" }, y: { scale: "ky", field: "net" }, y2: { value: 18 }, fill: { value: C.ink }, fillOpacity: { value: 0.1 } } } },
            { type: "line", from: { data: "wkf" }, encode: { update: { x: { scale: "kx", field: "w" }, y: { scale: "ky", field: "net" }, stroke: { value: C.ink }, strokeWidth: { value: 1.6 } } } },
          ],
        },
      ],
    },
  );

const league = () =>
  merge(
    processCatalogue(),
    byProcess("bp", ["gb", "ec"]),
    frame({ title: "Process value league", subtitle: "By net benefit; darker bars, above the dashed line, deliver 80% of it · right column is the running share" }),
    {
      data: [
        {
          name: "pos",
          source: "bp",
          transform: [
            { type: "formula", as: "net", expr: "datum.gb - datum.ec" },
            { type: "filter", expr: "datum.net > 0" },
            { type: "collect", sort: { field: "net", order: "descending" } },
            { type: "window", ops: ["row_number", "sum"], fields: [null, "net"], as: ["r", "cum"] },
          ],
        },
        { name: "postot", source: "pos", transform: [{ type: "aggregate", ops: ["sum", "count", "max"], fields: ["net", "net", "net"], as: ["total", "n", "top"] }] },
        { name: "thr", source: "pos", transform: [{ type: "filter", expr: "datum.cum - datum.net < 0.8 * posTotal" }, { type: "aggregate", ops: ["count"], as: ["k"] }] },
        {
          name: "shown",
          source: "pos",
          transform: [
            { type: "filter", expr: "datum.r * lgH <= ch - 24" },
            { type: "formula", as: "core", expr: "datum.r <= thrK" },
          ],
        },
      ],
      signals: [
        { name: "posTotal", update: "length(data('postot')) ? data('postot')[0].total : 0" },
        { name: "posTop", update: "length(data('postot')) ? data('postot')[0].top : 1" },
        { name: "posN", update: "length(data('postot')) ? data('postot')[0].n : 0" },
        { name: "thrK", update: "length(data('thr')) ? data('thr')[0].k : 0" },
        { name: "lgH", update: "clamp((ch - 24) / max(1, posN), 20, 32)" },
        { name: "lgLab", value: 190 },
        { name: "pick", on: [{ events: "@league_row:click", update: addFilter("process.name", "datum.name") }] },
      ],
      marks: [
        {
          type: "text",
          encode: { update: { x: { value: PAD }, y: { signal: "top" }, baseline: { value: "top" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.inkSoft }, text: { signal: "posN ? '80% of positive net comes from ' + thrK + ' of ' + posN + ' processes.' : 'No process delivers positive net benefit for these filters.'" } } },
        },
        {
          type: "group",
          name: "league_row",
          from: { data: "shown" },
          encode: {
            update: { x: { value: PAD }, y: { signal: "top + 24 + (datum.r - 1) * lgH" }, width: { signal: "cw" }, height: { signal: "lgH" }, fill: { value: "transparent" }, cursor: { value: "pointer" }, tooltip: { signal: `{'Process': datum.name, 'Net': ${F.gbp("datum.net")}, 'Cumulative share': ${F.pct("datum.cum / posTotal")}}` } },
            hover: { fill: { value: C.band } },
          },
          marks: [
            { type: "text", encode: { update: { x: { value: 0 }, y: { signal: "lgH / 2" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.ink }, text: { field: { parent: "name" } }, limit: { signal: "lgLab - 10" } } } },
            { type: "rect", encode: { update: { x: { signal: "lgLab" }, y: { signal: "lgH / 2 - 5" }, width: { signal: "max(2, (cw - lgLab - 140) * parent.net / posTop)" }, height: { value: 10 }, cornerRadius: { value: 5 }, fill: { signal: `parent.core ? '${C.accent}' : '${C.sage}'` } } } },
            { type: "text", encode: { update: { x: { signal: "cw - 64" }, y: { signal: "lgH / 2" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 11 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { signal: F.gbpc("parent.net") } } } },
            { type: "text", encode: { update: { x: { signal: "cw" }, y: { signal: "lgH / 2" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fill: { value: C.inkSoft }, text: { signal: F.pct("parent.cum / posTotal", 0) } } } },
          ],
        },
        // the 80% line, drawn under the last process inside it
        { type: "rule", encode: { update: { x: { value: PAD }, x2: { signal: `width - ${PAD}` }, y: { signal: "top + 24 + thrK * lgH" }, stroke: { value: C.bad }, strokeDash: { value: [4, 3] }, opacity: { signal: "thrK > 0 && thrK < posN ? 1 : 0" } } } },
      ],
    },
  );

const review = () =>
  merge(
    processCatalogue(),
    targetsBlock(),
    byProcess("bp", ["gb", "ec", "c", "rw"]),
    frame({ title: "Review candidates", subtitle: "Processes running at a net loss, worst first, with the reason" }),
    {
      data: [
        {
          name: "loss",
          source: "bp",
          transform: [
            { type: "formula", as: "net", expr: "datum.gb - datum.ec" },
            { type: "filter", expr: "datum.net < 0" },
            { type: "collect", sort: { field: "net" } },
            {
              // value-rules.ts classifyReviewCandidate, first match wins
              type: "formula",
              as: "why",
              expr: `datum.c < 30 ? 'Low volume: only ' + datum.c + ' completions this period, too few to amortise fixed cost.' : datum.rw > datum.ec * 0.3 ? 'High rework exposure: exceptions could cost more than 30% of this process\\'s automation spend.' : datum.ec / max(1, datum.c) > ${globalTarget("costPerCase")} * 1.5 ? 'High unit cost: £' + format(datum.c ? datum.ec / datum.c : datum.ec, '.2f') + '/item, over 1.5× the target cost per item (£' + format(${globalTarget("costPerCase")}, '.2f') + ').' : 'Cost exceeds benefit at the current volume and rate mix.'`,
            },
          ],
        },
      ],
      marks: [emptyNote("length(data('loss')) === 0", "No processes are running at a loss for the current filters.", { color: C.positive })],
    },
    {
      // one card per loss-maker: the reason in full, not a truncated column
      signals: [{ name: "rvH", update: "clamp((ch - 4) / max(1, length(data('loss'))), 64, 84)" }],
      data: [{ name: "loss_shown", source: "loss", transform: [{ type: "window", ops: ["row_number"], as: ["k"] }, { type: "filter", expr: "datum.k * rvH <= ch + 4" }] }],
      marks: [
        {
          type: "group",
          from: { data: "loss_shown" },
          encode: { update: { x: { value: PAD }, y: { signal: "top + (datum.k - 1) * rvH" }, width: { signal: "cw" }, height: { signal: "rvH - 8" } } },
          marks: [
            { type: "rule", encode: { update: { x: { value: 0 }, x2: { signal: "item.mark.group.width" }, y: { signal: "item.mark.group.height + 4" }, stroke: { value: C.rule } } } },
            { type: "text", encode: { update: { x: { value: 0 }, y: { value: 4 }, baseline: { value: "top" }, font: { value: FONT.display }, fontSize: { value: 15 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { field: { parent: "name" } }, limit: { signal: "item.mark.group.width - 120" } } } },
            { type: "text", encode: { update: { x: { signal: "item.mark.group.width" }, y: { value: 4 }, align: { value: "right" }, baseline: { value: "top" }, font: { value: FONT.display }, fontSize: { value: 15 }, fontWeight: { value: 600 }, fill: { value: C.bad }, text: { signal: F.gbpc("parent.net") } } } },
            { type: "text", encode: { update: { x: { value: 0 }, y: { value: 26 }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.inkSoft }, text: { signal: `'COST ' + ${F.gbpc("parent.ec")} + '  ·  ' + ${F.int("parent.c")} + ' ITEMS  ·  REWORK EXPOSURE ' + ${F.gbpc("parent.rw")}` } } } },
            { type: "text", encode: { update: { x: { value: 0 }, y: { value: 44 }, baseline: { value: "top" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.ink }, text: { field: { parent: "why" } }, limit: { signal: "item.mark.group.width" } } } },
          ],
        },
        { type: "text", encode: { update: { x: { signal: `width - ${PAD}` }, y: { signal: "height - 10" }, align: { value: "right" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.inkSoft }, text: { signal: "length(data('loss')) > length(data('loss_shown')) ? '+' + (length(data('loss')) - length(data('loss_shown'))) + ' more' : ''" } } } },
      ],
    },
  );

// Colleague time: FTE released by completed work against FTE handed back by
// business exceptions (the human effort the bots return), week by week.
const fteTrend = () => {
  const seg = segmented({ signal: "fgrain", options: [{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }] });
  return merge(
    workingTime(),
    {
      data: [
        wide("ft_raw", {
          backDays: 0,
          body: { aggs: { ...WINDOW_AGG, d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: { ...sums("h"), biz: { filter: { term: { "n.business": 1 } }, aggs: sums("rh", "rw") } } } } },
          property: "aggregations",
        }),
        bucketsOf("ft_win", "ft_raw", "win.d.buckets"),
        bucketsOf("ft_d", "ft_raw", "d.buckets", { h: "h" }, [
          { type: "formula", as: "rh", expr: "datum._bk.biz.rh.value || 0" },
          { type: "formula", as: "rw", expr: "datum._bk.biz.rw.value || 0" },
        ]),
        {
          name: "ft",
          source: "ft_win",
          transform: [
            { type: "lookup", from: "ft_d", key: "key", fields: ["key"], values: ["h", "rh", "rw"], default: 0 },
            { type: "formula", as: "g", expr: `fgrain === 'monthly' ? utc(utcyear(datum.key), utcmonth(datum.key), 1) : datum.key - ((utcday(datum.key) + 6) % 7) * ${DAY_MS}` },
            { type: "aggregate", groupby: ["g"], ops: ["sum", "sum", "sum", "count"], fields: ["h", "rh", "rw", "key"], as: ["h", "rh", "rw", "days"] },
            { type: "formula", as: "t", expr: "datum.g" },
            { type: "formula", as: "fte", expr: fteExpr("datum.h", "datum.days") },
            { type: "formula", as: "fteBack", expr: fteExpr("datum.rh", "datum.days") },
            { type: "collect", sort: { field: "t" } },
          ],
        },
        { name: "ft_tot", source: "ft", transform: [{ type: "aggregate", ops: ["sum", "sum", "sum", "sum"], fields: ["h", "rh", "rw", "days"], as: ["h", "rh", "rw", "days"] }] },
      ],
      signals: [
        { name: "fgrain", value: "weekly", on: seg.on },
        { name: "ftT", update: "length(data('ft_tot')) ? data('ft_tot')[0] : {h: 0, rh: 0, rw: 0, days: 0}" },
      ],
      marks: seg.marks,
    },
    frame({
      title: "Colleague time",
      subtitleSignal: `format(${fteExpr("ftT.h", "ftT.days")}, '.1f') + ' FTE released · ' + format(${fteExpr("ftT.rh", "ftT.days")}, '.1f') + ' FTE handed back by business exceptions, worth ' + ${F.moneyCompact("ftT.rw")}`,
      legend: [
        { label: "FTE released", color: C.good },
        { label: "FTE handed back", color: C.business },
      ],
      legendBelow: true,
    }),
    timeChart({
      data: "ft",
      name: "ftc",
      xFmt: (e) => `fgrain === 'monthly' ? ${F.month(e)} : ${F.day(e)}`,
      tipDateFmt: (e) => `fgrain === 'monthly' ? ${F.month(e)} : 'w/c ' + ${F.dayLong(e)}`,
      yFmt: (e) => `format(${e}, '.0f')`,
      tipFmt: (e) => `format(${e}, '.1f') + ' FTE'`,
      series: [
        { field: "fte", name: "FTE released", color: C.good, area: true },
        { field: "fteBack", name: "FTE handed back", color: C.business, area: true },
      ],
    }),
  );
};

export const dashboard = {
  id: "value-finance",
  title: "IA · Value & Finance",
  description: "Net value, ROI, cost composition, unit economics with forecasts, spoke P&L and process value",
  time: { from: "now-89d/d", to: "now" },
  panels: [
    { id: "kpis", title: "Value KPIs", grid: { x: 0, y: 0, w: 48, h: 5 }, build: kpis },
    { id: "attainment", title: "FY target attainment", grid: { x: 0, y: 5, w: 48, h: 5 }, build: attainment },
    { id: "waterfall", title: "Benefit waterfall", grid: { x: 0, y: 10, w: 24, h: 14 }, build: waterfall },
    { id: "monthly-trend", title: "Monthly value trend", grid: { x: 24, y: 10, w: 24, h: 14 }, build: monthlyTrend },
    { id: "cost-per-item", title: "Cost per completed item over time", grid: { x: 0, y: 24, w: 24, h: 14 }, build: costPerCase },
    { id: "cumulative", title: "Cumulative benefit vs cost", grid: { x: 24, y: 24, w: 24, h: 14 }, build: cumulative },
    { id: "fte", title: "Colleague time", grid: { x: 0, y: 38, w: 48, h: 11 }, build: fteTrend },
    { id: "spoke-pl", title: "Spoke P&L", grid: { x: 0, y: 49, w: 48, h: 15 }, build: spokePL },
    { id: "league", title: "Process value league", grid: { x: 0, y: 64, w: 24, h: 14 }, build: league },
    { id: "review", title: "Review candidates", grid: { x: 24, y: 64, w: 24, h: 14 }, build: review },
  ],
};
