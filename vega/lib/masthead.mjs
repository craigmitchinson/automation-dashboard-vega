// ---------------------------------------------------------------------------
// masthead.mjs: the band across the top of every dashboard. Where you are
// (group, page, what it answers) and what you are looking at (period, scope,
// how fresh the data is), so a screenshot or a PDF always carries its context.
// ---------------------------------------------------------------------------
import { C, FONT, IDX } from "./tokens.mjs";
import { ctx, plain } from "./es.mjs";

const SAGE = "#BFD6CC";
const SAGE_DIM = "#8FB3A6";

// mode: 'window' (the picker's days), 'now' (live, picker end), 'fy' (fiscal year to date)
export function masthead({ group, index, total, title, purpose, mode = "window" }) {
  const D = 86400000;
  const period =
    mode === "now"
      ? "'24 hours to ' + utcFormat(mhNow, '%H:%M, %-d %b')"
      : mode === "fy"
        ? "'FY ' + mhFy + ' to ' + utcFormat(mhHi, '%-d %b')"
        : "utcFormat(mhLo, '%-d %b') + ' to ' + utcFormat(mhHi, '%-d %b %Y') + ' · ' + mhDays + ' days'";
  const chip = (i, label, value) => [
    { type: "text", encode: { update: { x: { signal: `chipX + ${i} * chipW` }, y: { signal: "height / 2 - 10" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 9.5 }, fontWeight: { value: 600 }, fill: { value: SAGE_DIM }, text: { value: label } } } },
    { type: "text", encode: { update: { x: { signal: `chipX + ${i} * chipW` }, y: { signal: "height / 2 + 9" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13.5 }, fontWeight: { value: 600 }, fill: { value: "#FFFFFF" }, text: { signal: value }, limit: { signal: "chipW - 16" } } } },
    ...(i ? [{ type: "rule", encode: { update: { x: { signal: `chipX + ${i} * chipW - 14` }, x2: { signal: `chipX + ${i} * chipW - 14` }, y: { signal: "height / 2 - 18" }, y2: { signal: "height / 2 + 18" }, stroke: { value: "#FFFFFF" }, strokeOpacity: { value: 0.16 } } } }] : []),
  ];
  return {
    data: [
      ctx("mh", {
        body: { aggs: { last: { max: { field: "@timestamp" } }, sp: { terms: { field: "spoke.name", size: 3 } }, nsp: { cardinality: { field: "spoke.name" } }, pr: { terms: { field: "process.name", size: 2 } }, nowb: { date_range: { field: "@timestamp", ranges: [{ key: "now", from: { "%timefilter%": "max" } }] } }, win: { date_histogram: { field: "@timestamp", fixed_interval: "1d", min_doc_count: 0, extended_bounds: { min: { "%timefilter%": "min", shift: 1, unit: "hour" }, max: { "%timefilter%": "max" } } } } } },
        property: "aggregations",
      }),
      plain("mh_spk", { index: IDX.ref, body: { size: 0, query: { term: { doc_type: "spoke" } } }, property: "hits.total" }),
      plain("mh_cfg", { index: IDX.ref, body: { size: 1, query: { term: { doc_type: "config" } } }, property: "hits.hits" }),
    ],
    signals: [
      { name: "mockNote", value: "" },
      { name: "mhB", update: "length(data('mh')) ? data('mh')[0] : null" },
      { name: "mhDays", update: "mhB ? length(mhB.win.buckets) : 0" },
      { name: "mhLo", update: "mhDays ? mhB.win.buckets[0].key : 0" },
      { name: "mhHi", update: `mhDays ? mhB.win.buckets[mhDays - 1].key + ${mode === "now" ? 0 : D - 1} : 0` },
      { name: "mhNow", update: "mhB ? mhB.nowb.buckets[0].from : 0" },
      { name: "mhLast", update: "mhB && mhB.last.value ? mhB.last.value : null" },
      { name: "mhAllSp", update: "length(data('mh_spk')) ? data('mh_spk')[0].value : 0" },
      { name: "mhNsp", update: "mhB ? mhB.nsp.value : 0" },
      {
        name: "mhScope",
        update:
          "!mhB || !mhNsp ? 'Nothing in this selection' : length(mhB.pr.buckets) === 1 ? mhB.pr.buckets[0].key : mhNsp === 1 ? mhB.sp.buckets[0].key : mhNsp >= mhAllSp ? 'All ' + mhNsp + ' hubs' : mhNsp + ' hubs'",
      },
      { name: "mhFyStart", update: "length(data('mh_cfg')) ? data('mh_cfg')[0]._source.fiscal_year_start_month : 4" },
      { name: "mhFyY", update: "utcmonth(mhHi) >= mhFyStart - 1 ? utcyear(mhHi) : utcyear(mhHi) - 1" },
      { name: "mhFy", update: "mhFyStart === 1 ? '' + mhFyY : mhFyY + '/' + pad('' + ((mhFyY + 1) % 100), 2, '0', 'left')" },
      { name: "chipW", update: "clamp(width * 0.16, 150, 230)" },
      { name: "chipX", update: "width - 3 * chipW - 6" },
    ],
    marks: [
      { type: "rect", encode: { update: { x: { value: 0 }, y: { value: 0 }, width: { signal: "width" }, height: { signal: "height" }, cornerRadius: { value: 16 }, fill: { value: C.ink } } } },
      // quiet ornament: two large arcs bleeding off the right edge (clipped, so they never stretch the panel)
      {
        type: "group",
        encode: { update: { x: { value: 0 }, y: { value: 0 }, width: { signal: "width" }, height: { signal: "height" }, clip: { value: true } } },
        marks: [
      ...[0, 1].map((k) => ({
        type: "arc",
        encode: {
          update: {
            x: { signal: `width - ${60 + k * 40}` },
            y: { signal: `height + ${30 + k * 10}` },
            innerRadius: { signal: `height * ${1.1 + k * 0.55}` },
            outerRadius: { signal: `height * ${1.1 + k * 0.55} + 1.2` },
            startAngle: { value: -Math.PI / 2 },
            endAngle: { value: 0 },
            fill: { value: "#FFFFFF" },
            fillOpacity: { value: 0.07 },
          },
        },
      })),
        ],
      },
      { type: "rect", encode: { update: { x: { value: 24 }, y: { signal: "height / 2 - 31" }, width: { value: 18 }, height: { value: 3 }, cornerRadius: { value: 1.5 }, fill: { value: C.business } } } },
      { type: "text", encode: { update: { x: { value: 50 }, y: { signal: "height / 2 - 30" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: SAGE_DIM }, text: { value: `${group.toUpperCase()} · ${index} OF ${total}` } } } },
      { type: "text", encode: { update: { x: { value: 24 }, y: { signal: "height / 2 - 4" }, baseline: { value: "middle" }, font: { value: FONT.display }, fontSize: { value: 26 }, fontWeight: { value: 650 }, fill: { value: "#FFFFFF" }, text: { value: title }, limit: { signal: "chipX - 60" } } } },
      { type: "text", encode: { update: { x: { value: 24 }, y: { signal: "height / 2 + 24" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 13 }, fill: { value: SAGE }, text: { value: purpose }, limit: { signal: "chipX - 60" } } } },
      // demonstration copies say so on every page
      { type: "text", encode: { update: { x: { signal: "width - 24" }, y: { value: 18 }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 9.5 }, fontWeight: { value: 600 }, fill: { value: C.business }, text: { signal: "mockNote" } } } },
      ...chip(0, "PERIOD", period),
      ...chip(1, "SCOPE", "mhScope"),
      ...chip(2, "LATEST ITEM", "isValid(mhLast) ? utcFormat(mhLast, '%-d %b, %H:%M UTC') : 'none in the period'"),
    ],
  };
}
