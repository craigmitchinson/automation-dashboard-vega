// Exceptions: heatmap by process and reason, plus a searchable detail table.
// React source: src/pages/Exceptions.tsx
import { C, FONT } from "../lib/tokens.mjs";
import { F } from "../lib/fmt.mjs";
import { merge, frame, kpiTiles, table, segmented, PAD } from "../lib/kit.mjs";
import { dailyBlock, T } from "../lib/blocks.mjs";
import { ctx, MAPPED } from "../lib/es.mjs";
import { processCatalogue, addFilter } from "../lib/common.mjs";

const EXC = { term: { outcome: "Exception" } };

const kpis = () =>
  merge(
    dailyBlock({ keys: ["b", "s", "e"] }),
    {
      data: [
        ctx("rwt", { body: { aggs: { m: { filter: MAPPED, aggs: { t: { terms: { field: "exception.type", size: 5 }, aggs: { rw: { sum: { field: "value.rework_gbp" } } } } } } } }, property: "aggregations.m.t.buckets" }),
        {
          name: "tiles",
          values: [
            { i: 0, label: "Total exceptions", accent: C.ink, deltaGood: "down" },
            { i: 1, label: "System exceptions", accent: C.system },
            { i: 2, label: "Business exceptions", accent: C.business },
            { i: 3, label: "Exception cost (period)", accent: C.bad },
          ],
          transform: [
            { type: "formula", as: "rwB", expr: "indexof(pluck(data('rwt'), 'key'), 'Business') >= 0 ? data('rwt')[indexof(pluck(data('rwt'), 'key'), 'Business')].rw.value : 0" },
            { type: "formula", as: "rwS", expr: "indexof(pluck(data('rwt'), 'key'), 'System') >= 0 ? data('rwt')[indexof(pluck(data('rwt'), 'key'), 'System')].rw.value : 0" },
            { type: "formula", as: "value", expr: `[${F.compact(T("cur_e"))}, ${F.compact(T("cur_s"))}, ${F.compact(T("cur_b"))}, ${F.gbp("datum.rwB + datum.rwS")}][datum.i]` },
            { type: "formula", as: "delta", expr: `datum.i === 0 && ${T("prev_e")} ? (${T("cur_e")} - ${T("prev_e")}) / ${T("prev_e")} : null` },
            {
              type: "formula",
              as: "sub",
              expr: `['vs prev. period', ${F.pct(`${T("cur_s")} / max(1, ${T("cur_e")})`, 0)} + ' of exceptions', ${F.pct(`${T("cur_b")} / max(1, ${T("cur_e")})`, 0)} + ' of exceptions', ${F.gbp("datum.rwB")} + ' business · ' + ${F.gbp("datum.rwS")} + ' system'][datum.i]`,
            },
          ],
        },
      ],
    },
    kpiTiles({ n: 4 }),
  );

