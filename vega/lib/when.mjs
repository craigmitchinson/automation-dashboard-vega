// ---------------------------------------------------------------------------
// when.mjs: a "when does it happen" heatmap. Rows are the top values of a
// field (processes, exception reasons), columns are the outcome's hour of day
// or day of week (T16), cells a sum or a count. Click a row label to filter.
// ---------------------------------------------------------------------------
import { C, FONT } from "./tokens.mjs";
import { F } from "./fmt.mjs";
import { merge, frame, segmented, emptyNote, PAD } from "./kit.mjs";
import { ctx, MAPPED } from "./es.mjs";
import { addFilter } from "./common.mjs";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// sumField null counts items; rowColor(datum) optional expression for the swatch
export function whenHeatmap({ title, subtitle, rowField, rowSize = 20, filterField, sumField = null, scale = 1, unit, totalFmt, color, filter = null, rowColor = null, typeField = null, cellColor = null }) {
  const seg = segmented({ signal: "whenBy", options: [{ value: "hour", label: "Hour of day" }, { value: "weekday", label: "Day of week" }] });
  const val = sumField ? { w: { sum: { field: sumField } } } : {};
  const v = (b) => (sumField ? `${b}.w.value * ${scale}` : `${b}.doc_count`);
  return merge(
    frame({ title, subtitleSignal: subtitle }),
    {
      signals: [
        { name: "whenBy", value: "hour", on: seg.on },
        { name: "labelW", update: "clamp(cw * 0.24, 150, 260)" },
        { name: "totW", value: 70 },
        { name: "nRows", update: "length(data('wr'))" },
        { name: "rowH", update: "nRows ? clamp((ch - 34) / nRows, 14, 30) : 20" },
        { name: "pickW", on: [{ events: "@wh_label:click", update: addFilter(filterField, "datum.name") }] },
      ],
      marks: seg.marks,
      data: [
        ctx("wh_raw", {
          body: {
            aggs: {
              m: {
                filter: filter ? { bool: { filter: [MAPPED, filter] } } : MAPPED,
                aggs: {
                  p: {
                    terms: { field: rowField, size: rowSize, ...(sumField ? { order: { w: "desc" } } : {}) },
                    aggs: {
                      ...val,
                      ...(typeField ? { ty: { terms: { field: typeField, size: 1 } } } : {}),
                      hr: { terms: { field: "outcome_hour", size: 24 }, aggs: val },
                      dw: { terms: { field: "outcome_weekday", size: 7 }, aggs: val },
                    },
                  },
                },
              },
            },
          },
          property: "aggregations.m.p.buckets",
        }),
        {
          name: "wr",
          source: "wh_raw",
          transform: [
            { type: "formula", as: "name", expr: "datum.key" },
            { type: "formula", as: "tot", expr: v("datum") },
            ...(typeField ? [{ type: "formula", as: "type", expr: "length(datum.ty.buckets) ? datum.ty.buckets[0].key : ''" }] : []),
            { type: "window", ops: ["row_number"], as: ["ri"] },
          ],
        },
        {
          name: "wc",
          source: "wr",
          transform: [
            { type: "formula", as: "bk", expr: "whenBy === 'hour' ? datum.hr.buckets : datum.dw.buckets" },
            { type: "flatten", fields: ["bk"], as: ["b"] },
            { type: "formula", as: "col", expr: "datum.b.key" },
            { type: "formula", as: "v", expr: v("datum.b") },
            { type: "project", fields: ["name", "ri", "col", "v", "tot", ...(typeField ? ["type"] : [])] },
          ],
        },
        { name: "wcols", transform: [{ type: "sequence", start: 0, stop: 24, as: "i" }, { type: "formula", as: "col", expr: "whenBy === 'hour' ? datum.i : datum.i + 1" }, { type: "filter", expr: "whenBy === 'hour' || datum.i < 7" }] },
        { name: "wmax", source: "wc", transform: [{ type: "aggregate", ops: ["max"], fields: ["v"], as: ["m"] }] },
      ],
      scales: [{ name: "wx", type: "band", domain: { data: "wcols", field: "col", sort: true }, range: [0, { signal: "cw - labelW - totW" }], paddingInner: 0.06 }],
      marks: [
        {
          type: "group",
          encode: { update: { x: { signal: `${PAD} + labelW` }, y: { signal: "top + 20" }, width: { signal: "cw - labelW - totW" }, height: { signal: "rowH * nRows" } } },
          marks: [
            { type: "text", from: { data: "wcols" }, encode: { update: { x: { scale: "wx", field: "col", band: 0.5 }, y: { value: -6 }, align: { value: "center" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fill: { value: C.inkSoft }, text: { signal: `whenBy === 'hour' ? pad('' + datum.col, 2, '0', 'left') : [${DOW.map((d) => `'${d}'`).join(", ")}][datum.col - 1]` } } } },
            {
              type: "rect",
              from: { data: "wc" },
              encode: {
                update: {
                  x: { scale: "wx", field: "col" },
                  width: { scale: "wx", band: 1 },
                  y: { signal: "(datum.ri - 1) * rowH + 1" },
                  height: { signal: "rowH - 2" },
                  cornerRadius: { value: 3 },
                  fill: cellColor ? { signal: cellColor } : { value: color },
                  fillOpacity: { signal: "length(data('wmax')) && data('wmax')[0].m ? 0.06 + 0.86 * datum.v / data('wmax')[0].m : 0" },
                  tooltip: { signal: `{'': datum.name, 'When': whenBy === 'hour' ? pad('' + datum.col, 2, '0', 'left') + ':00 UTC' : [${DOW.map((d) => `'${d}'`).join(", ")}][datum.col - 1], '${unit}': format(datum.v, ',.1f'), 'Share of its total': ${F.pct("datum.v / datum.tot")}}` },
                },
              },
            },
          ],
        },
        ...(rowColor
          ? [{ type: "rect", from: { data: "wr" }, encode: { update: { x: { value: PAD }, y: { signal: "top + 20 + (datum.ri - 0.5) * rowH - 5" }, width: { value: 10 }, height: { value: 10 }, cornerRadius: { value: 3 }, fill: { signal: rowColor } } } }]
          : []),
        { type: "text", name: "wh_label", from: { data: "wr" }, encode: { update: { x: { value: PAD + (rowColor ? 16 : 0) }, y: { signal: "top + 20 + (datum.ri - 0.5) * rowH" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.ink }, text: { field: "name" }, limit: { signal: `labelW - ${rowColor ? 26 : 10}` }, cursor: { value: "pointer" }, tooltip: { signal: "'Click to filter to ' + datum.name" } } } },
        { type: "text", from: { data: "wr" }, encode: { update: { x: { signal: `${PAD} + cw` }, y: { signal: "top + 20 + (datum.ri - 0.5) * rowH" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 11 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { signal: totalFmt("datum.tot") } } } },
        { type: "text", encode: { update: { x: { signal: `${PAD} + cw` }, y: { signal: "top + 14" }, align: { value: "right" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: unit.toUpperCase() } } } },
        emptyNote("!nRows", "Nothing in this selection"),
      ],
    },
  );
}
