// ---------------------------------------------------------------------------
// kit.mjs — reusable Vega building blocks. Each returns plain spec fragments
// ({signals, data, scales, marks}) that a panel merges with merge(). Nothing
// here queries Elasticsearch; panels own their queries (see es.mjs).
// ---------------------------------------------------------------------------
import { C, FONT } from "./tokens.mjs";
import { F } from "./fmt.mjs";

export const PAD = 16;

// Merge spec fragments: arrays concatenate, the rest last-wins.
export function merge(...parts) {
  const out = { signals: [], data: [], scales: [], marks: [] };
  for (const p of parts.flat()) {
    if (!p) continue;
    for (const k of ["signals", "data", "scales", "marks"]) if (p[k]) out[k].push(...p[k]);
  }
  return out;
}

// Rough text width for static labels (body 12px), used to lay out legends
// and segmented controls at build time. Vega has no text measurement.
export const textW = (s, px = 12, mono = false) => Math.ceil(String(s).length * px * (mono ? 0.62 : 0.5)) + 2;

// Uppercase mono kicker with a little tracking (Vega has no letter-spacing).
export const kicker = (s) => String(s).toUpperCase();

// --- panel frame ----------------------------------------------------------------
// Draws the card the React app puts around every visual: serif title, muted
// subtitle and an optional legend on the right. Exposes signal "top" (y where
// content starts) plus "cw"/"ch" (content width/height).
export function frame({ title, subtitle, legend, legendBelow = false, titleSignal, subtitleSignal }) {
  // Platform Health card header: a small mono kicker with the subtitle running
  // on after it, one quiet line instead of a serif title block.
  const hasSub = !!(subtitle || subtitleSignal);
  const titleExpr = titleSignal ? `upper(${titleSignal})` : `'${String(title).toUpperCase().replace(/'/g, "\\'")}'`;
  let top = 42;
  const marks = [
    {
      type: "text",
      name: "frame_title",
      encode: {
        update: {
          x: { value: PAD },
          y: { value: PAD + 2 },
          baseline: { value: "top" },
          font: { value: FONT.mono },
          fontSize: { value: 11 },
          fontWeight: { value: 600 },
          fill: { value: C.ink },
          text: { signal: titleExpr },
          limit: { signal: "width - 32" },
        },
      },
    },
  ];
  if (hasSub) {
    marks.push({
      type: "text",
      encode: {
        update: {
          x: { signal: `${PAD} + length(${titleExpr}) * 6.9 + 10` },
          y: { value: PAD + 1 },
          baseline: { value: "top" },
          font: { value: FONT.body },
          fontSize: { value: 12 },
          fill: { value: C.inkSoft },
          text: subtitleSignal ? { signal: subtitleSignal } : { value: subtitle },
          limit: { signal: `width - ${2 * PAD + 10} - length(${titleExpr}) * 6.9 - ${legend && !legendBelow ? legendWidth(legend) + 12 : 0} - headerRight` },
        },
      },
    });
  }
  if (legend?.length) {
    if (legendBelow) {
      marks.push(...legendMarks(legend, { x: PAD, y: top - 6, align: "left" }));
      top += 16;
    } else {
      marks.push(...legendMarks(legend, { y: PAD + 1, align: "right" }));
    }
  }
  return {
    signals: [
      { name: "headerRight", value: 0 },
      { name: "top", value: top },
      { name: "cw", update: `width - ${2 * PAD}` },
      { name: "ch", update: `height - top - ${PAD}` },
    ],
    marks,
  };
}

const legendItemW = (l) => 11 + 6 + textW(l.label, 12) + 14;
export const legendWidth = (items) => items.reduce((s, l) => s + legendItemW(l), 0);

// Static legend: square swatch + label, laid out at build time.
export function legendMarks(items, { x, y, align = "right" }) {
  const total = legendWidth(items);
  let cursor = 0;
  const marks = [];
  for (const l of items) {
    const xExpr = align === "right" ? `width - ${PAD} - ${total} + ${cursor}` : `${x + cursor}`;
    marks.push({
      type: "rect",
      encode: { update: { x: { signal: xExpr }, y: { value: y }, width: { value: 11 }, height: { value: 11 }, cornerRadius: { value: 3 }, fill: { value: l.color }, ...(l.dashed ? { fillOpacity: { value: 0 }, stroke: { value: l.color }, strokeDash: { value: [3, 2] } } : {}) } },
    });
    marks.push({
      type: "text",
      encode: { update: { x: { signal: `${xExpr} + 17` }, y: { value: y + 5.5 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.inkSoft }, text: { value: l.label } } },
    });
    cursor += legendItemW(l);
  }
  return marks;
}