const heatmap = () =>
  merge(
    processCatalogue(),
    frame({ title: "Exception heatmap", subtitle: "Volume by process (rows) and exception reason (columns). Stronger colour means more; hover a cell for the full reason. Click a process to filter." }),
    {
      data: [
        ctx("hm_raw", {
          body: {
            aggs: {
              m: {
                filter: MAPPED,
                aggs: {
                  p: {
                    terms: { field: "process.name", size: 100 },
                    aggs: {
                      a: { sum: { field: "n.attempt" } },
                      x: { filter: EXC, aggs: { r: { terms: { field: "exception.reason_display", size: 100 }, aggs: { t: { terms: { field: "exception.type", size: 1 } }, k: { terms: { field: "exception.code", size: 1 } } } } } },
                    },
                  },
                },
              },
            },
          },
          property: "aggregations.m.p.buckets",
        }),
        {
          name: "rows",
          source: "hm_raw",
          transform: [
            { type: "formula", as: "name", expr: "datum.key" },
            { type: "formula", as: "attempts", expr: "datum.a.value" },
            { type: "formula", as: "total", expr: "datum.x.doc_count" },
            { type: "lookup", from: "procs", key: "name", fields: ["name"], as: ["ref"] },
            { type: "formula", as: "spokeColor", expr: `datum.ref ? datum.ref.spokeColor : '${C.hub}'` },
            { type: "collect", sort: { field: "attempts", order: "descending" } },
            { type: "window", ops: ["row_number"], as: ["ri"] },
          ],
        },
        { name: "rowsum", source: "rows", transform: [{ type: "aggregate", ops: ["sum"], fields: ["total"], as: ["total"] }] },
        {
          name: "cells",
          source: "hm_raw",
          transform: [
            { type: "flatten", fields: ["x.r.buckets"], as: ["c"] },
            { type: "formula", as: "process", expr: "datum.key" },
            { type: "formula", as: "reason", expr: "datum.c.key" },
            { type: "formula", as: "v", expr: "datum.c.doc_count" },
            { type: "formula", as: "type", expr: "datum.c.t.buckets[0].key" },
            { type: "formula", as: "code", expr: "datum.c.k.buckets[0].key" },
            { type: "project", fields: ["process", "reason", "v", "type", "code"] },
          ],
        },
        {
          name: "cols",
          source: "cells",
          transform: [
            { type: "aggregate", groupby: ["reason", "code", "type"], ops: ["sum"], fields: ["v"], as: ["total"] },
            { type: "formula", as: "ord", expr: "(datum.type === 'System' ? 0 : 1e9) - datum.total" },
            { type: "collect", sort: { field: "ord" } },
          ],
        },
      ],
      signals: [
        { name: "labelW", value: 180 },
        { name: "totW", value: 84 },
        { name: "rowH", update: "clamp((ch - 46) / max(1, length(data('rows'))), 14, 24)" },
        { name: "cellMax", update: "max(1, extent(pluck(data('cells'), 'v'))[1])" },
        { name: "rowMax", update: "max(1, extent(pluck(data('rows'), 'total'))[1])" },
        { name: "pick", on: [{ events: "@hm_label:click", update: addFilter("process.name", "datum.name") }] },
      ],
      scales: [
        { name: "hx", type: "band", domain: { data: "cols", field: "reason", sort: { field: "ord", op: "min" } }, range: [0, { signal: "cw - labelW - totW" }], paddingInner: 0.04 },
        { name: "hy", type: "band", domain: { data: "rows", field: "name", sort: { field: "ri", op: "min" } }, range: [0, { signal: "rowH * length(data('rows'))" }], paddingInner: 0.08 },
      ],
      marks: [
        {
          type: "group",
          encode: { update: { x: { signal: `${PAD} + labelW` }, y: { signal: "top + 20" }, width: { signal: "cw - labelW - totW" }, height: { signal: "rowH * length(data('rows'))" } } },
          marks: [
            {
              type: "text",
              from: { data: "cols" },
              encode: {
                update: {
                  x: { scale: "hx", field: "reason", band: 0.5 },
                  y: { value: -6 },
                  align: { value: "center" },
                  font: { value: FONT.mono },
                  fontSize: { value: 10 },
                  fontWeight: { value: 600 },
                  fill: { signal: `datum.type === 'System' ? '${C.system}' : '${C.business}'` },
                  text: { field: "code" },
                  tooltip: { signal: "datum.reason + ' (' + datum.type + ')'" },
                },
              },
            },
            {
              type: "rect",
              from: { data: "cells" },
              encode: {
                update: {
                  x: { scale: "hx", field: "reason" },
                  width: { scale: "hx", band: 1 },
                  y: { scale: "hy", field: "process" },
                  height: { scale: "hy", band: 1 },
                  cornerRadius: { value: 3 },
                  fill: { signal: `datum.type === 'System' ? '${C.system}' : '${C.business}'` },
                  fillOpacity: { signal: "datum.v ? 0.12 + 0.8 * datum.v / cellMax : 0" },
                  tooltip: { signal: `{'Process': datum.process, 'Reason': datum.reason, 'Exceptions': ${F.int("datum.v")}}` },
                },
              },
            },
            {
              type: "text",
              interactive: false,
              from: { data: "cells" },
              encode: {
                update: {
                  x: { scale: "hx", field: "reason", band: 0.5 },
                  y: { scale: "hy", field: "process", band: 0.5 },
                  align: { value: "center" },
                  baseline: { value: "middle" },
                  font: { value: FONT.mono },
                  fontSize: { value: 10.5 },
                  fontWeight: { value: 600 },
                  fill: { signal: `datum.v / cellMax > 0.55 ? '${C.paper}' : '${C.inkSoft}'` },
                  text: { signal: `datum.v > 0 ? ${F.compact("datum.v")} : ''` },
                },
              },
            },
          ],
        },
        {
          type: "group",
          name: "hm_label",
          from: { data: "rows" },
          encode: {
            update: {
              x: { value: PAD },
              y: { signal: "top + 20 + scale('hy', datum.name)" },
              width: { signal: "labelW - 6" },
              height: { signal: "bandwidth('hy')" },
              fill: { value: "transparent" },
              cursor: { value: "pointer" },
            },
            hover: { fill: { value: C.band } },
          },
          marks: [
            { type: "rect", encode: { update: { x: { value: 2 }, y: { signal: "item.mark.group.height / 2 - 4" }, width: { value: 8 }, height: { value: 8 }, cornerRadius: { value: 2 }, fill: { field: { parent: "spokeColor" } } } } },
            { type: "text", encode: { update: { x: { value: 16 }, y: { signal: "item.mark.group.height / 2" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.ink }, text: { field: { parent: "name" } }, limit: { signal: "labelW - 24" } } } },
          ],
        },
        {
          type: "group",
          from: { data: "rows" },
          encode: { update: { x: { signal: `${PAD} + cw - totW + 8` }, y: { signal: "top + 20 + scale('hy', datum.name)" }, width: { signal: "totW - 8" }, height: { signal: "bandwidth('hy')" } } },
          marks: [
            { type: "rect", encode: { update: { x: { value: 0 }, y: { signal: "item.mark.group.height / 2 - 3.5" }, width: { signal: "item.mark.group.width - 34" }, height: { value: 7 }, cornerRadius: { value: 3 }, fill: { value: C.track } } } },
            { type: "rect", encode: { update: { x: { value: 0 }, y: { signal: "item.mark.group.height / 2 - 3.5" }, width: { signal: "max(2, (item.mark.group.width - 34) * parent.total / rowMax)" }, height: { value: 7 }, cornerRadius: { value: 3 }, fill: { value: C.ink } } } },
            { type: "text", encode: { update: { x: { signal: "item.mark.group.width" }, y: { signal: "item.mark.group.height / 2" }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { signal: F.compact("parent.total") } } } },
          ],
        },
        { type: "text", encode: { update: { x: { signal: `${PAD} + cw` }, y: { signal: "top + 14" }, align: { value: "right" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: "TOTAL" } } } },
        { type: "rule", encode: { update: { x: { value: PAD }, x2: { signal: `width - ${PAD}` }, y: { signal: "top + 24 + rowH * length(data('rows'))" }, stroke: { value: C.rule } } } },
        { type: "text", encode: { update: { x: { value: PAD + 4 }, y: { signal: "top + 38 + rowH * length(data('rows'))" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: "Total" } } } },
        {
          type: "text",
          from: { data: "cols" },
          encode: {
            update: {
              x: { signal: `${PAD} + labelW + scale('hx', datum.reason) + bandwidth('hx') / 2` },
              y: { signal: "top + 38 + rowH * length(data('rows'))" },
              align: { value: "center" },
              baseline: { value: "middle" },
              font: { value: FONT.mono },
              fontSize: { value: 10.5 },
              fontWeight: { value: 600 },
              fill: { value: C.ink },
              text: { signal: F.compact("datum.total") },
            },
          },
        },
        {
          type: "text",
          encode: {
            update: {
              x: { signal: `${PAD} + cw` },
              y: { signal: "top + 38 + rowH * length(data('rows'))" },
              align: { value: "right" },
              baseline: { value: "middle" },
              font: { value: FONT.mono },
              fontSize: { value: 10.5 },
              fontWeight: { value: 600 },
              fill: { value: C.ink },
              text: { signal: F.compact("(length(data('rowsum')) ? data('rowsum')[0].total : 0)") },
            },
          },
        },
      ],
    },
  );

