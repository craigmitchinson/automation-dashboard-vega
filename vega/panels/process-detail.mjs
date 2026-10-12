// Process detail: one process in depth. With no single process in the
// filters, the header panel is a chooser (click a tile to filter to it);
// once one process is selected every panel shows that process.
// React source: src/pages/ProcessDetail.tsx
import { C, FONT } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, timeChart, hbars, emptyNote, PAD } from "../lib/kit.mjs";
import { dailyBlock, spokeColours, spokeColorExpr, releasesBlock } from "../lib/blocks.mjs";
import { ctx, MAPPED } from "../lib/es.mjs";
import { processCatalogue, byProcess, addFilter } from "../lib/common.mjs";
import { vdiBlock } from "./capacity.mjs";
import { targetsBlock } from "../lib/blocks.mjs";

const ONE = "length(data('bp')) === 1";
const P = (f) => `(length(data('bp')) ? data('bp')[0].${f} : 0)`;
const pick = { name: "pick", on: [{ events: "@pd_tile0:click, @pd_tile1:click", update: addFilter("process.name", "datum.name") }] };

const header = () =>
  merge(processCatalogue(), spokeColours(), byProcess("bp", ["c", "a", "e", "cw", "ec", "h", "rw", "rh", "b", "sl", "ta", "f1", "fo"]), dailyBlock({ keys: ["a"] }), {
    signals: [
      pick,
      { name: "cols", value: 5 },
      { name: "tileW", update: `(width - ${2 * PAD} - (cols - 1) * 10) / cols` },
      { name: "tileH", value: 32 },
      { name: "secH", value: 26 },
    ],
    data: [
      {
        name: "worst",
        source: "bp",
        transform: [
          { type: "filter", expr: `!(${ONE}) && datum.a > 0` },
          { type: "formula", as: "rate", expr: "datum.e / datum.a" },
          { type: "collect", sort: { field: "rate", order: "descending" } },
          { type: "window", ops: ["row_number"], as: ["k"] },
          { type: "filter", expr: "datum.k <= 3" },
          { type: "formula", as: "x", expr: "(datum.k - 1)" },
          { type: "formula", as: "y", expr: "secH" },
        ],
      },
      {
        name: "tiles",
        source: "procs",
        transform: [
          { type: "lookup", from: "bp", key: "name", fields: ["name"], values: ["a"], as: ["a"] },
          { type: "filter", expr: `!(${ONE}) && isValid(datum.a)` },
          { type: "collect", sort: { field: ["spoke", "name"] } },
          { type: "window", ops: ["row_number"], groupby: ["spoke"], as: ["j"] },
          { type: "formula", as: "col", expr: "(datum.j - 1) % cols" },
          { type: "formula", as: "row", expr: "floor((datum.j - 1) / cols)" },
        ],
      },
      { name: "rowsPerGroup", source: "tiles", transform: [{ type: "aggregate", groupby: ["spoke"], ops: ["count"], as: ["n"] }, { type: "formula", as: "rows", expr: "ceil(datum.n / cols)" }, { type: "collect", sort: { field: "spoke" } }, { type: "window", ops: ["row_number", "sum"], fields: [null, "rows"], as: ["g", "cumRows"] }, { type: "formula", as: "prevRows", expr: "datum.cumRows - datum.rows" }] },
      {
        name: "tilesPos",
        source: "tiles",
        transform: [
          { type: "lookup", from: "rowsPerGroup", key: "spoke", fields: ["spoke"], values: ["g", "prevRows"], as: ["g", "prevRows"] },
          // section y = worst row block + per group: header + previous groups' rows
          { type: "formula", as: "y", expr: "(length(data('worst')) ? secH + tileH + 12 : 0) + datum.g * secH + ((datum.prevRows || 0) + datum.row) * (tileH + 6)" },
          { type: "formula", as: "x", expr: "datum.col" },
          { type: "formula", as: "badge", expr: "''" },
        ],
      },
      { name: "secs", source: "tilesPos", transform: [{ type: "aggregate", groupby: ["spoke"], ops: ["min"], fields: ["y"], as: ["y"] }] },
      {
        name: "worstPos",
        source: "worst",
        transform: [
          { type: "lookup", from: "procs", key: "name", fields: ["name"], values: ["queue", "spokeColor"], as: ["queue", "spokeColor"] },
          { type: "formula", as: "badge", expr: F.pct("datum.rate") },
        ],
      },
    ],
    marks: [
      // ---- chooser -------------------------------------------------------------
      { type: "text", encode: { update: { x: { value: PAD }, y: { value: PAD }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 11 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { value: "CHOOSE A PROCESS" }, opacity: { signal: `${ONE} ? 0 : 1` } } } },
      { type: "text", encode: { update: { x: { value: PAD + 132 }, y: { value: PAD + 1 }, baseline: { value: "top" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.inkSoft }, text: { value: "Click a tile, or pick one in the Process control above" }, opacity: { signal: `${ONE} ? 0 : 1` } } } },
      { type: "text", encode: { update: { x: { value: PAD }, y: { value: 44 + 12 }, font: { value: FONT.mono }, fontSize: { value: 11 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { signal: `!(${ONE}) && length(data('worst')) ? 'NEEDS ATTENTION · HIGHEST EXCEPTION RATE' : ''` } } } },
      {
        type: "group",
        from: { data: "secs" },
        encode: { update: { x: { value: PAD }, y: { signal: "44 + datum.y - secH + 6" }, width: { value: 400 }, height: { value: 20 } } },
        marks: [
          { type: "rect", encode: { update: { x: { value: 0 }, y: { value: 6 }, width: { value: 11 }, height: { value: 11 }, cornerRadius: { value: 3 }, fill: { signal: spokeColorExpr("parent.spoke") } } } },
          { type: "text", encode: { update: { x: { value: 18 }, y: { value: 12 }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 11 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { signal: "upper(parent.spoke)" } } } },
        ],
      },
      ...["worstPos", "tilesPos"].map((src, si) => ({
        type: "group",
        name: `pd_tile${si}`,
        from: { data: src },
        encode: {
          update: {
            x: { signal: `${PAD} + datum.x * (tileW + 10)` },
            y: { signal: "44 + datum.y" },
            width: { signal: "tileW" },
            height: { signal: "tileH" },
            fill: { value: C.band },
            stroke: { value: C.rule },
            cornerRadius: { value: 10 },
            cursor: { value: "pointer" },
          },
          hover: { fill: { value: C.track } },
        },
        marks: [
          { type: "rect", encode: { update: { x: { value: 0 }, y: { value: 0 }, width: { value: 3 }, height: { signal: "tileH" }, fill: { signal: `parent.badge ? '${C.bad}' : parent.spokeColor` }, cornerRadiusTopLeft: { value: 10 }, cornerRadiusBottomLeft: { value: 10 } } } },
          { type: "text", encode: { update: { x: { value: 12 }, y: { signal: "tileH / 2" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { field: { parent: "name" } }, limit: { signal: "tileW - (parent.badge ? 70 : 20)" }, tooltip: { signal: "parent.spoke + ' · ' + parent.queue" } } } },
          { type: "text", encode: { update: { x: { signal: "tileW - 10" }, y: { signal: "tileH / 2" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 11 }, fontWeight: { value: 600 }, fill: { value: C.bad }, text: { field: { parent: "badge" } } } } },
        ],
      })),
      // ---- selected process: banner + KPIs -------------------------------------------
      {
        type: "group",
        encode: { update: { clip: { value: true }, x: { value: PAD }, y: { value: PAD }, width: { signal: `width - ${2 * PAD}` }, height: { signal: `${ONE} ? 66 : 0` }, fill: { value: C.band }, stroke: { signal: `${ONE} ? '${C.rule}' : null` }, cornerRadius: { value: 14 } } },
        marks: [
          { type: "rect", encode: { update: { x: { value: 0 }, y: { value: 0 }, width: { value: 4 }, height: { value: 66 }, fill: { signal: spokeColorExpr(P("spoke")) }, cornerRadiusTopLeft: { value: 14 }, cornerRadiusBottomLeft: { value: 12 } } } },
          { type: "text", encode: { update: { x: { value: 16 }, y: { value: 30 }, font: { value: FONT.display }, fontSize: { value: 20 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { signal: `${P("name")} + '  '` } } } },
          {
            type: "text",
            encode: {
              update: {
                x: { value: 16 },
                y: { value: 50 },
                font: { value: FONT.mono },
                fontSize: { value: 11 },
                fill: { value: C.inkSoft },
                text: { signal: `${P("spoke")} + ' · ' + ${P("proposition")} + ' · ' + (length(data('bp')) && data('bp')[0].ref ? data('bp')[0].ref.queues + ' · ' + data('bp')[0].ref.acronym : '')` },
              },
            },
          },
          {
            type: "text",
            encode: {
              update: {
                x: { signal: "item.mark.group.width - 16" },
                y: { value: 37 },
                align: { value: "right" },
                font: { value: FONT.mono },
                fontSize: { value: 10 },
                fill: { value: C.inkSoft },
                text: { signal: "length(data('bp')) && data('bp')[0].ref ? upper(join(data('bp')[0].ref.tags, '  ·  ')) : ''" },
              },
            },
          },
        ],
      },
      {
        type: "group",
        encode: { update: { clip: { value: true }, x: { value: PAD }, y: { value: PAD + 78 }, width: { signal: `width - ${2 * PAD}` }, height: { signal: `${ONE} ? height - ${2 * PAD} - 78 : 0` } } },
        signals: [{ name: "kw", update: `(width - ${2 * PAD} - 4 * 12) / 5` }, { name: "kh", update: "clamp((height - 12) / 2, 90, 140)" }],
        data: [
          {
            name: "pk",
            values: [
              { i: 0, label: "COMPLETED", accent: C.completed },
              { i: 1, label: "EXCEPTIONS", accent: C.system },
              { i: 2, label: "COMPLETION RATE", accent: C.good },
              { i: 3, label: "AVG CYCLE TIME", accent: C.business },
              { i: 4, label: "ESTATE COST", accent: C.ink },
              { i: 5, label: "WITHIN SLA" },
              { i: 6, label: "TURNAROUND" },
              { i: 7, label: "FIRST-TIME SUCCESS" },
              { i: 8, label: "REWORK EXPOSURE (MAX)" },
              { i: 9, label: "HANDED BACK" },
            ],
            transform: [
              { type: "formula", as: "turn", expr: `${P("a")} ? ${P("ta")} / ${P("a")} : 0` },
              {
                type: "formula",
                as: "value",
                expr: `[${F.compact(P("c"))}, ${F.compact(P("e"))}, ${F.pct(`${P("a")} ? ${P("c")} / ${P("a")} : 0`)}, round(${P("c")} ? ${P("cw")} / ${P("c")} : 0) + 's', ${F.gbp(P("ec"))}, ${F.pct(`${P("c")} ? ${P("sl")} / ${P("c")} : 0`)}, (datum.turn < 3600 ? round(datum.turn / 60) + ' min' : format(datum.turn / 3600, '.1f') + ' h'), ${F.pct(`${P("f1")} ? ${P("fo")} / ${P("f1")} : 0`)}, ${F.gbp(P("rw"))}, format(${P("rh")} * (${P("b")} / max(1, ${P("e")})) / max(1, ndays), '.1f') + ' h/day'][datum.i]`,
              },
              {
                type: "formula",
                as: "sub",
                expr: `['items', ${F.pct(`${P("a")} ? ${P("e")} / ${P("a")} : 0`)} + ' of attempts', 'straight-through', 'bot runtime per completed item', ${F.money2(`${P("c")} ? ${P("ec")} / ${P("c")} : 0`)} + ' / completed item', 'SLA ' + (length(data('bp')) && data('bp')[0].ref ? data('bp')[0].ref.slaHours : 24) + ' h from loaded', 'loaded to outcome, average', 'first attempts that completed', 'full manual time per exception', 'business exceptions to colleagues'][datum.i]`,
              },
            ],
          },
        ],
        marks: [
          {
            type: "group",
            from: { data: "pk" },
            encode: { update: { x: { signal: "(datum.i % 5) * (kw + 12)" }, y: { signal: "floor(datum.i / 5) * (kh + 12)" }, width: { signal: "kw" }, height: { signal: "kh" }, fill: { value: C.paper }, stroke: { value: C.rule }, cornerRadius: { value: 16 } } },
            marks: [
              { type: "text", encode: { update: { x: { value: 16 }, y: { value: 16 }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { field: { parent: "label" } } } } },
              { type: "text", encode: { update: { x: { value: 16 }, y: { value: 32 }, baseline: { value: "top" }, font: { value: FONT.display }, fontSize: { value: 26 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { field: { parent: "value" } } } } },
              { type: "text", encode: { update: { x: { value: 16 }, y: { value: 78 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 11.5 }, fill: { value: C.inkSoft }, text: { field: { parent: "sub" } }, limit: { signal: "kw - 28" } } } },
            ],
          },
        ],
      },
    ],
  });

const needOne = emptyNote(`!(${ONE})`, "Pick a single process (click a tile above, or use the Process control).");

const dailyFlow = () =>
  merge(
    processCatalogue(),
    byProcess("bp", ["a"]),
    dailyBlock({ keys: ["c", "b", "s"] }),
    releasesBlock(`!datum.process || (length(data('bp')) === 1 && datum.process === data('bp')[0].name)`),
    frame({ title: "Daily flow", subtitle: "Outcomes for this process over the period · ◆ marks a release or change", legend: [{ label: "Completed", color: C.completed }, { label: "Business", color: C.business }, { label: "System", color: C.system }], legendBelow: true }),
    { data: [{ name: "pseries", source: "series", transform: [{ type: "filter", expr: ONE }] }] },
    timeChart({ data: "pseries", markers: "rel", weekends: true, visible: ONE, series: [{ field: "c", name: "Completed", color: C.completed, area: true }, { field: "b", name: "Business exception", color: C.business }, { field: "s", name: "System exception", color: C.system }] }),
    { marks: [needOne] },
  );

const topExceptions = () =>
  merge(
    processCatalogue(),
    byProcess("bp", ["a", "rw"]),
    frame({ title: "Top exceptions", subtitleSignal: `${ONE} ? 'By volume for this process · ' + ${F.gbp(P("rw"))} + ' rework exposure (period)' : 'By volume for the chosen process'` }),
    {
      data: [
        ctx("te_raw", { body: { aggs: { m: { filter: { bool: { filter: [MAPPED, { term: { outcome: "Exception" } }] } }, aggs: { r: { terms: { field: "exception.reason_display", size: 7 }, aggs: { t: { terms: { field: "exception.type", size: 1 } } } } } } } }, property: "aggregations.m.r.buckets" }),
        {
          name: "te",
          source: "te_raw",
          transform: [
            { type: "filter", expr: ONE },
            { type: "formula", as: "label", expr: "datum.key" },
            { type: "formula", as: "value", expr: "datum.doc_count" },
            { type: "formula", as: "display", expr: F.compact("datum.doc_count") },
            { type: "formula", as: "color", expr: `datum.t.buckets[0].key === 'System' ? '${C.system}' : '${C.business}'` },
          ],
        },
      ],
      marks: [needOne],
    },
    hbars({ data: "te", labelW: 230, valueW: 40, rowH: 34, barH: 10, subInBar: false }),
  );

const workers = () =>
  merge(
    processCatalogue(),
    targetsBlock(),
    byProcess("bp", ["a"]),
    vdiBlock(),
    frame({ title: "Digital workers", subtitleSignal: `${P("spoke")} + ' machines that ran this process in the period'` }),
    {
      data: [
        {
          name: "wk",
          source: "vdis",
          transform: [
            { type: "filter", expr: `${ONE} && datum.cases > 0` },
            { type: "collect", sort: { field: "utilPct", order: "descending" } },
            { type: "window", ops: ["row_number"], as: ["k"] },
            { type: "filter", expr: "datum.k <= 8" },
          ],
        },
      ],
      marks: [
        needOne,
        {
          type: "group",
          from: { data: "wk" },
          encode: { update: { x: { value: PAD }, y: { signal: "top + (datum.k - 1) * 34" }, width: { signal: "cw" }, height: { value: 34 } } },
          marks: [
            { type: "rule", encode: { update: { x: { value: 0 }, x2: { signal: "cw" }, y: { value: 0 }, stroke: { value: C.rule }, opacity: { signal: "parent.k > 1 ? 1 : 0" } } } },
            { type: "text", encode: { update: { x: { value: 0 }, y: { value: 17 }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 12 }, fill: { value: C.ink }, text: { field: { parent: "name" } } } } },
            { type: "text", encode: { update: { x: { signal: "cw - 250" }, y: { value: 17 }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 12 }, fill: { value: C.inkSoft }, text: { signal: F.int("parent.cases") } } } },
            { type: "rect", encode: { update: { x: { signal: "cw - 230" }, y: { value: 10 }, width: { value: 140 }, height: { value: 14 }, cornerRadius: { value: 4 }, fill: { value: C.track } } } },
            { type: "rect", encode: { update: { x: { signal: "cw - 230" }, y: { value: 10 }, width: { signal: "max(3, 140 * parent.utilPct)" }, height: { value: 14 }, cornerRadius: { value: 4 }, fill: { value: C.ink } } } },
            { type: "text", encode: { update: { x: { signal: "cw" }, y: { value: 17 }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 12 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { signal: `${F.pct("parent.utilPct", 0)} + ' util'` } } } },
          ],
        },
      ],
    },
  );

const profile = () =>
  merge(processCatalogue(), byProcess("bp", ["a", "h"]), frame({ title: "Process profile", subtitle: "Team-owned configuration (ia-reference)" }), {
    signals: [{ name: "ref0", update: "length(data('bp')) && data('bp')[0].ref ? data('bp')[0].ref : null" }],
    marks: [
      needOne,
      ...[
        ["SMV: manual minutes per case (whole process)", "ref0 ? ref0.smv + ' min' : ''"],
        ["Automates against grade", "ref0 ? ref0.gradeName + ' (' + ref0.grade + ')' : ''"],
        ["Current grade rate", "ref0 ? '£' + format(ref0.rate, '.2f') + '/hr' : ''"],
        ["Colleague time released (period)", `${F.compact(P("h"))} + ' h'`],
      ].flatMap(([k, v], i) => [
        ...(i ? [{ type: "rule", encode: { update: { x: { value: PAD }, x2: { signal: `width - ${PAD}` }, y: { signal: `top + ${i * 34}` }, stroke: { value: C.rule }, opacity: { signal: `${ONE} ? 1 : 0` } } } }] : []),
        { type: "text", encode: { update: { x: { value: PAD + 2 }, y: { signal: `top + ${i * 34 + 17}` }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fill: { value: C.inkSoft }, text: { value: k }, opacity: { signal: `${ONE} ? 1 : 0` } } } },
        { type: "text", encode: { update: { x: { signal: `width - ${PAD}` }, y: { signal: `top + ${i * 34 + 17}` }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 12.5 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { signal: `${ONE} ? ${v} : ''` } } } },
      ]),
      { type: "rule", encode: { update: { x: { value: PAD }, x2: { signal: `width - ${PAD}` }, y: { signal: "top + 136" }, stroke: { value: C.rule }, opacity: { signal: `${ONE} ? 1 : 0` } } } },
      { type: "text", encode: { update: { x: { value: PAD + 2 }, y: { signal: "top + 152" }, font: { value: FONT.body }, fontSize: { value: 12.5 }, fill: { value: C.inkSoft }, text: { signal: `${ONE} ? 'What this process does' : ''` } } } },
      { type: "text", encode: { update: { x: { value: PAD + 2 }, y: { signal: "top + 172" }, font: { value: FONT.body }, fontSize: { value: 13 }, fill: { value: C.ink }, text: { signal: `${ONE} && ref0 ? ref0.description : ''` }, limit: { signal: "cw" } } } },
    ],
  });

export const dashboard = {
  id: "process-detail",
  title: "IA · Process detail",
  description: "One process in depth: pick it in the Process control or click a tile",
  time: { from: "now-89d/d", to: "now" },
  states: ["process"],
  panels: [
    { id: "header", title: "Process chooser / banner", grid: { x: 0, y: 0, w: 48, h: 16 }, build: header },
    { id: "daily-flow", title: "Daily flow", grid: { x: 0, y: 16, w: 29, h: 12 }, build: dailyFlow },
    { id: "top-exceptions", title: "Top exceptions", grid: { x: 29, y: 16, w: 19, h: 12 }, build: topExceptions },
    { id: "workers", title: "Digital workers", grid: { x: 0, y: 28, w: 24, h: 10 }, build: workers },
    { id: "profile", title: "Process profile", grid: { x: 24, y: 28, w: 24, h: 10 }, build: profile },
  ],
};