// Centred message for an empty or not-applicable state.
export function emptyNote(test, text, { color = C.inkSoft, y = "top + ch / 2" } = {}) {
  return {
    type: "text",
    encode: {
      update: {
        x: { signal: "width / 2" },
        y: { signal: y },
        align: { value: "center" },
        baseline: { value: "middle" },
        font: { value: FONT.body },
        fontSize: { value: 13 },
        fill: { value: color },
        text: typeof text === "string" && !text.startsWith("=") ? { value: text } : { signal: text.slice(1) },
        opacity: { signal: `(${test}) ? 1 : 0` },
      },
    },
  };
}

// --- KPI tiles -------------------------------------------------------------------
// Draws the React KpiCard row across the whole panel from a dataset whose rows
// carry: i (0..n-1), label, value (string), sub, accent, delta (fraction or
// null), deltaGood ('up'|'down'), target (string or null), met (bool).
// Optional sparkline dataset: rows of {tile, i, v} (tile = KPI index).
export function kpiTiles({ data = "tiles", n, spark = null, gap = 10 }) {
  // Platform Health tile: white card, mono kicker, Fraunces figure, soft
  // tinted pills for the change and the target, muted note underneath.
  const tileW = `(width - ${gap * (n - 1)}) / ${n}`;
  const pillW = (t) => `(length(${t}) * 6.6 + 18)`;
  const deltaText = `(isValid(parent.delta) ? ${F.delta("parent.delta")} : '')`;
  const deltaGood = `(abs(parent.delta) < 0.001 ? 0 : (parent.deltaGood === 'down' ? parent.delta <= 0 : parent.delta >= 0) ? 1 : -1)`;
  const tgtText = `(isValid(parent.target) && parent.target !== '' ? (parent.met ? 'ON ' : 'OFF ') + parent.target : '')`;
  return {
    marks: [
      {
        type: "group",
        name: "tile",
        from: { data },
        encode: {
          update: {
            x: { signal: `datum.i * (${tileW} + ${gap})` },
            y: { value: 0 },
            width: { signal: tileW },
            height: { signal: "height" },
            fill: { value: C.paper },
            stroke: { value: C.rule },
            cornerRadius: { value: 16 },
          },
        },
        marks: [
          { type: "text", encode: { update: { x: { value: 16 }, y: { value: 16 }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { signal: "upper(parent.label)" }, limit: { signal: "item.mark.group.width - 28" } } } },
          { type: "text", encode: { update: { x: { value: 16 }, y: { value: 32 }, baseline: { value: "top" }, font: { value: FONT.display }, fontSize: { signal: "item.mark.group.width < 170 ? 24 : 28" }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { field: { parent: "value" } } } } },
          // change pill
          { type: "rect", encode: { update: { x: { value: 16 }, y: { value: 72 }, width: { signal: pillW(deltaText) }, height: { value: 18 }, cornerRadius: { value: 9 }, fill: { signal: `${deltaGood} > 0 ? '${C.goodFill}' : ${deltaGood} < 0 ? '${C.badFill}' : '${C.band}'` }, opacity: { signal: `${deltaText} ? 1 : 0` } } } },
          { type: "text", encode: { update: { x: { value: 25 }, y: { value: 81 }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { signal: `${deltaGood} > 0 ? '${C.good}' : ${deltaGood} < 0 ? '${C.bad}' : '${C.inkSoft}'` }, text: { signal: deltaText } } } },
          // target pill
          { type: "rect", encode: { update: { x: { signal: `${deltaText} ? 16 + ${pillW(deltaText)} + 6 : 16` }, y: { value: 72 }, width: { signal: `${pillW(tgtText)} + 8` }, height: { value: 18 }, cornerRadius: { value: 9 }, fill: { signal: `parent.met ? '${C.goodFill}' : '${C.badFill}'` }, opacity: { signal: `${tgtText} ? 1 : 0` } } } },
          { type: "symbol", encode: { update: { x: { signal: `(${deltaText} ? 16 + ${pillW(deltaText)} + 6 : 16) + 10` }, y: { value: 81 }, size: { value: 20 }, fill: { signal: `parent.met ? '${C.good}' : '${C.bad}'` }, opacity: { signal: `${tgtText} ? 1 : 0` } } } },
          { type: "text", encode: { update: { x: { signal: `(${deltaText} ? 16 + ${pillW(deltaText)} + 6 : 16) + 17` }, y: { value: 81 }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { signal: `parent.met ? '${C.good}' : '${C.bad}'` }, text: { signal: tgtText }, limit: { signal: "item.mark.group.width - 60" } } } },
          // note
          { type: "text", encode: { update: { x: { value: 16 }, y: { signal: `(${deltaText} || ${tgtText}) ? 100 : 76` }, baseline: { value: "top" }, font: { value: FONT.body }, fontSize: { value: 11.5 }, fill: { value: C.inkSoft }, text: { field: { parent: "sub" } }, limit: { signal: "item.mark.group.width - 28" } } } },
        ],
      },
      ...(spark
        ? [
            {
              type: "group",
              from: { facet: { data: spark, name: "sp", groupby: "tile" } },
              encode: { update: { x: { signal: `datum.tile * (${tileW} + ${gap}) + ${tileW} - 84` }, y: { value: 34 }, width: { value: 68 }, height: { value: 26 } } },
              scales: [
                { name: "sx", type: "linear", domain: { data: "sp", field: "i" }, range: [1, 67] },
                { name: "sy", type: "linear", domain: { data: "sp", field: "v" }, range: [24, 2], zero: false },
              ],
              marks: [
                { type: "area", from: { data: "sp" }, encode: { update: { x: { scale: "sx", field: "i" }, y: { scale: "sy", field: "v" }, y2: { value: 26 }, fill: { value: C.sage }, fillOpacity: { value: 0.9 } } } },
                { type: "line", from: { data: "sp" }, encode: { update: { x: { scale: "sx", field: "i" }, y: { scale: "sy", field: "v" }, stroke: { value: C.ink }, strokeWidth: { value: 1.4 }, strokeJoin: { value: "round" } } } },
              ],
            },
          ]
        : []),
    ],
  };
}