const detail = () => {
  const seg = segmented({ signal: "cat", options: [{ value: "all", label: "All" }, { value: "System", label: "System" }, { value: "Business", label: "Business" }] });
  return merge(
    frame({ title: "Exception detail", subtitle: "Every exception reason across the current filters · use the search box below the panel to narrow" }),
    {
      signals: [
        { name: "cat", value: "all", on: seg.on },
        { name: "q", value: "", bind: { input: "text", placeholder: "Search exception…", name: "Search " } },
        { name: "totalExc", update: "length(data('exsum')) ? max(1, data('exsum')[0].volume) : 1" },
      ],
      data: [
        ctx("ex_raw", {
          body: {
            aggs: {
              m: {
                filter: { bool: { filter: [MAPPED, EXC] } },
                aggs: {
                  r: {
                    terms: { field: "exception.reason_display", size: 200 },
                    aggs: { t: { terms: { field: "exception.type", size: 1 } }, rw: { sum: { field: "value.rework_gbp" } }, last: { max: { field: "@timestamp" } } },
                  },
                },
              },
            },
          },
          property: "aggregations.m.r.buckets",
        }),
        {
          name: "ex",
          source: "ex_raw",
          transform: [
            { type: "formula", as: "name", expr: "datum.key" },
            { type: "formula", as: "type", expr: "datum.t.buckets[0].key" },
            { type: "formula", as: "volume", expr: "datum.doc_count" },
            { type: "formula", as: "cost", expr: "datum.rw.value" },
            { type: "formula", as: "lastSeen", expr: "datum.last.value" },
          ],
        },
        { name: "exsum", source: "ex", transform: [{ type: "aggregate", ops: ["sum"], fields: ["volume"], as: ["volume"] }] },
        {
          name: "exv",
          source: "ex",
          transform: [
            { type: "filter", expr: "(cat === 'all' || datum.type === cat) && (!q || indexof(lower(datum.name), lower(q)) >= 0)" },
            { type: "formula", as: "pct", expr: "datum.volume / totalExc" },
          ],
        },
      ],
      marks: seg.marks,
    },
    table({
      data: "exv",
      rowH: 29,
      sort: { key: "volume", dir: "descending" },
      columns: [
        { label: "Exception", sortKey: "name", text: "datum.name + '   ' + (datum.type === 'System' ? 'SYS' : 'BUS')", swatch: `datum.type === 'System' ? '${C.system}' : '${C.business}'` },
        { label: "Volume", sortKey: "volume", w: 110, align: "right", text: F.int("datum.volume") },
        { label: "% of total", sortKey: "pct", w: 120, align: "right", text: F.pct("datum.pct") },
        { label: "Cost", sortKey: "cost", w: 120, align: "right", text: F.gbp("datum.cost") },
        { label: "Most recent", sortKey: "lastSeen", w: 130, align: "right", text: F.day("datum.lastSeen") },
      ],
    }),
  );
};

export const dashboard = {
  id: "exceptions",
  title: "IA · Exceptions",
  description: "Exception heatmap and searchable detail",
  time: { from: "now-89d/d", to: "now" },
  panels: [
    { id: "kpis", title: "Exceptions KPIs", grid: { x: 0, y: 0, w: 48, h: 4 }, build: kpis },
    { id: "heatmap", title: "Exception heatmap", grid: { x: 0, y: 4, w: 48, h: 16 }, build: heatmap },
    { id: "detail", title: "Exception detail", grid: { x: 0, y: 20, w: 48, h: 20 }, build: detail },
  ],
};
