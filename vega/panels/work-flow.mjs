// Work in & out: what arrived, what was worked, what is still waiting, where
// it went (process, stage, outcome) and what it cost, by period. Covers the
// "work going in and coming out" requirements: cases and items, tabular and
// graphical trends, outcomes and the branching flow.
import { C, FONT, IDX } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, kpiTiles, timeChart, table, segmented, emptyNote, PAD } from "../lib/kit.mjs";
import { bucketsOf, T, releasesBlock } from "../lib/blocks.mjs";
import { ctx, tf, sums, MAPPED, WINDOW_AGG, DAY_MS } from "../lib/es.mjs";
import { processCatalogue, addFilter, workingTime, fteExpr } from "../lib/common.mjs";
import { at, rng, ctxBool } from "../lib/service.mjs";

const OUT_KEYS = ["c", "b", "s", "a", "cd", "ec", "h", "w"];
const BACK = -732;
const between = (field) => ({ range: { [field]: { gte: tf("min", BACK), lte: tf("max"), format: "epoch_millis" } } });

// One request for the whole page's in/out figures: items out by outcome day,
// items in by loaded day, and what was still waiting at the window's end.
// Signals: ndays, lo, hi, plo, phi, bEnd (waiting at the end of the window).
// Data: series (every window day: t, in, c, b, s, a, cd, ec, h, w, rhB, rwB),
//       tot (cur_/prev_ sums), plus the raw day lists.
function ioBlock() {
  const body = {
    size: 0,
    query: {
      bool: {
        must: ["%dashboard_context-must_clause%", MAPPED, { bool: { should: [between("@timestamp"), between("item.loaded_at")], minimum_should_match: 1 } }],
        filter: ["%dashboard_context-filter_clause%"],
        must_not: ["%dashboard_context-must_not_clause%"],
      },
    },
    aggs: {
      ...WINDOW_AGG,
      out: {
        filter: { bool: { filter: [{ term: { "n.attempt": 1 } }, between("@timestamp")] } },
        aggs: { d: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 1 }, aggs: { ...sums(...OUT_KEYS), biz: { filter: { term: { "n.business": 1 } }, aggs: sums("rh", "rw") } } } },
      },
      inn: { filter: between("item.loaded_at"), aggs: { d: { date_histogram: { field: "item.loaded_at", fixed_interval: "1d", min_doc_count: 1 } } } },
      // loaded by the window's end and not finished by then (still pending, or finished later)
      open: {
        filter: {
          bool: {
            filter: [{ range: { "item.loaded_at": { lte: tf("max"), format: "epoch_millis" } } }],
            should: [{ term: { "n.pending": 1 } }, { range: { "@timestamp": { gt: tf("max"), format: "epoch_millis" } } }],
            minimum_should_match: 1,
          },
        },
        aggs: { oldest: { min: { field: "item.loaded_at" } } },
      },
    },
  };
  const keys = ["in", ...OUT_KEYS, "rhB", "rwB"];
  return {
    signals: [
      { name: "ndays", update: "length(data('win'))" },
      { name: "lo", update: "ndays ? data('win')[0].key : 0" },
      { name: "hi", update: "ndays ? data('win')[ndays - 1].key : 0" },
      { name: "plo", update: `lo - ndays * ${DAY_MS}` },
      { name: "phi", update: `lo - ${DAY_MS}` },
      { name: "bEnd", update: "length(data('io_raw')) ? data('io_raw')[0].open.doc_count : 0" },
      { name: "bOldest", update: "length(data('io_raw')) ? data('io_raw')[0].open.oldest.value : null" },
    ],
    data: [
      { name: "io_raw", url: { index: IDX.items, body }, format: { property: "aggregations" } },
      bucketsOf("win", "io_raw", "win.d.buckets"),
      bucketsOf("outd", "io_raw", "out.d.buckets", Object.fromEntries(OUT_KEYS.map((k) => [k, k])), [
        { type: "formula", as: "rhB", expr: "datum._bk.biz.rh.value || 0" },
        { type: "formula", as: "rwB", expr: "datum._bk.biz.rw.value || 0" },
      ]),
      bucketsOf("ind", "io_raw", "inn.d.buckets"),
      {
        name: "alld",
        source: "outd",
        transform: [
          { type: "lookup", from: "ind", key: "key", fields: ["key"], values: ["n"], as: ["in"], default: 0 },
        ],
      },
      {
        name: "tot",
        source: "alld",
        transform: [
          ...keys.flatMap((k) => [
            { type: "formula", as: `cur_${k}`, expr: `datum.key >= lo && datum.key <= hi ? datum['${k}'] : 0` },
            { type: "formula", as: `prev_${k}`, expr: `datum.key >= plo && datum.key <= phi ? datum['${k}'] : 0` },
          ]),
          { type: "aggregate", ops: keys.flatMap(() => ["sum", "sum"]), fields: keys.flatMap((k) => [`cur_${k}`, `prev_${k}`]), as: keys.flatMap((k) => [`cur_${k}`, `prev_${k}`]) },
        ],
      },
      {
        name: "series",
        source: "win",
        transform: [
          { type: "lookup", from: "outd", key: "key", fields: ["key"], as: ["d"] },
          { type: "lookup", from: "ind", key: "key", fields: ["key"], values: ["n"], as: ["in"], default: 0 },
          { type: "formula", as: "t", expr: "datum.key" },
          ...[...OUT_KEYS, "rhB", "rwB"].map((k) => ({ type: "formula", as: k, expr: `datum.d ? datum.d['${k}'] : 0` })),
          { type: "collect", sort: { field: "t" } },
          // waiting at the end of each day, walking back from the window's end
          { type: "formula", as: "net", expr: "datum.in - datum.a" },
          { type: "window", sort: { field: "t" }, ops: ["sum"], fields: ["net"], as: ["cum"], frame: [null, 0] },
          { type: "joinaggregate", ops: ["sum"], fields: ["net"], as: ["netAll"] },
          { type: "formula", as: "backlog", expr: "max(0, bEnd - (datum.netAll - datum.cum))" },
        ],
      },
    ],
  };
}
// Daily, weekly or monthly groups of "series" as "grp": sums, the last day's
// backlog, and the number of window days in each group.
function grouped(signal) {
  const keys = ["in", ...OUT_KEYS, "rhB", "rwB"];
  return {
    data: [
      {
        name: "grp",
        source: "series",
        transform: [
          { type: "formula", as: "g", expr: `${signal} === 'monthly' ? utc(utcyear(datum.t), utcmonth(datum.t), 1) : ${signal} === 'weekly' ? datum.t - ((utcday(datum.t) + 6) % 7) * ${DAY_MS} : datum.t` },
          { type: "aggregate", groupby: ["g"], ops: [...keys.map(() => "sum"), "max", "count"], fields: [...keys, "t", "t"], as: [...keys, "lastT", "days"] },
          { type: "formula", as: "t", expr: "datum.g" },
          { type: "lookup", from: "series", key: "t", fields: ["lastT"], values: ["backlog"], as: ["backlog"], default: 0 },
          { type: "collect", sort: { field: "t" } },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
const kpis = () => {
  const cur = (k) => T(`cur_${k}`);
  const prev = (k) => T(`prev_${k}`);
  const delta = (c, p) => `(${p} ? (${c} - ${p}) / ${p} : null)`;
  const ratio = (a, b) => `(${b} ? ${a} / ${b} : null)`;
  return merge(
    ioBlock(),
    {
      data: [
        { name: "inTot", source: "ind", transform: [{ type: "formula", as: "c", expr: "datum.key >= lo && datum.key <= hi ? datum.n : 0" }, { type: "formula", as: "p", expr: "datum.key >= plo && datum.key <= phi ? datum.n : 0" }, { type: "aggregate", ops: ["sum", "sum"], fields: ["c", "p"], as: ["c", "p"] }] },
        {
          name: "tiles",
          values: [
            { i: 0, label: "Work in", deltaGood: "up" },
            { i: 1, label: "Work out", deltaGood: "up" },
            { i: 2, label: "Waiting at period end", deltaGood: "down" },
            { i: 3, label: "Cases completed", deltaGood: "up" },
            { i: 4, label: "Cost per completed item", deltaGood: "down" },
            { i: 5, label: "Cost per completed case", deltaGood: "down" },
          ],
          transform: [
            { type: "formula", as: "inC", expr: "length(data('inTot')) ? data('inTot')[0].c : 0" },
            { type: "formula", as: "inP", expr: "length(data('inTot')) ? data('inTot')[0].p : 0" },
            {
              type: "formula",
              as: "value",
              expr: `[${F.compact("datum.inC")}, ${F.compact(cur("a"))}, ${F.compact("bEnd")}, ${F.compact(cur("cd"))}, ${F.money2(ratio(cur("ec"), cur("c")))}, ${F.money2(ratio(cur("ec"), cur("cd")))}][datum.i]`,
            },
            {
              type: "formula",
              as: "delta",
              expr: `[${delta("datum.inC", "datum.inP")}, ${delta(cur("a"), prev("a"))}, null, ${delta(cur("cd"), prev("cd"))}, ${delta(ratio(cur("ec"), cur("c")), ratio(prev("ec"), prev("c")))}, ${delta(ratio(cur("ec"), cur("cd")), ratio(prev("ec"), prev("cd")))}][datum.i]`,
            },
            {
              type: "formula",
              as: "sub",
              expr:
                `['items loaded to the queues', ${F.int(cur("c"))} + ' completed, ' + ${F.int(cur("b") + " + " + cur("s"))} + ' exceptions',` +
                ` (datum.inC - ${cur("a")} >= 0 ? '+' : '') + ${F.int("datum.inC - " + cur("a"))} + ' over the period' + (isValid(bOldest) ? ', oldest ' + ${F.int(`(hi + ${DAY_MS} - bOldest) / ${DAY_MS}`)} + ' days' : ''),` +
                ` format(${cur("c")} / max(1, ${cur("cd")}), '.2f') + ' items per case', 'apportioned estate cost', 'cost of every item a case took'][datum.i]`,
            },
            { type: "formula", as: "target", expr: "''" },
            { type: "formula", as: "met", expr: "true" },
          ],
        },
      ],
    },
    kpiTiles({ n: 6 }),
  );
};

// ---------------------------------------------------------------------------
const inOut = () => {
  const seg = segmented({ signal: "view", options: [{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }] });
  const legend = [
    { label: "In (loaded)", color: C.accent, dashed: true },
    { label: "Completed", color: C.completed },
    { label: "Exceptions", color: C.system },
    { label: "Waiting", color: C.business },
  ];
  const fmtX = (e) => `view === 'monthly' ? ${F.month(e)} : ${F.day(e)}`;
  return merge(
    ioBlock(),
    releasesBlock(),
    frame({ title: "In and out", subtitleSignal: "(view === 'monthly' ? 'Items a month' : view === 'weekly' ? 'Items a week' : 'Items a day') + ': loaded against worked, and what was left waiting · ◆ a release or change'", legend, legendBelow: true }),
    { signals: [{ name: "view", value: "weekly", on: seg.on }, { name: "upH", update: "round(ch * 0.64)" }], marks: seg.marks },
    grouped("view"),
    { data: [{ name: "grp2", source: "grp", transform: [{ type: "formula", as: "e", expr: "datum.b + datum.s" }] }] },
    timeChart({
      data: "grp2",
      name: "io",
      height: "upH",
      markers: "rel",
      xFmt: fmtX,
      tipDateFmt: (e) => `view === 'monthly' ? ${F.month(e)} : view === 'weekly' ? 'w/c ' + ${F.dayLong(e)} : ${F.dayLong(e)}`,
      weekends: "view === 'daily'",
      series: [
        { field: "c", name: "Completed", color: C.completed, area: true },
        { field: "e", name: "Exceptions", color: C.system },
        { field: "in", name: "In (loaded)", color: C.accent, dashed: true },
      ],
    }),
    {
      marks: [
        { type: "text", encode: { update: { x: { value: PAD }, y: { signal: "top + upH + 8" }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { signal: "'WAITING AT THE END OF EACH ' + (view === 'monthly' ? 'MONTH' : view === 'weekly' ? 'WEEK' : 'DAY')" } } } },
      ],
    },
    timeChart({
      data: "grp2",
      name: "bk",
      top: "top + upH + 26",
      height: "ch - upH - 26",
      xFmt: fmtX,
      tipDateFmt: (e) => `view === 'monthly' ? ${F.month(e)} : view === 'weekly' ? 'w/c ' + ${F.dayLong(e)} : ${F.dayLong(e)}`,
      series: [{ field: "backlog", name: "Waiting", color: C.business, area: true }],
    }),
  );
};

// ---------------------------------------------------------------------------
// Process → queue (stage) → outcome, widths in items. Click a process to filter.
// Label y for stacked nodes, pushed down just enough not to overlap:
// ly_i = max over j <= i of (centre_j + (i - j) * step), via a running max.
const spread = (step) => [
  { type: "formula", as: "u", expr: `datum.y + datum.h / 2 - datum.idx * ${step}` },
  { type: "window", sort: { field: "idx" }, ops: ["max"], fields: ["u"], as: ["um"], frame: [null, 0] },
  { type: "formula", as: "ly", expr: `datum.um + datum.idx * ${step}` },
];
const flow = () => {
  const OUT = [
    { k: "c", label: "Completed", color: C.completed },
    { k: "b", label: "Business exception", color: C.business },
    { k: "s", label: "System exception", color: C.system },
    { k: "p", label: "Still waiting", color: C.inkMuted },
  ];
  const GAP = 6;
  const NW = 10;
  const band = (x0, ya, x1, yb, h) =>
    `'M' + ${x0} + ',' + ${ya} + 'C' + ((${x0} + ${x1}) / 2) + ',' + ${ya} + ' ' + ((${x0} + ${x1}) / 2) + ',' + ${yb} + ' ' + ${x1} + ',' + ${yb} + 'L' + ${x1} + ',' + (${yb} + ${h}) + 'C' + ((${x0} + ${x1}) / 2) + ',' + (${yb} + ${h}) + ' ' + ((${x0} + ${x1}) / 2) + ',' + (${ya} + ${h}) + ' ' + ${x0} + ',' + (${ya} + ${h}) + 'Z'`;
  const stackY = (src, name, sortField, extra = []) => ({
    name,
    source: src,
    transform: [
      ...extra,
      { type: "collect", sort: { field: sortField } },
      { type: "window", ops: ["row_number", "sum"], fields: [null, "n"], as: ["idx", "cum"] },
      { type: "formula", as: "y", expr: `top + (datum.cum - datum.n) * fk + (datum.idx - 1) * ${GAP}` },
      { type: "formula", as: "h", expr: "max(1, datum.n * fk)" },
    ],
  });
  return merge(
    processCatalogue(),
    frame({ title: "Where the work went", subtitle: "Items in the period: process → queue or stage → outcome · widths are items · click a process to filter" }),
    {
      data: [
        ctx("fl_raw", {
          body: {
            aggs: {
              m: {
                filter: MAPPED,
                aggs: { p: { terms: { field: "process.name", size: 12 }, aggs: { q: { terms: { field: "queue.name", size: 10 }, aggs: { ...sums("c", "b", "s", "p"), so: { min: { field: "queue.stage_order" } }, st: { terms: { field: "queue.stage", size: 1 } } } } } } },
              },
            },
          },
          property: "aggregations.m.p.buckets",
        }),
        {
          name: "fl",
          source: "fl_raw",
          transform: [
            { type: "flatten", fields: ["q.buckets"], as: ["g"] },
            { type: "formula", as: "proc", expr: "datum.key" },
            { type: "formula", as: "procN", expr: "datum.doc_count" },
            { type: "formula", as: "queue", expr: "datum.g.key" },
            { type: "formula", as: "stage", expr: "length(datum.g.st.buckets) ? datum.g.st.buckets[0].key : null" },
            { type: "formula", as: "so", expr: "datum.g.so.value || 1" },
            ...OUT.map((o) => ({ type: "formula", as: o.k, expr: `datum.g['${o.k}'].value` })),
            { type: "formula", as: "n", expr: "datum.c + datum.b + datum.s + datum.p" },
            { type: "filter", expr: "datum.n > 0" },
            { type: "project", fields: ["proc", "procN", "queue", "stage", "so", "c", "b", "s", "p", "n"] },
          ],
        },
        { name: "fl_tot", source: "fl", transform: [{ type: "aggregate", ops: ["sum", "sum", "sum", "sum", "sum", "count"], fields: ["n", "c", "b", "s", "p", "n"], as: ["n", "c", "b", "s", "p", "nq"] }] },
        { name: "fl_p0", source: "fl", transform: [{ type: "aggregate", groupby: ["proc"], ops: ["sum"], fields: ["n"], as: ["n"] }, { type: "formula", as: "neg", expr: "-datum.n" }] },
        stackY("fl_p0", "n0", "neg", []),
        { name: "fl_p0r", source: "fl_p0", transform: [{ type: "window", sort: { field: "neg" }, ops: ["row_number"], as: ["r"] }] },
        stackY("fl", "n1", ["pi", "so"], [{ type: "lookup", from: "fl_p0r", key: "proc", fields: ["proc"], values: ["r"], as: ["pi"] }]),
        {
          name: "fl_o",
          source: "fl_tot",
          transform: [
            { type: "fold", fields: OUT.map((o) => o.k), as: ["k", "n"] },
            { type: "formula", as: "ord", expr: `indexof([${OUT.map((o) => `'${o.k}'`).join(", ")}], datum.k)` },
            { type: "filter", expr: "datum.n > 0" },
            { type: "formula", as: "label", expr: `[${OUT.map((o) => `'${o.label}'`).join(", ")}][datum.ord]` },
            { type: "formula", as: "color", expr: `[${OUT.map((o) => `'${o.color}'`).join(", ")}][datum.ord]` },
            { type: "project", fields: ["k", "n", "ord", "label", "color"] },
          ],
        },
        stackY("fl_o", "n2", "ord"),
        // links process -> queue: stacked inside the process node in queue order
        {
          name: "l1",
          source: "n1",
          transform: [
            { type: "window", groupby: ["proc"], sort: { field: "so" }, ops: ["sum"], fields: ["n"], as: ["cum"] },
            { type: "lookup", from: "n0", key: "proc", fields: ["proc"], values: ["y"], as: ["py"] },
            { type: "formula", as: "ya", expr: "datum.py + (datum.cum - datum.n) * fk" },
          ],
        },
        // links queue -> outcome: stacked by outcome inside the queue, by queue inside the outcome
        {
          name: "l2",
          source: "n1",
          transform: [
            { type: "formula", as: "qy", expr: "datum.y" },
            { type: "formula", as: "qi", expr: "datum.idx" },
            { type: "fold", fields: OUT.map((o) => o.k), as: ["k", "v"] },
            { type: "filter", expr: "datum.v > 0" },
            { type: "formula", as: "ord", expr: `indexof([${OUT.map((o) => `'${o.k}'`).join(", ")}], datum.k)` },
            { type: "window", groupby: ["queue"], sort: { field: "ord" }, ops: ["sum"], fields: ["v"], as: ["cq"] },
            { type: "window", groupby: ["k"], sort: { field: "qi" }, ops: ["sum"], fields: ["v"], as: ["co"] },
            { type: "lookup", from: "n2", key: "k", fields: ["k"], values: ["y", "color"], as: ["oy", "color"] },
            { type: "formula", as: "ya", expr: "datum.qy + (datum.cq - datum.v) * fk" },
            { type: "formula", as: "yb", expr: "datum.oy + (datum.co - datum.v) * fk" },
          ],
        },
        { name: "n0c", source: "n0", transform: [{ type: "lookup", from: "procs", key: "name", fields: ["proc"], values: ["spokeColor"], as: ["color"] }, ...spread(15)] },
        { name: "n2c", source: "n2", transform: spread(34) },
      ],
      signals: [
        { name: "fN", update: "length(data('fl_tot')) ? data('fl_tot')[0].n : 0" },
        {
          name: "fk",
          update: `fN ? min((ch - (length(data('fl_p0')) - 1) * ${GAP}) / fN, (ch - (length(data('fl')) - 1) * ${GAP}) / fN, (ch - 3 * ${GAP}) / fN) : 0`,
        },
        { name: "x0", update: `${PAD} + clamp(cw * 0.3, 150, 290)` },
        { name: "x2", update: `width - ${PAD} - clamp(cw * 0.22, 150, 220)` },
        { name: "x1", update: `(x0 + x2) / 2 - ${NW / 2}` },
        { name: "flPick", on: [{ events: "@fl_node0:click", update: addFilter("process.name", "datum.proc") }] },
      ],
      marks: [
        { type: "path", from: { data: "l1" }, interactive: true, encode: { update: { path: { signal: band(`(x0 + ${NW})`, "datum.ya", "x1", "datum.y", "datum.n * fk") }, fill: { value: C.accent }, fillOpacity: { value: 0.16 }, tooltip: { signal: `{'': datum.proc + ' → ' + (datum.stage || datum.queue), 'Items': ${F.int("datum.n")}}` } }, hover: { fillOpacity: { value: 0.32 } } } },
        { type: "path", from: { data: "l2" }, interactive: true, encode: { update: { path: { signal: band(`(x1 + ${NW})`, "datum.ya", "x2", "datum.yb", "datum.v * fk") }, fill: { field: "color" }, fillOpacity: { value: 0.28 }, tooltip: { signal: `{'': (datum.stage || datum.queue) + ' → ' + ['Completed', 'Business exception', 'System exception', 'Still waiting'][datum.ord], 'Items': ${F.int("datum.v")}, 'Share of the queue': ${F.pct("datum.v / datum.n")}}` } }, hover: { fillOpacity: { value: 0.5 } } } },
        { type: "rect", name: "fl_node0", from: { data: "n0c" }, encode: { update: { x: { signal: "x0" }, width: { value: NW }, y: { field: "y" }, height: { field: "h" }, fill: { signal: `datum.color || '${C.hub}'` }, cornerRadius: { value: 2 }, cursor: { value: "pointer" }, tooltip: { signal: `{'Process': datum.proc, 'Items': ${F.int("datum.n")}}` } } } },
        { type: "rect", from: { data: "n1" }, encode: { update: { x: { signal: "x1" }, width: { value: NW }, y: { field: "y" }, height: { field: "h" }, fill: { value: C.inkSoft }, cornerRadius: { value: 2 }, tooltip: { signal: `{'Queue': datum.queue, 'Stage': datum.stage || 'single stage', 'Items': ${F.int("datum.n")}}` } } } },
        { type: "rect", from: { data: "n2" }, encode: { update: { x: { signal: "x2" }, width: { value: NW }, y: { field: "y" }, height: { field: "h" }, fill: { field: "color" }, cornerRadius: { value: 2 } } } },
        { type: "text", from: { data: "n0c" }, interactive: false, encode: { update: { x: { signal: "x0 - 8" }, y: { field: "ly" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.ink }, text: { signal: `datum.proc + '  ' + ${F.compact("datum.n")}` }, limit: { signal: `x0 - ${PAD} - 10` } } } },
        { type: "text", from: { data: "n1" }, interactive: false, encode: { update: { x: { signal: `x1 + ${NW + 6}` }, y: { signal: "datum.y + datum.h / 2" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.ink }, stroke: { value: C.paper }, strokeWidth: { value: 3 }, strokeOpacity: { value: 0.85 }, text: { signal: "datum.stage ? 'Stage ' + datum.so + ': ' + datum.stage : ''" }, limit: { signal: "x2 - x1 - 40" }, opacity: { signal: "datum.h >= 10 ? 1 : 0" } } } },
        { type: "text", from: { data: "n1" }, interactive: false, encode: { update: { x: { signal: `x1 + ${NW + 6}` }, y: { signal: "datum.y + datum.h / 2" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.ink }, text: { signal: "datum.stage ? 'Stage ' + datum.so + ': ' + datum.stage : ''" }, limit: { signal: "x2 - x1 - 40" }, opacity: { signal: "datum.h >= 10 ? 1 : 0" } } } },
        { type: "text", from: { data: "n2c" }, interactive: false, encode: { update: { x: { signal: `x2 + ${NW + 8}` }, y: { signal: "datum.ly - 8" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12.5 }, fontWeight: { value: 600 }, fill: { field: "color" }, text: { field: "label" }, limit: { signal: `width - ${PAD} - x2 - 18` } } } },
        { type: "text", from: { data: "n2c" }, interactive: false, encode: { update: { x: { signal: `x2 + ${NW + 8}` }, y: { signal: "datum.ly + 8" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 11 }, fill: { value: C.inkSoft }, text: { signal: `${F.int("datum.n")} + ' · ' + ${F.pct("datum.n / fN")}` } } } },
        emptyNote("!fN", "No mapped items in this period"),
      ],
    },
  );
};

// ---------------------------------------------------------------------------
const periods = () => {
  const seg = segmented({ signal: "pview", options: [{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }] });
  const r = (a, b) => `(${b} ? ${a} / ${b} : null)`;
  return merge(
    ioBlock(),
    workingTime(),
    frame({ title: "Period by period", subtitleSignal: "'Newest first · cost is stamped daily, so the latest ' + (pview === 'monthly' ? 'month' : 'week') + ' fills in as the cost job runs'" }),
    { signals: [{ name: "pview", value: "monthly", on: seg.on }], marks: seg.marks },
    grouped("pview"),
    {
      data: [
        {
          name: "per",
          source: "grp",
          transform: [
            { type: "formula", as: "label", expr: `pview === 'monthly' ? utcFormat(datum.t, '%B %Y') : 'w/c ' + utcFormat(datum.t, '%-d %b %Y')` },
            { type: "formula", as: "e", expr: "datum.b + datum.s" },
            { type: "formula", as: "compl", expr: r("datum.c", "datum.a") },
            { type: "formula", as: "cpi", expr: r("datum.ec", "datum.c") },
            { type: "formula", as: "cpc", expr: r("datum.ec", "datum.cd") },
            { type: "formula", as: "fte", expr: fteExpr("datum.h", "datum.days") },
            { type: "formula", as: "fteBack", expr: fteExpr("datum.rhB", "datum.days") },
            { type: "formula", as: "bt", expr: "datum.w / 3600" },
            { type: "collect", sort: { field: "t", order: "descending" } },
          ],
        },
        {
          name: "per_tot",
          source: "per",
          transform: [{ type: "aggregate", ops: ["sum", "sum", "sum", "sum", "sum", "sum", "sum", "sum", "sum", "sum", "sum"], fields: ["in", "c", "b", "s", "a", "cd", "ec", "h", "rhB", "w", "days"], as: ["in", "c", "b", "s", "a", "cd", "ec", "h", "rhB", "w", "days"] }],
        },
      ],
      signals: [{ name: "pt", update: "length(data('per_tot')) ? data('per_tot')[0] : {}" }],
    },
    table({
      data: "per",
      name: "pr",
      rowH: 25,
      columns: [
        { label: "Period", text: "datum.label", bold: true },
        { label: "In", w: 74, align: "right", font: "mono", text: F.int("datum.in") },
        { label: "Completed", w: 86, align: "right", font: "mono", text: F.int("datum.c") },
        { label: "Business", w: 74, align: "right", font: "mono", text: F.int("datum.b"), color: `'${C.business}'` },
        { label: "System", w: 70, align: "right", font: "mono", text: F.int("datum.s"), color: `'${C.system}'` },
        { label: "Completion", w: 84, align: "right", font: "mono", text: F.pct("datum.compl") },
        { label: "Cases", w: 74, align: "right", font: "mono", text: F.int("datum.cd") },
        { label: "Bot hours", w: 78, align: "right", font: "mono", text: F.int("datum.bt") },
        { label: "Cost", w: 84, align: "right", font: "mono", text: F.moneyCompact("datum.ec") },
        { label: "Per item", w: 72, align: "right", font: "mono", text: F.money2("datum.cpi") },
        { label: "Per case", w: 72, align: "right", font: "mono", text: F.money2("datum.cpc") },
        { label: "FTE saved", w: 78, align: "right", font: "mono", text: "format(datum.fte, '.1f')", color: `'${C.good}'` },
        { label: "FTE handed back", w: 118, align: "right", font: "mono", text: "format(datum.fteBack, '.1f')", color: `'${C.business}'`, tip: `${F.int("datum.rhB")} + ' colleague hours of business exceptions, ' + ${F.gbp("datum.rwB")}` },
      ],
      totals: [
        "'Period total'",
        F.int("pt.in"),
        F.int("pt.c"),
        F.int("pt.b"),
        F.int("pt.s"),
        F.pct(r("pt.c", "pt.a")),
        F.int("pt.cd"),
        F.int("pt.w / 3600"),
        F.moneyCompact("pt.ec"),
        F.money2(r("pt.ec", "pt.c")),
        F.money2(r("pt.ec", "pt.cd")),
        `format(${fteExpr("pt.h", "pt.days")}, '.1f')`,
        `format(${fteExpr("pt.rhB", "pt.days")}, '.1f')`,
      ],
    }),
  );
};

// Waiting by age: what is still waiting at the window's end, per process, by
// how long it has waited. Old items are the ones to chase.
const AGES = [
  { key: "a0", label: "Under 4 h", from: -4, to: null, color: "#DCE8E0" },
  { key: "a1", label: "4 to 24 h", from: -24, to: -4, color: "#9FC2B6" },
  { key: "a2", label: "1 to 3 days", from: -72, to: -24, color: "#B9852C" },
  { key: "a3", label: "3 to 7 days", from: -168, to: -72, color: "#C9663F" },
  { key: "a4", label: "Over 7 days", from: null, to: -168, color: "#B6462F" },
];
const ageing = () =>
  merge(
    processCatalogue(),
    frame({ title: "Waiting by age", subtitle: "Items still waiting at the end of the period, by how long they have waited · oldest first · click a process to filter", legend: AGES.map((a) => ({ label: a.label, color: a.color })), legendBelow: true }),
    {
      data: [
        {
          name: "ag_raw",
          url: {
            index: IDX.items,
            body: {
              size: 0,
              query: ctxBool([MAPPED, { term: { "n.pending": 1 } }, rng("item.loaded_at", null, at())]),
              aggs: {
                p: {
                  terms: { field: "process.name", size: 30 },
                  aggs: {
                    age: { date_range: { field: "item.loaded_at", keyed: true, ranges: AGES.map((a) => ({ key: a.key, ...(a.from != null ? { from: at(a.from) } : {}), ...(a.to != null ? { to: at(a.to) } : {}) })) } },
                    past: { filter: rng("item.sla_due_at", null, at()) },
                    oldest: { min: { field: "item.loaded_at" } },
                  },
                },
                nowb: { date_range: { field: "item.loaded_at", ranges: [{ key: "now", from: at() }] } },
              },
            },
          },
          format: { property: "aggregations" },
        },
        {
          name: "ag",
          source: "ag_raw",
          transform: [
            { type: "flatten", fields: ["p.buckets"], as: ["g"] },
            { type: "formula", as: "name", expr: "datum.g.key" },
            { type: "formula", as: "n", expr: "datum.g.doc_count" },
            { type: "formula", as: "past", expr: "datum.g.past.doc_count" },
            { type: "formula", as: "ageH", expr: "(datum.nowb.buckets[0].from - datum.g.oldest.value) / 3600000" },
            ...AGES.map((a) => ({ type: "formula", as: a.key, expr: `datum.g.age.buckets.${a.key}.doc_count` })),
            { type: "formula", as: "old", expr: "datum.a2 + datum.a3 + datum.a4" },
            { type: "collect", sort: { field: ["a4", "a3", "a2", "n"], order: ["descending", "descending", "descending", "descending"] } },
            { type: "window", ops: ["row_number"], as: ["r"] },
            { type: "project", fields: ["name", "n", "past", "ageH", "old", "r", ...AGES.map((a) => a.key)] },
          ],
        },
        {
          name: "agseg",
          source: "ag",
          transform: [
            { type: "fold", fields: AGES.map((a) => a.key), as: ["k", "v"] },
            { type: "formula", as: "ord", expr: `indexof([${AGES.map((a) => `'${a.key}'`).join(", ")}], datum.k)` },
            { type: "window", groupby: ["name"], sort: { field: "ord", order: "descending" }, ops: ["sum"], fields: ["v"], as: ["x1"] },
            { type: "formula", as: "x0", expr: "datum.x1 - datum.v" },
            { type: "filter", expr: "datum.v > 0 && datum.r <= agFit" },
          ],
        },
        // only the rows that fit: hidden marks would still stretch the panel
        { name: "agv", source: "ag", transform: [{ type: "filter", expr: "datum.r <= agFit" }] },
        { name: "agmax", source: "ag", transform: [{ type: "aggregate", ops: ["max", "sum", "sum", "sum"], fields: ["n", "n", "past", "old"], as: ["m", "n", "past", "old"] }] },
      ],
      signals: [
        { name: "agRowH", value: 26 },
        { name: "agTop", update: "top + 18" },
        { name: "agFit", update: "max(1, floor((ch - 40) / agRowH))" },
        { name: "agLabelW", update: "clamp(cw * 0.22, 150, 260)" },
        { name: "agBarW", update: "cw - agLabelW - 230" },
        { name: "agMax", update: "length(data('agmax')) ? max(1, data('agmax')[0].m) : 1" },
        { name: "pickAg", on: [{ events: "@ag_label:click", update: addFilter("process.name", "datum.name") }] },
      ],
      marks: [
        { type: "text", encode: { update: { x: { signal: `${PAD} + cw - 120` }, y: { signal: "agTop - 6" }, align: { value: "right" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: "WAITING" } } } },
        { type: "text", encode: { update: { x: { signal: `${PAD} + cw - 60` }, y: { signal: "agTop - 6" }, align: { value: "right" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: "PAST SLA" } } } },
        { type: "text", encode: { update: { x: { signal: `${PAD} + cw` }, y: { signal: "agTop - 6" }, align: { value: "right" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: "OLDEST" } } } },
        {
          type: "text",
          name: "ag_label",
          from: { data: "agv" },
          encode: { update: { x: { value: PAD }, y: { signal: "agTop + (datum.r - 0.5) * agRowH" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12.5 }, fill: { value: C.ink }, text: { field: "name" }, limit: { signal: "agLabelW - 10" }, cursor: { value: "pointer" } } },
        },
        { type: "rect", from: { data: "agv" }, encode: { update: { x: { signal: `${PAD} + agLabelW` }, width: { signal: "agBarW" }, y: { signal: "agTop + (datum.r - 0.5) * agRowH - 5" }, height: { value: 10 }, cornerRadius: { value: 5 }, fill: { value: C.track } } } },
        {
          type: "rect",
          from: { data: "agseg" },
          encode: {
            update: {
              x: { signal: `${PAD} + agLabelW + agBarW * datum.x0 / agMax` },
              x2: { signal: `${PAD} + agLabelW + agBarW * datum.x1 / agMax` },
              y: { signal: "agTop + (datum.r - 0.5) * agRowH - 5" },
              height: { value: 10 },
              fill: { signal: `[${AGES.map((a) => `'${a.color}'`).join(", ")}][datum.ord]` },
              tooltip: { signal: `{'Process': datum.name, 'Waiting': [${AGES.map((a) => `'${a.label}'`).join(", ")}][datum.ord], 'Items': datum.v}` },
            },
          },
        },
        ...[
          ["cw - 120", F.int("datum.n"), `'${C.ink}'`],
          ["cw - 60", F.int("datum.past"), `datum.past > 0 ? '${C.bad}' : '${C.inkSoft}'`],
          ["cw", "datum.ageH < 48 ? format(datum.ageH, '.0f') + ' h' : format(datum.ageH / 24, '.0f') + ' days'", `datum.ageH > 72 ? '${C.bad}' : '${C.ink}'`],
        ].map(([x, t, c]) => ({ type: "text", from: { data: "agv" }, encode: { update: { x: { signal: `${PAD} + ${x}` }, y: { signal: "agTop + (datum.r - 0.5) * agRowH" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 12 }, fontWeight: { value: 600 }, fill: { signal: c }, text: { signal: t } } } })),
        { type: "text", encode: { update: { x: { signal: `${PAD} + cw` }, y: { signal: "top + ch" }, align: { value: "right" }, baseline: { value: "bottom" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.inkSoft }, text: { signal: "length(data('ag')) > agFit ? '+' + (length(data('ag')) - agFit) + ' more processes' : ''" } } } },
        emptyNote("!length(data('ag'))", "Nothing waiting at the end of the period"),
      ],
    },
  );

export const dashboard = {
  id: "work-flow",
  title: "IA · Work in & out",
  description: "What arrived, what was worked, what is waiting, where it went and what it cost, period by period",
  time: { from: "now-89d/d", to: "now" },
  states: ["process"],
  panels: [
    { id: "kpis", title: "Work in & out KPIs", grid: { x: 0, y: 0, w: 48, h: 5 }, build: kpis },
    { id: "in-out", title: "In and out", grid: { x: 0, y: 5, w: 26, h: 16 }, build: inOut },
    { id: "flow", title: "Where the work went", grid: { x: 26, y: 5, w: 22, h: 16 }, build: flow },
    { id: "ageing", title: "Waiting by age", grid: { x: 0, y: 21, w: 48, h: 14 }, build: ageing },
    { id: "periods", title: "Period by period", grid: { x: 0, y: 35, w: 48, h: 13 }, build: periods },
  ],
};