// --- time series chart -------------------------------------------------------------
// A group in the content area drawing the React LineChart: horizontal grid,
// mono axis labels, optional weekend bands, line/area series, dashed series,
// labelled reference lines and a hover rule with tooltip.
//   data:     dataset with one row per x step (field "t" = ms timestamp)
//   series:   [{ field, name, color, area?, dashed? }]
//   yFmt:     expression builder for axis labels, tipFmt for tooltip values
//   refLines: [{ value (signal expr), label (expr or string), color }]
//   xBand:    'day' (band per day) | 'month'
export function timeChart({ data, series, yFmt = F.compact, tipFmt = F.int, refLines = [], weekends = false, xBand = "day", yMaxFloor = null, yDomain = null, forecast = null, top = "top", height = "ch", name = "chart", xFmt = null, tipDateFmt = null, markers = null }) {
  const yFields = series.map((s) => s.field);
  if (forecast) yFields.push(...forecast.fields);
  const yDomainSpec = yDomain ?? { signal: `[0, max(${yMaxFloor ?? 0}, ${name}_ymax)]` };
  const signals = [
    { name: `${name}_ymax`, update: `max(${series.map((x) => `extent(pluck(data('${data}'), '${x.field}'))[1] || 0`).concat(forecast ? forecast.fields.map((f) => `extent(pluck(data('${data}_fc'), '${f}'))[1] || 0`) : []).join(", ")}, ${refLines.length ? refLines.map((r) => r.value).join(", ") : 0})` },
  ];
  const xField = "t";
  const scales = [
    {
      name: `${name}_x`,
      type: "utc",
      domain: forecast ? { signal: `[lo, hi + ${forecast.periods ?? 14} * 86400000]` } : { data, field: xField },
      range: [0, { signal: "cw - 44" }],
    },
    { name: `${name}_y`, type: "linear", domain: yDomainSpec, range: [{ signal: `${height} - 22` }, 0], nice: true, zero: !yDomain },
  ];
  const groupMarks = [];
  // weekend bands: one rect per Sat/Sun
  if (weekends) {
    groupMarks.push({
      type: "rect",
      from: { data },
      encode: {
        update: {
          x: { signal: `scale('${name}_x', datum.t - 43200000)` },
          x2: { signal: `scale('${name}_x', datum.t + 43200000)` },
          y: { value: 0 },
          y2: { signal: `${height} - 22` },
          fill: { value: C.ink },
          fillOpacity: { signal: `(${weekends === true ? "true" : weekends}) && (utcday(datum.t) === 0 || utcday(datum.t) === 6) ? 0.03 : 0` },
        },
      },
    });
  }
  if (forecast) {
    groupMarks.push(
      {
        type: "rect",
        encode: {
          update: {
            x: { signal: `scale('${name}_x', ${forecast.start})` },
            x2: { signal: "cw - 44" },
            y: { value: 0 },
            y2: { signal: `${height} - 22` },
            fill: { value: C.ink },
            fillOpacity: { value: 0.04 },
          },
        },
      },
      {
        type: "rule",
        encode: { update: { x: { signal: `scale('${name}_x', ${forecast.start})` }, y: { value: 0 }, y2: { signal: `${height} - 22` }, stroke: { value: C.inkSoft }, strokeDash: { value: [2, 3] } } },
      },
      {
        type: "text",
        encode: { update: { x: { signal: "cw - 40" }, y: { value: 8 }, align: { value: "right" }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 9.5 }, fill: { value: C.inkSoft }, text: { value: "FORECAST" } } },
      },
    );
  }
  for (const s of series) {
    if (s.area) {
      groupMarks.push({
        type: "area",
        from: { data },
        encode: {
          update: {
            x: { scale: `${name}_x`, field: xField },
            y: { scale: `${name}_y`, field: s.field },
            y2: { scale: `${name}_y`, value: 0 },
            fill: { value: s.color },
            fillOpacity: { value: 0.07 },
            interpolate: { value: "linear" },
          },
        },
      });
    }
  }
  if (forecast) {
    for (const fz of forecast.series) {
      groupMarks.push(
        {
          type: "area",
          from: { data: `${data}_fc` },
          encode: { update: { x: { scale: `${name}_x`, field: xField }, y: { scale: `${name}_y`, field: fz.lo }, y2: { scale: `${name}_y`, field: fz.hi }, fill: { value: fz.color }, fillOpacity: { value: 0.12 } } },
        },
        {
          type: "line",
          from: { data: `${data}_fc` },
          encode: { update: { x: { scale: `${name}_x`, field: xField }, y: { scale: `${name}_y`, field: fz.point }, stroke: { value: fz.color }, strokeWidth: { value: 1.8 }, strokeDash: { value: [4, 3] } } },
        },
      );
    }
  }
  for (const s of series) {
    groupMarks.push({
      type: "line",
      from: { data },
      encode: {
        update: {
          x: { scale: `${name}_x`, field: xField },
          y: { scale: `${name}_y`, field: s.field },
          stroke: { value: s.color },
          strokeWidth: { value: s.width ?? 2 },
          ...(s.dashed ? { strokeDash: { value: [4, 3] } } : {}),
          strokeJoin: { value: "round" },
          interpolate: { value: "linear" },
          defined: { signal: `isValid(datum['${s.field}'])` },
        },
      },
    });
  }
  for (const r of refLines) {
    groupMarks.push(
      {
        type: "rule",
        encode: {
          update: {
            x: { value: 0 },
            x2: { signal: "cw - 44" },
            y: { scale: `${name}_y`, signal: r.value },
            stroke: { value: r.color },
            strokeWidth: { value: 1.2 },
            strokeDash: { value: [5, 4] },
          },
        },
      },
      {
        type: "text",
        encode: {
          update: {
            x: { value: 4 },
            y: { scale: `${name}_y`, signal: r.value, offset: -4 },
            baseline: { value: "bottom" },
            font: { value: FONT.mono },
            fontSize: { value: 10 },
            fontWeight: { value: 600 },
            fill: { value: r.color },
            stroke: { value: C.paper },
            strokeWidth: { value: 3 },
            strokeOpacity: { value: 0.9 },
            text: { signal: r.label },
          },
        },
      },
      {
        type: "text",
        encode: {
          update: {
            x: { value: 4 },
            y: { scale: `${name}_y`, signal: r.value, offset: -4 },
            baseline: { value: "bottom" },
            font: { value: FONT.mono },
            fontSize: { value: 10 },
            fontWeight: { value: 600 },
            fill: { value: r.color },
            text: { signal: r.label },
          },
        },
      },
    );
  }
  // hover: nearest-x rule + tooltip on an invisible full-height band per point
  const tipObj = `{'Date': ${tipDateFmt ? tipDateFmt("datum.t") : xBand === "month" ? F.month("datum.t") : F.dayLong("datum.t")}, ${series.map((s) => `'${s.name}': ${tipFmt(`datum['${s.field}']`)}`).join(", ")}}`;
  groupMarks.push({
    type: "rect",
    name: `${name}_hover`,
    from: { data },
    encode: {
      update: {
        x: { signal: `scale('${name}_x', datum.t) - max(2, (cw - 44) / max(1, length(data('${data}'))) / 2)` },
        width: { signal: `max(4, (cw - 44) / max(1, length(data('${data}'))))` },
        y: { value: 0 },
        y2: { signal: `${height} - 22` },
        fill: { value: C.ink },
        fillOpacity: { value: 0 },
        tooltip: { signal: tipObj },
      },
      hover: { fillOpacity: { value: 0.06 } },
    },
  });

  // release / change markers: rows {t, label}. Filtered to the plotted range
  // (invisible marks outside it would still stretch the panel's bounds).
  const extraData = [];
  if (markers) {
    const ext = `extent(pluck(data('${data}'), 't'))`;
    extraData.push({ name: `${name}_mk`, source: markers, transform: [{ type: "filter", expr: `length(data('${data}')) && datum.t >= ${ext}[0] && datum.t <= ${ext}[1]${forecast ? "" : ""}` }] });
    groupMarks.push(
      { type: "rule", from: { data: `${name}_mk` }, encode: { update: { x: { scale: `${name}_x`, field: "t" }, y: { value: 10 }, y2: { signal: `${height} - 22` }, stroke: { value: C.accent }, strokeWidth: { value: 1 }, strokeDash: { value: [2, 3] }, opacity: { value: 0.8 } } } },
      { type: "symbol", from: { data: `${name}_mk` }, encode: { update: { x: { scale: `${name}_x`, field: "t" }, y: { value: 6 }, shape: { value: "diamond" }, size: { value: 70 }, fill: { value: C.accent }, tooltip: { signal: `{'Change': datum.label, 'Date': ${F.dayLong("datum.t")}}` }, cursor: { value: "help" } } } },
    );
  }

  const axes = [
    {
      scale: `${name}_y`,
      orient: "left",
      grid: true,
      tickCount: 5,
      labelPadding: 8,
      encode: { labels: { update: { text: { signal: yFmt("datum.value") } } } },
      zindex: 0,
    },
    {
      scale: `${name}_x`,
      orient: "bottom",
      tickCount: { signal: `min(10, max(2, floor((cw - 44) / 70)))` },
      labelOverlap: true,
      labelPadding: 6,
      encode: { labels: { update: { text: { signal: xFmt ? xFmt("datum.value") : xBand === "month" ? F.month("datum.value") : F.day("datum.value") } } } },
    },
  ];

  return {
    signals,
    scales,
    data: extraData,
    marks: [
      {
        type: "group",
        name,
        encode: { update: { x: { value: PAD + 44 }, y: { signal: top }, width: { signal: "cw - 44" }, height: { signal: `${height} - 22` } } },
        axes,
        marks: groupMarks,
      },
    ],
  };
}

// --- horizontal bars (HBarChart) ---------------------------------------------------
// rows: dataset with fields label, value, display (string), sub (string|null),
// color, id. Track behind each bar, label left, value right. Rows that do not
// fit are dropped with a "+N more" note.
export function hbars({ data, labelW = 150, valueW = 64, rowH = 32, barH = 10, click = null, top = "top", height = "ch", subInBar = true, activeTest = null }) {
  return {
    signals: [{ name: "hb_fit", update: `max(1, floor((${height}) / ${rowH}))` }],
    data: [
      {
        name: "hb_rows",
        source: data,
        transform: [
          { type: "window", ops: ["row_number"], as: ["rank"] },
          { type: "filter", expr: "datum.rank <= hb_fit" },
        ],
      },
    ],
    scales: [{ name: "hb_x", type: "linear", domain: { data, field: "value" }, range: [0, { signal: `cw - ${labelW + valueW + 16}` }], zero: true, nice: false }],
    marks: [
      {
        type: "group",
        name: "hb_row",
        from: { data: "hb_rows" },
        encode: {
          update: {
            x: { value: PAD },
            y: { signal: `${top} + (datum.rank - 1) * ${rowH}` },
            width: { signal: "cw" },
            height: { value: rowH },
            fill: { value: "transparent" },
            cursor: click ? { value: "pointer" } : undefined,
            opacity: activeTest ? { signal: `(${activeTest}) ? 1 : 0.45` } : { value: 1 },
          },
        },
        marks: [
          {
            type: "text",
            encode: {
              update: {
                x: { value: 0 },
                y: { value: rowH / 2 },
                baseline: { value: "middle" },
                font: { value: FONT.body },
                fontSize: { value: 12.5 },
                fill: { value: C.ink },
                text: { field: { parent: "label" } },
                limit: { value: labelW - 10 },
              },
            },
          },
          {
            type: "rect",
            encode: {
              update: { x: { value: labelW }, y: { value: (rowH - barH) / 2 }, width: { signal: `cw - ${labelW + valueW + 16}` }, height: { value: barH }, fill: { value: C.track }, cornerRadius: { value: barH / 2 } },
            },
          },
          {
            type: "rect",
            encode: {
              update: {
                x: { value: labelW },
                y: { value: (rowH - barH) / 2 },
                width: { signal: `max(2, scale('hb_x', parent.value))` },
                height: { value: barH },
                fill: { field: { parent: "color" } },
                cornerRadius: { value: barH / 2 },
                tooltip: { signal: "parent.sub ? {'': parent.label, 'Value': parent.display, 'Detail': parent.sub} : {'': parent.label, 'Value': parent.display}" },
              },
            },
          },
          ...(subInBar
            ? [
                {
                  type: "text",
                  encode: {
                    update: {
                      x: { signal: `cw - ${valueW + 22}` },
                      y: { value: rowH / 2 },
                      align: { value: "right" },
                      baseline: { value: "middle" },
                      font: { value: FONT.mono },
                      fontSize: { value: 10 },
                      fill: { value: C.inkSoft },
                      text: { signal: "parent.sub || ''" },
                    },
                  },
                },
              ]
            : []),
          {
            type: "text",
            encode: {
              update: {
                x: { signal: "cw" },
                y: { value: rowH / 2 },
                align: { value: "right" },
                baseline: { value: "middle" },
                font: { value: FONT.mono },
                fontSize: { value: 12 },
                fontWeight: { value: 600 },
                fill: { value: C.ink },
                text: { field: { parent: "display" } },
              },
            },
          },
        ],
      },
      {
        type: "text",
        encode: {
          update: {
            x: { signal: "width - 16" },
            y: { signal: `${top} + ${height} - 4` },
            align: { value: "right" },
            font: { value: FONT.mono },
            fontSize: { value: 10 },
            fill: { value: C.inkSoft },
            text: { signal: `length(data('${data}')) > hb_fit ? '+' + (length(data('${data}')) - hb_fit) + ' more' : ''` },
          },
        },
      },
    ],
  };
}

// --- table -------------------------------------------------------------------------
// columns: [{ label, w (px, or 0 = flexible), align, text (expr on datum),
//            color (expr), bold, font ('mono'|'body'), swatch (expr colour) }]
// The flexible column takes the remaining width. Rows beyond the available
// height are cut with a "+N more" line. Optional sortable headers.
export function table({ data, columns, rowH = 26, headH = 26, top = "top", height = "ch", band = false, sort = null, totals = null, x = PAD, widthExpr = "cw", name = "tb", rowClick = false }) {
  const fixed = columns.reduce((s, c) => s + (c.w || 0), 0);
  const flexCount = columns.filter((c) => !c.w).length || 1;
  const colX = [];
  let acc = "0";
  for (const c of columns) {
    colX.push(acc);
    const w = c.w ? `${c.w}` : `((${widthExpr} - ${fixed}) / ${flexCount})`;
    acc = `${acc} + ${w}`;
  }
  const colW = (c) => (c.w ? `${c.w}` : `((${widthExpr} - ${fixed}) / ${flexCount})`);
  const signals = [{ name: `${name}_fit`, update: `max(0, floor((${height} - ${headH} - ${totals ? rowH : 0} - 14) / ${rowH}))` }];
  if (sort) {
    signals.push(
      { name: `${name}_sortKey`, value: sort.key },
      { name: `${name}_sortDir`, value: sort.dir ?? "descending" },
      {
        name: `${name}_sortClick`,
        on: [{ events: columns.map((c, i) => (c.sortKey ? `@${name}_head${i}:click` : null)).filter(Boolean).join(", "), update: "datum.sortKey" }],
      },
    );
    signals.find((s) => s.name === `${name}_sortKey`).on = [{ events: { signal: `${name}_sortClick` }, update: `${name}_sortClick` }];
    signals.find((s) => s.name === `${name}_sortDir`).on = [
      { events: { signal: `${name}_sortClick` }, update: `${name}_sortClick === ${name}_sortKey ? (${name}_sortDir === 'descending' ? 'ascending' : 'descending') : 'descending'` },
    ];
  }
  const rowsData = {
    name: `${name}_rows`,
    source: data,
    transform: [
      ...(sort ? [{ type: "collect", sort: { field: { signal: `${name}_sortKey` }, order: { signal: `${name}_sortDir` } } }] : []),
      { type: "window", ops: ["row_number"], as: ["rank"] },
      { type: "filter", expr: `datum.rank <= ${name}_fit` },
    ],
  };
  const fontOf = (c) => (c.font === "mono" ? FONT.mono : FONT.body);
  const cellText = (c, i, src) => ({
    type: "text",
    encode: {
      update: {
        x: { signal: c.align === "right" ? `${colX[i]} + ${colW(c)} - 10` : `${colX[i]} + ${c.swatch ? 26 : 10}` },
        y: { value: rowH / 2 },
        align: { value: c.align ?? "left" },
        baseline: { value: "middle" },
        font: { value: fontOf(c) },
        fontSize: { value: c.size ?? (c.font === "mono" ? 11 : 12) },
        fontWeight: { value: c.bold ? "bold" : "normal" },
        fill: c.color ? { signal: c.color.replaceAll("datum.", `${src}.`) } : { value: C.ink },
        text: { signal: c.text.replaceAll("datum.", `${src}.`) },
        limit: { signal: `${colW(c)} - ${c.swatch ? 32 : 16}` },
        tooltip: c.tip ? { signal: c.tip.replaceAll("datum.", `${src}.`) } : undefined,
      },
    },
  });
  const header = {
    type: "group",
    encode: { update: { x: { value: x }, y: { signal: top }, width: { signal: widthExpr }, height: { value: headH } } },
    marks: [
      { type: "rule", encode: { update: { x: { value: 0 }, x2: { signal: widthExpr }, y: { value: headH - 0.5 }, stroke: { value: C.rule } } } },
      ...columns.map((c, i) => ({
        type: "text",
        name: sort && c.sortKey ? `${name}_head${i}` : undefined,
        from: sort && c.sortKey ? { data: `${name}_hd${i}` } : undefined,
        encode: {
          update: {
            x: { signal: c.align === "right" ? `${colX[i]} + ${colW(c)} - 10` : `${colX[i]} + 10` },
            y: { value: headH / 2 },
            align: { value: c.align ?? "left" },
            baseline: { value: "middle" },
            font: { value: FONT.mono },
            fontSize: { value: 10 },
            fontWeight: { value: 600 },
            fill: sort && c.sortKey ? { signal: `${name}_sortKey === '${c.sortKey}' ? '${C.ink}' : '${C.inkSoft}'` } : { value: C.inkSoft },
            text: c.labelExpr ? { signal: `upper(${c.labelExpr})` } : sort && c.sortKey ? { signal: `'${c.label.toUpperCase()}' + (${name}_sortKey === '${c.sortKey}' ? (${name}_sortDir === 'descending' ? ' ▾' : ' ▴') : '')` } : { value: c.label.toUpperCase() },
            cursor: sort && c.sortKey ? { value: "pointer" } : undefined,
            limit: { signal: `${colW(c)} - 12` },
          },
        },
      })),
    ],
  };
  const extraData = sort ? columns.map((c, i) => (c.sortKey ? { name: `${name}_hd${i}`, values: [{ sortKey: c.sortKey }] } : null)).filter(Boolean) : [];
  const body = {
    type: "group",
    name: `${name}_row`,
    from: { data: `${name}_rows` },
    encode: {
      update: {
        x: { value: x },
        y: { signal: `${top} + ${headH} + (datum.rank - 1) * ${rowH}` },
        width: { signal: widthExpr },
        height: { value: rowH },
        fill: { signal: band ? `datum.rank % 2 === 0 ? '${C.band}' : 'transparent'` : "'transparent'" },
        cursor: { value: rowClick ? "pointer" : "default" },
      },
      ...(rowClick ? { hover: { fill: { value: C.track } } } : {}),
    },
    marks: [
      { type: "rule", encode: { update: { x: { value: 0 }, x2: { signal: widthExpr }, y: { value: rowH - 0.5 }, stroke: { value: C.rule }, strokeOpacity: { value: 0.7 } } } },
      ...columns.flatMap((c, i) => {
        const out = [];
        if (c.swatch) {
          out.push({
            type: "rect",
            encode: { update: { x: { signal: `${colX[i]} + 10` }, y: { value: rowH / 2 - 5 }, width: { value: 10 }, height: { value: 10 }, cornerRadius: { value: 3 }, fill: { signal: c.swatch.replaceAll("datum.", "parent.") } } },
          });
        }
        if (c.bar) {
          out.push(
            { type: "rect", encode: { update: { x: { signal: `${colX[i]} + 10` }, y: { value: rowH / 2 - 4 }, width: { signal: `${colW(c)} - 60` }, height: { value: 8 }, cornerRadius: { value: 3 }, fill: { value: C.track } } } },
            {
              type: "rect",
              encode: {
                update: {
                  x: { signal: `${colX[i]} + 10` },
                  y: { value: rowH / 2 - 4 },
                  width: { signal: `max(2, (${colW(c)} - 60) * clamp(${c.bar.replaceAll("datum.", "parent.")}, 0, 1))` },
                  height: { value: 8 },
                  cornerRadius: { value: 3 },
                  fill: { signal: (c.barColor ?? `'${C.ink}'`).replaceAll("datum.", "parent.") },
                },
              },
            },
          );
        }
        if (c.spark) out.push(...[].concat(c.spark(colX[i], colW(c), rowH)));
        if (c.text) out.push(cellText(c, i, "parent"));
        return out;
      }),
    ],
  };
  const marks = [header, body];
  if (totals) {
    marks.push({
      type: "group",
      encode: {
        update: {
          x: { value: x },
          y: { signal: `${top} + ${headH} + min(length(data('${data}')), ${name}_fit) * ${rowH}` },
          width: { signal: widthExpr },
          height: { value: rowH },
        },
      },
      marks: [
        { type: "rule", encode: { update: { x: { value: 0 }, x2: { signal: widthExpr }, y: { value: 0 }, stroke: { value: C.ink }, strokeWidth: { value: 1.5 } } } },
        ...columns.map((c, i) => {
          const t = totals[i];
          if (t == null) return null;
          return {
            type: "text",
            encode: {
              update: {
                x: { signal: c.align === "right" ? `${colX[i]} + ${colW(c)} - 10` : `${colX[i]} + 10` },
                y: { value: rowH / 2 },
                align: { value: c.align ?? "left" },
                baseline: { value: "middle" },
                font: { value: fontOf(c) },
                fontSize: { value: c.size ?? (c.font === "mono" ? 11 : 12) },
                fontWeight: { value: 600 },
                fill: { value: C.ink },
                text: { signal: t },
              },
            },
          };
        }).filter(Boolean),
      ],
    });
  }
  marks.push({
    type: "text",
    encode: {
      update: {
        x: { signal: `${x} + ${widthExpr}` },
        y: { signal: `${top} + ${height} - 2` },
        align: { value: "right" },
        baseline: { value: "bottom" },
        font: { value: FONT.mono },
        fontSize: { value: 10 },
        fill: { value: C.inkSoft },
        text: { signal: `length(data('${data}')) > ${name}_fit ? '+' + (length(data('${data}')) - ${name}_fit) + ' more rows: widen the panel or filter' : ''` },
      },
    },
  });
  return { signals, data: [...extraData, rowsData], marks };
}

// Inline sparkline cell for table() (12-week trend etc.). seriesData rows carry
// {key, i, v}; keyExpr picks the row's series.
export function sparkCell({ seriesData, keyField, colorExpr = `'${C.ink}'`, w = 56, h = 18 }) {
  return (x, colW, rowH) => ({
    type: "group",
    from: { facet: { data: seriesData, name: "row_sp", groupby: keyField } },
    encode: { update: { x: { signal: `${x} + ${colW} - ${w} - 10` }, y: { value: (rowH - h) / 2 }, width: { value: w }, height: { value: h } } },
    marks: [],
  });
}

// Small segmented control drawn in Vega (React's <Segmented/>), bound to a
// signal. options: [{ value, label }]. Returns marks for the header area.
export function segmented({ signal, options, xRight = PAD, y = PAD - 4 }) {
  const widths = options.map((o) => textW(o.label, 11.5) + 18);
  const total = widths.reduce((a, b) => a + b, 0) + 6;
  const marks = [
    {
      type: "rect",
      encode: { update: { x: { signal: `width - ${xRight} - ${total}` }, y: { value: y }, width: { value: total }, height: { value: 24 }, cornerRadius: { value: 12 }, fill: { value: C.band }, stroke: { value: C.rule } } },
    },
  ];
  let cursor = 3;
  options.forEach((o, i) => {
    const xExpr = `width - ${xRight} - ${total} + ${cursor}`;
    marks.push(
      {
        type: "rect",
        name: `seg_${signal}_${i}`,
        encode: {
          update: {
            x: { signal: xExpr },
            y: { value: y + 2 },
            width: { value: widths[i] },
            height: { value: 20 },
            cornerRadius: { value: 10 },
            fill: { signal: `${signal} === '${o.value}' ? '${C.sage}' : 'transparent'` },
            stroke: { value: 'transparent' },
            cursor: { value: "pointer" },
          },
        },
      },
      {
        type: "text",
        interactive: false,
        encode: {
          update: {
            x: { signal: `${xExpr} + ${widths[i] / 2}` },
            y: { value: y + 12 },
            align: { value: "center" },
            baseline: { value: "middle" },
            font: { value: FONT.body },
            fontSize: { value: 11.5 },
            fontWeight: { signal: `${signal} === '${o.value}' ? 600 : 'normal'` },
            fill: { signal: `${signal} === '${o.value}' ? '${C.ink}' : '${C.inkSoft}'` },
            text: { value: o.label },
          },
        },
      },
    );
    cursor += widths[i];
  });
  const on = options.map((o, i) => ({ events: `@seg_${signal}_${i}:click`, update: `'${o.value}'` }));
  return { width: total, marks, on };
}
