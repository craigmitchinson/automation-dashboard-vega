// Service: the run team's page. A fixed set of checks, each OK, Warning,
// Action or Out of hours, with the first thing to do. The same checks run
// every 15 minutes in etl/service-job and raise Kibana alerts, so nobody has
// to watch this page: it is where you land when an alert fires.
// No React equivalent; built on vega/lib/service.mjs.
import { C, FONT } from "../lib/tokens.mjs";
import { merge, frame, table, emptyNote, PAD } from "../lib/kit.mjs";
import { serviceBlock, HISTORY_QUERY, CHECKS, SERVICE } from "../lib/service.mjs";
import { addFilter } from "../lib/common.mjs";

const H = 3600000;
const D = 86400000;
const stroke = (s) => `(${s} === 'act' ? '${C.bad}' : ${s} === 'warn' ? '${C.warn}' : ${s} === 'ok' ? '${C.good}' : '${C.inkMuted}')`;
const tint = (s) => `(${s} === 'act' ? '${C.badFill}' : ${s} === 'warn' ? '${C.warnFill}' : ${s} === 'ok' ? '${C.goodFill}' : '${C.band}')`;
const label = (s) => `(${s} === 'act' ? 'ACTION' : ${s} === 'warn' ? 'WARNING' : ${s} === 'ok' ? 'OK' : 'OUT OF HOURS')`;
const fmtAge = (m) => `(${m} < 90 ? round(${m}) + ' min' : ${m} < 2880 ? round(${m} / 60) + ' h' : round(${m} / 1440) + ' days')`;
const rankOf = (s) => `({'quiet': 0, 'ok': 1, 'warn': 2, 'act': 3})[${s}]`;
const wrap = (sig, chars) => `replace(${sig}, regexp('(.{1,' + ${chars} + '})(\\\\s|$)', 'g'), '$1\\n')`;

// status pill: dot plus mono label on a tint, as in Platform Health
function pillMarks(state, { x, y, w = 92 }) {
  return [
    { type: "rect", encode: { update: { x: { signal: `${x}` }, y: { signal: `${y} - 9` }, width: { value: w }, height: { value: 18 }, cornerRadius: { value: 9 }, fill: { signal: tint(state) } } } },
    { type: "symbol", encode: { update: { x: { signal: `${x} + 10` }, y: { signal: `${y}` }, size: { value: 22 }, fill: { signal: stroke(state) } } } },
    { type: "text", encode: { update: { x: { signal: `${x} + 18` }, y: { signal: `${y}` }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 9.5 }, fontWeight: { value: 600 }, fill: { signal: stroke(state) }, text: { signal: label(state) } } } },
  ];
}
// the same pill as a table cell (row datum is "parent")
const pillCell = (field, w = 112) => ({ label: "Status", w, spark: (x, cw, rowH) => pillMarks(`parent.${field}`, { x: `${x} + 6`, y: `${rowH} / 2`, w: w - 16 }) });

// ---------------------------------------------------------------------------
const board = () => {
  const tw = `((width - ${PAD} - 314 - ${PAD} - 40) / 5)`;
  const th = "((height - top - 16 - 10) / 2)";
  return merge(serviceBlock(), frame({ title: "Service status", subtitleSignal: "'Checked ' + utcFormat(svNow, '%H:%M UTC, %a %d %b') + ' · alerts come from the same checks, every 15 minutes'" }), {
    marks: [
      { type: "rect", encode: { update: { x: { value: PAD }, y: { signal: "top" }, width: { value: 300 }, height: { signal: "height - top - 16" }, cornerRadius: { value: 14 }, fill: { signal: `svAct ? '${C.badFill}' : svWarn ? '${C.warnFill}' : '${C.goodFill}'` } } } },
      { type: "text", encode: { update: { x: { value: PAD + 20 }, y: { signal: "top + 22" }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10.5 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: "RIGHT NOW" } } } },
      { type: "text", encode: { update: { x: { value: PAD + 20 }, y: { signal: "top + 42" }, baseline: { value: "top" }, font: { value: FONT.display }, fontSize: { value: 30 }, fontWeight: { value: 600 }, fill: { signal: `svAct ? '${C.bad}' : svWarn ? '${C.warn}' : '${C.good}'` }, text: { signal: "svAct ? 'Action needed' : svWarn ? 'Keep an eye on it' : 'All clear'" } } } },
      { type: "text", encode: { update: { x: { value: PAD + 20 }, y: { signal: "top + 90" }, baseline: { value: "top" }, font: { value: FONT.body }, fontSize: { value: 13 }, fill: { value: C.ink }, text: { signal: "svAct + (svAct === 1 ? ' check needs' : ' checks need') + ' action · ' + svWarn + (svWarn === 1 ? ' warning' : ' warnings')" } } } },
      {
        type: "text",
        encode: {
          update: {
            x: { value: PAD + 20 },
            y: { signal: "top + 116" },
            baseline: { value: "top" },
            font: { value: FONT.body },
            fontSize: { value: 11.5 },
            fill: { value: C.inkSoft },
            lineBreak: { value: "\n" },
            lineHeight: { value: 15 },
            text: { value: "Nobody needs to watch this page.\nKibana alerts the team when a check\nmoves to Action, and again when it clears." },
          },
        },
      },
      {
        type: "group",
        encode: { update: { x: { signal: `${PAD} + 314 + 4 * (${tw} + 10)` }, y: { signal: `top + ${th} + 10` }, width: { signal: tw }, height: { signal: th }, cornerRadius: { value: 14 }, fill: { value: C.paperDeep } } },
        marks: [
          { type: "text", encode: { update: { x: { value: 16 }, y: { value: 16 }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { value: "ALERTS" } } } },
          {
            type: "text",
            encode: {
              update: {
                x: { value: 16 },
                y: { value: 38 },
                baseline: { value: "top" },
                font: { value: FONT.body },
                fontSize: { value: 11.5 },
                fill: { value: C.inkSoft },
                lineBreak: { value: "\n" },
                lineHeight: { value: 15 },
                text: { value: `Action and cleared: team channel\nWarning: quiet channel\nCheck job silent ${SERVICE.jobSilentMinutes} min: team channel` },
                limit: { signal: "item.mark.group.width - 24" },
              },
            },
          },
        ],
      },
      {
        type: "group",
        from: { data: "checks" },
        encode: {
          update: {
            x: { signal: `${PAD} + 314 + (datum.i % 5) * (${tw} + 10)` },
            y: { signal: `top + floor(datum.i / 5) * (${th} + 10)` },
            width: { signal: tw },
            height: { signal: th },
            cornerRadius: { value: 14 },
            fill: { value: C.paper },
            stroke: { value: C.rule },
            tooltip: { signal: "{'Check': datum.name, 'Now': datum.headline, 'Detail': datum.detail || '–', 'First step': datum.runbook}" },
          },
        },
        marks: [
          { type: "rect", encode: { update: { x: { value: 0 }, y: { value: 14 }, width: { value: 3 }, height: { signal: "item.mark.group.height - 28" }, cornerRadius: { value: 2 }, fill: { signal: stroke("parent.status") } } } },
          { type: "text", encode: { update: { x: { value: 16 }, y: { value: 16 }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 10 }, fontWeight: { value: 600 }, fill: { value: C.inkSoft }, text: { signal: "upper(parent.group)" }, limit: { signal: "item.mark.group.width - (item.mark.group.width < 220 ? 52 : 126)" } } } },
          // full pill on a wide tile, just the coloured dot on a narrow one
          { type: "rect", encode: { update: { x: { signal: "item.mark.group.width - (item.mark.group.width < 220 ? 34 : 108)" }, y: { value: 12 }, width: { signal: "item.mark.group.width < 220 ? 20 : 94" }, height: { value: 18 }, cornerRadius: { value: 9 }, fill: { signal: tint("parent.status") } } } },
          { type: "symbol", encode: { update: { x: { signal: "item.mark.group.width - (item.mark.group.width < 220 ? 24 : 98)" }, y: { value: 21 }, size: { value: 26 }, fill: { signal: stroke("parent.status") } } } },
          { type: "text", encode: { update: { x: { signal: "item.mark.group.width - 90" }, y: { value: 21 }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 9.5 }, fontWeight: { value: 600 }, fill: { signal: stroke("parent.status") }, text: { signal: label("parent.status") }, opacity: { signal: "item.mark.group.width < 220 ? 0 : 1" } } } },
          { type: "text", encode: { update: { x: { value: 16 }, y: { value: 41 }, baseline: { value: "top" }, font: { value: FONT.display }, fontSize: { signal: "item.mark.group.width < 220 ? 13 : 14.5" }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { field: { parent: "name" } }, limit: { signal: "item.mark.group.width - 28" } } } },
          { type: "text", encode: { update: { x: { value: 16 }, y: { value: 64 }, baseline: { value: "top" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.inkSoft }, text: { field: { parent: "headline" } }, limit: { signal: "item.mark.group.width - 28" } } } },
        ],
      },
    ],
  });
};

// ---------------------------------------------------------------------------
const actions = () =>
  merge(serviceBlock(), frame({ title: "What to do now", subtitle: "Checks that aren't OK, most urgent first, with the first step" }), {
    signals: [{ name: "rowH", value: 92 }],
    data: [
      {
        name: "todo",
        source: "checks",
        transform: [
          { type: "filter", expr: "datum.rank >= 2" },
          { type: "collect", sort: { field: ["rank", "i"], order: ["descending", "ascending"] } },
          { type: "window", ops: ["row_number"], as: ["k"] },
          { type: "filter", expr: "top + datum.k * rowH <= height - 8" },
        ],
      },
    ],
    marks: [
      emptyNote("length(data('todo')) === 0", "Nothing needs action. Kibana will alert the team if that changes.", { color: C.good }),
      {
        type: "group",
        from: { data: "todo" },
        encode: { update: { x: { value: PAD }, y: { signal: "top + (datum.k - 1) * rowH" }, width: { signal: "cw" }, height: { signal: "rowH - 8" } } },
        marks: [
          { type: "rule", encode: { update: { x: { value: 0 }, x2: { signal: "item.mark.group.width" }, y: { signal: "item.mark.group.height + 3" }, stroke: { value: C.rule } } } },
          ...pillMarks("parent.status", { x: 0, y: 10, w: 94 }),
          { type: "text", encode: { update: { x: { value: 106 }, y: { value: 10 }, baseline: { value: "middle" }, font: { value: FONT.display }, fontSize: { value: 15 }, fontWeight: { value: 600 }, fill: { value: C.ink }, text: { field: { parent: "name" } } } } },
          { type: "text", encode: { update: { x: { signal: "item.mark.group.width" }, y: { value: 10 }, align: { value: "right" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.inkSoft }, text: { field: { parent: "headline" } } } } },
          { type: "text", encode: { update: { x: { value: 0 }, y: { value: 34 }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.ink }, text: { signal: "parent.detail || parent.headline" }, limit: { signal: "item.mark.group.width" } } } },
          {
            type: "text",
            encode: {
              update: {
                x: { value: 0 },
                y: { value: 48 },
                baseline: { value: "top" },
                font: { value: FONT.body },
                fontSize: { value: 11.5 },
                fill: { value: C.inkSoft },
                lineBreak: { value: "\n" },
                lineHeight: { value: 15 },
                text: { signal: wrap("'First step: ' + parent.runbook", "floor(item.mark.group.width / 5.9)") },
              },
            },
          },
        ],
      },
    ],
  });

// ---------------------------------------------------------------------------
const history = () =>
  merge(serviceBlock(), frame({
      title: "Last 24 hours",
      subtitle: "Worst status each hour",
      legend: [
        { label: "OK", color: C.sage },
        { label: "Warning", color: C.warn },
        { label: "Action", color: C.bad },
        { label: "Out of hours", color: C.rule },
      ],
    }), {
    signals: [
      { name: "labW", value: 170 },
      { name: "cellW", update: "(cw - labW) / 24" },
      { name: "rowY", update: `(ch - 44) / ${CHECKS.length}` },
      { name: "jobLast", update: "length(data('sv_hist')) && data('sv_hist')[0].last.value ? data('sv_hist')[0].last.value : null" },
      { name: "jobAge", update: "isValid(jobLast) ? (svNow - jobLast) / 60000 : null" },
    ],
    data: [
      { name: "sv_hist", url: { index: HISTORY_QUERY.index, body: HISTORY_QUERY.body }, format: { property: "aggregations" } },
      {
        name: "hist_cells",
        source: "sv_hist",
        transform: [
          { type: "flatten", fields: ["c.buckets"], as: ["g"] },
          { type: "flatten", fields: ["g.h.buckets"], as: ["b"] },
          { type: "formula", as: "id", expr: "datum.g.key" },
          { type: "formula", as: "t", expr: "datum.b.key" },
          { type: "formula", as: "r", expr: "datum.b.doc_count ? datum.b.r.value : null" },
          { type: "lookup", from: "checks", key: "id", fields: ["id"], values: ["i"], as: ["i"] },
          { type: "filter", expr: "isValid(datum.i)" },
          { type: "formula", as: "j", expr: `round((datum.t - (floor(svNow / ${H}) * ${H} - ${23 * H})) / ${H})` },
          { type: "filter", expr: "datum.j >= 0 && datum.j < 24" },
          { type: "formula", as: "s", expr: "datum.r === 3 ? 'act' : datum.r === 2 ? 'warn' : datum.r === 1 ? 'ok' : datum.r === 0 ? 'quiet' : 'none'" },
          { type: "project", fields: ["i", "j", "t", "s"] },
        ],
      },
      { name: "hist_ticks", values: [0, 6, 12, 18, 23].map((j) => ({ j })) },
    ],
    marks: [
      {
        type: "text",
        from: { data: "checks" },
        encode: { update: { x: { value: PAD }, y: { signal: "top + datum.i * rowY + rowY / 2" }, baseline: { value: "middle" }, font: { value: FONT.body }, fontSize: { value: 12 }, fill: { value: C.ink }, text: { field: "name" }, limit: { signal: "labW - 12" } } },
      },
      {
        type: "rect",
        from: { data: "checks" },
        encode: { update: { x: { signal: `${PAD} + labW` }, width: { signal: "cellW * 24 - 2" }, y: { signal: "top + datum.i * rowY + 3" }, height: { signal: "rowY - 6" }, cornerRadius: { value: 3 }, fill: { value: C.paperDeep } } },
      },
      {
        type: "rect",
        from: { data: "hist_cells" },
        encode: {
          update: {
            x: { signal: `${PAD} + labW + datum.j * cellW` },
            width: { signal: "cellW - 2" },
            y: { signal: "top + datum.i * rowY + 3" },
            height: { signal: "rowY - 6" },
            cornerRadius: { value: 3 },
            fill: { signal: `datum.s === 'act' ? '${C.bad}' : datum.s === 'warn' ? '${C.warn}' : datum.s === 'ok' ? '${C.sage}' : datum.s === 'quiet' ? '${C.rule}' : '${C.paperDeep}'` },
            tooltip: { signal: `{'Hour': utcFormat(datum.t, '%H:00 UTC %d %b'), 'Status': ${label("datum.s")}}` },
          },
        },
      },
      {
        type: "text",
        from: { data: "hist_ticks" },
        encode: { update: { x: { signal: `${PAD} + labW + datum.j * cellW` }, y: { signal: `top + ${CHECKS.length} * rowY + 6` }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 9.5 }, fill: { value: C.inkSoft }, text: { signal: `utcFormat(floor(svNow / ${H}) * ${H} - ${23 * H} + datum.j * ${H}, '%H:%M')` } } },
      },
      {
        type: "text",
        encode: {
          update: {
            x: { value: PAD },
            y: { signal: "height - 16" },
            baseline: { value: "bottom" },
            font: { value: FONT.body },
            fontSize: { value: 12 },
            fontWeight: { value: 600 },
            fill: { signal: `!isValid(jobAge) || jobAge > ${SERVICE.jobSilentMinutes} ? '${C.bad}' : '${C.good}'` },
            text: {
              signal: `!isValid(jobAge) ? 'No check job runs in the last 24 hours: alerts are not being raised (etl/service-job)' : jobAge > ${SERVICE.jobSilentMinutes} ? 'Check job last ran ' + ${fmtAge("jobAge")} + ' ago: alerts are not being raised' : 'Check job last ran ' + ${fmtAge("jobAge")} + ' ago'`,
            },
          },
        },
      },
    ],
  });

// ---------------------------------------------------------------------------
const activity = () =>
  merge(
    serviceBlock(),
    frame({
      title: "Activity, last 48 hours",
      subtitle: "Items worked each hour against the same hour 1 to 4 weeks back",
      legend: [
        { label: "Items worked", color: C.ink },
        { label: "Usual", color: C.inkMuted, dashed: true },
        { label: "Usual range", color: C.sage },
        { label: "System exceptions", color: C.system },
      ],
    }),
    {
      data: [
        { name: "gl4", values: [0.25, 0.5, 0.75, 1].map((f) => ({ f })) },
        { name: "gl2", values: [0.5, 1].map((f) => ({ f })) },
        {
          name: "hr_all",
          source: "sv_flow",
          transform: [
            { type: "flatten", fields: ["hr.buckets"], as: ["b"] },
            { type: "formula", as: "t", expr: "datum.b.key" },
            { type: "formula", as: "a", expr: "datum.b.a.value" },
            { type: "formula", as: "s", expr: "datum.b.s.value" },
            { type: "project", fields: ["t", "a", "s"] },
          ],
        },
        {
          name: "hr48",
          source: "hr_all",
          transform: [
            { type: "filter", expr: `datum.t >= svNow - ${48 * H} && datum.t + ${H} <= svNow` },
            ...[1, 2, 3, 4].flatMap((k) => [
              { type: "formula", as: `k${k}`, expr: `datum.t - ${k * 7 * D}` },
              { type: "lookup", from: "hr_all", key: "t", fields: [`k${k}`], values: ["a"], as: [`u${k}`], default: 0 },
            ]),
            { type: "formula", as: "usual", expr: "(datum.u1 + datum.u2 + datum.u3 + datum.u4) / 4" },
            { type: "formula", as: "lo", expr: "min(datum.u1, datum.u2, datum.u3, datum.u4)" },
            { type: "formula", as: "hi", expr: "max(datum.u1, datum.u2, datum.u3, datum.u4)" },
            { type: "formula", as: "night", expr: `utchours(datum.t) < ${SERVICE.serviceHoursUtc[0]} || utchours(datum.t) >= ${SERVICE.serviceHoursUtc[1]}` },
          ],
        },
      ],
      scales: [
        { name: "x", type: "time", domain: { signal: `[svNow - ${48 * H}, svNow - ${H}]` }, range: [0, { signal: "cw" }] },
        { name: "y", type: "linear", domain: { data: "hr48", fields: ["a", "hi"] }, range: [{ signal: "ch - 18" }, 0], nice: true, zero: true },
      ],
      marks: [
        {
          type: "group",
          encode: { update: { x: { value: PAD }, y: { signal: "top" }, width: { signal: "cw" }, height: { signal: "ch" } } },
          marks: [
            { type: "rect", from: { data: "hr48" }, encode: { update: { x: { scale: "x", field: "t" }, x2: { scale: "x", signal: `datum.t + ${H}` }, y: { value: 0 }, y2: { signal: "ch - 18" }, fill: { value: C.paperDeep }, opacity: { signal: "datum.night ? 1 : 0" } } } },
            { type: "rule", from: { data: "gl4" }, encode: { update: { x: { value: 0 }, x2: { signal: "cw" }, y: { signal: "(ch - 18) * (1 - datum.f)" }, stroke: { value: C.track } } } },
            { type: "text", from: { data: "gl2" }, encode: { update: { x: { value: 0 }, y: { signal: "(ch - 18) * (1 - datum.f) + 3" }, baseline: { value: "top" }, font: { value: FONT.mono }, fontSize: { value: 9.5 }, fill: { value: C.inkMuted }, text: { signal: "format(invert('y', (ch - 18) * (1 - datum.f)), ',.0f')" } } } },
            { type: "area", from: { data: "hr48" }, encode: { update: { x: { scale: "x", field: "t" }, y: { scale: "y", field: "hi" }, y2: { scale: "y", field: "lo" }, fill: { value: C.sage }, fillOpacity: { value: 0.8 }, interpolate: { value: "monotone" } } } },
            { type: "line", from: { data: "hr48" }, encode: { update: { x: { scale: "x", field: "t" }, y: { scale: "y", field: "usual" }, stroke: { value: C.inkMuted }, strokeWidth: { value: 1.4 }, strokeDash: { value: [4, 3] }, interpolate: { value: "monotone" } } } },
            { type: "line", from: { data: "hr48" }, encode: { update: { x: { scale: "x", field: "t" }, y: { scale: "y", field: "a" }, stroke: { value: C.ink }, strokeWidth: { value: 2 }, interpolate: { value: "monotone" } } } },
            { type: "line", from: { data: "hr48" }, encode: { update: { x: { scale: "x", field: "t" }, y: { scale: "y", field: "s" }, stroke: { value: C.system }, strokeWidth: { value: 1.6 }, interpolate: { value: "monotone" } } } },
            {
              type: "rect",
              from: { data: "hr48" },
              encode: {
                update: { x: { scale: "x", field: "t" }, x2: { scale: "x", signal: `datum.t + ${H}` }, y: { value: 0 }, y2: { signal: "ch - 18" }, fill: { value: "transparent" }, tooltip: { signal: "{'Hour': utcFormat(datum.t, '%a %H:00 UTC'), 'Items worked': datum.a, 'Usual': format(datum.usual, '.0f'), 'Range': datum.lo + ' to ' + datum.hi, 'System exceptions': datum.s}" } },
                hover: { fill: { value: C.ink }, fillOpacity: { value: 0.04 } },
              },
            },
            { type: "text", from: { data: "hr48" }, encode: { update: { x: { scale: "x", field: "t" }, y: { signal: "ch - 4" }, align: { value: "center" }, font: { value: FONT.mono }, fontSize: { value: 9.5 }, fill: { value: C.inkSoft }, text: { signal: "utchours(datum.t) % 6 === 0 ? utcFormat(datum.t, utchours(datum.t) === 0 ? '%a %d' : '%H:00') : ''" } } } },
          ],
        },
      ],
    },
  );

// ---------------------------------------------------------------------------
const workers = () =>
  merge(
    serviceBlock(),
    frame({ title: "Digital workers", subtitle: "Items each hour, last 24 hours · quiet workers first · hover a name for its owner" }),
    {
      data: [
        { name: "wk", source: "sv_rs", transform: [{ type: "formula", as: "rank", expr: rankOf("datum.state") }, { type: "collect", sort: { field: ["rank", "name"], order: ["descending", "ascending"] } }] },
      ],
    },
    table({
      data: "wk",
      name: "wkt",
      rowH: 28,
      columns: [
        { label: "Worker", w: 132, text: "datum.name", font: "mono", size: 11, tip: "datum.name + ' · ' + datum.spoke" },
        { label: "Last 24 hours" },
        { label: "Last item", w: 74, align: "right", text: fmtAge("datum.ageMin"), font: "mono", color: `datum.state === 'ok' ? '${C.ink}' : ${stroke("datum.state")}` },
        { label: "24h", w: 48, align: "right", text: "format(datum.w0, ',')", font: "mono" },
        { label: "Usual", w: 56, align: "right", text: "format(datum.usual, ',.0f')", font: "mono", color: `'${C.inkSoft}'` },
        pillCell("state"),
      ],
    }),
    {
      data: [
        {
          name: "wk_hb",
          source: "sv_rs",
          transform: [
            { type: "flatten", fields: ["hours"], as: ["b"] },
            { type: "formula", as: "j", expr: `round((datum.b.key - (floor(svNow / ${H}) * ${H} - ${23 * H})) / ${H})` },
            { type: "formula", as: "v", expr: "datum.b.doc_count" },
            { type: "lookup", from: "wkt_rows", key: "name", fields: ["name"], values: ["rank"], as: ["row"] },
            { type: "filter", expr: "isValid(datum.row) && datum.j >= 0 && datum.j < 24" },
            { type: "project", fields: ["name", "row", "j", "v"] },
          ],
        },
      ],
      signals: [{ name: "hbStep", update: "(cw - 132 - 74 - 48 - 56 - 112 - 20) / 24" }],
      scales: [{ name: "hb", type: "sqrt", domain: { data: "wk_hb", field: "v" }, range: [0.15, 1], zero: false }],
      marks: [
        {
          type: "rect",
          from: { data: "wk_hb" },
          encode: {
            update: {
              // the heartbeat is the table's flexible column: 24 cells across whatever width is left
              x: { signal: `${PAD} + 132 + 10 + datum.j * hbStep` },
              width: { signal: "max(2, min(12, hbStep - 2))" },
              y: { signal: "top + 26 + (datum.row - 1) * wkt_rh + wkt_rh / 2 - 7" },
              height: { value: 14 },
              cornerRadius: { value: 2 },
              fill: { signal: `datum.v ? '${C.ink}' : '${C.track}'` },
              fillOpacity: { signal: "datum.v ? scale('hb', datum.v) : 1" },
              tooltip: { signal: `{'Worker': datum.name, 'Hour': utcFormat(floor(svNow / ${H}) * ${H} - ${23 * H} + datum.j * ${H}, '%H:00 UTC'), 'Items': datum.v}` },
            },
          },
        },
      ],
    },
  );

// ---------------------------------------------------------------------------
const queues = () =>
  merge(
    serviceBlock(),
    frame({ title: "Queues", subtitle: `Items still waiting against their SLA · locked means held for over ${SERVICE.lockMinutes} minutes · click a row to filter` }),
    {
      signals: [{ name: "qpick", on: [{ events: "@qt_row:click", update: addFilter("queue.name", "datum.name") }] }],
      data: [
        {
          name: "qs",
          source: "sv_q",
          transform: [
            { type: "formula", as: "worst", expr: "datum.lockState === 'act' ? 'act' : datum.state" },
            { type: "formula", as: "rank", expr: rankOf("datum.worst") },
            { type: "collect", sort: { field: ["rank", "past", "soon", "ageMin"], order: ["descending", "descending", "descending", "descending"] } },
          ],
        },
      ],
      marks: [emptyNote("length(data('qs')) === 0", "Every queue is clear.", { color: C.good })],
    },
    table({
      data: "qs",
      name: "qt",
      rowH: 28,
      rowClick: true,
      columns: [
        { label: "Queue", text: "datum.name", font: "mono", size: 11, tip: "datum.process + ' · ' + datum.spoke" },
        { label: "Waiting", w: 64, align: "right", text: "format(datum.waiting, ',')", font: "mono" },
        { label: "Past SLA", w: 68, align: "right", text: "datum.past ? '' + datum.past : '–'", font: "mono", color: `datum.past ? '${C.bad}' : '${C.inkSoft}'` },
        { label: `Due ${SERVICE.slaSoonHours} h`, w: 56, align: "right", text: "datum.soon ? '' + datum.soon : '–'", font: "mono", color: `datum.soon ? '${C.warn}' : '${C.inkSoft}'` },
        { label: "Oldest", w: 62, align: "right", text: `datum.waiting ? ${fmtAge("datum.ageMin")} : '–'`, font: "mono" },
        { label: "Locked", w: 58, align: "right", text: "datum.stuck ? '' + datum.stuck : '–'", font: "mono", color: `datum.stuck ? '${C.bad}' : '${C.inkSoft}'` },
        pillCell("worst", 104),
      ],
    }),
  );

// ---------------------------------------------------------------------------
const exceptions = () =>
  merge(
    serviceBlock(),
    frame({ title: "System exceptions by process", subtitle: "Last 24 hours against each process's own rate over the previous 28 days" }),
    {
      signals: [{ name: "xpick", on: [{ events: "@xt_row:click", update: addFilter("process.name", "datum.name") }] }],
      data: [
        {
          name: "xs",
          source: "sv_pr",
          transform: [
            { type: "filter", expr: "datum.s0 > 0" },
            { type: "formula", as: "rank", expr: rankOf("datum.spike") },
            { type: "formula", as: "x", expr: "datum.rate0 / datum.baseRate" },
            { type: "collect", sort: { field: ["rank", "s0", "name"], order: ["descending", "descending", "ascending"] } },
          ],
        },
      ],
      marks: [emptyNote("length(data('xs')) === 0", "No system exceptions in the last 24 hours.", { color: C.good })],
    },
    table({
      data: "xs",
      name: "xt",
      rowH: 28,
      rowClick: true,
      columns: [
        { label: "Process", text: "datum.name" },
        { label: "24h", w: 52, align: "right", text: "'' + datum.s0", font: "mono" },
        { label: "Rate", w: 64, align: "right", text: "format(datum.rate0 * 100, '.1f') + '%'", font: "mono" },
        { label: "Usual", w: 64, align: "right", text: "format(datum.baseRate * 100, '.1f') + '%'", font: "mono", color: `'${C.inkSoft}'` },
        { label: "× usual", w: 70, align: "right", text: "format(datum.x, '.1f') + '×'", font: "mono", color: `datum.spike === 'ok' ? '${C.ink}' : ${stroke("datum.spike")}` },
        pillCell("spike"),
      ],
    }),
  );

// ---------------------------------------------------------------------------
const reasons = () =>
  merge(
    serviceBlock(),
    frame({ title: "Exception reasons, last 24 hours", subtitle: `New means not seen in the previous 28 days (flagged from ${SERVICE.newReasonMin} occurrences)` }),
    {
      data: [
        {
          name: "rs24",
          source: "sv_codes",
          transform: [
            { type: "formula", as: "flag", expr: `datum.isNew && datum.n >= ${SERVICE.newReasonMin} ? 'warn' : datum.isNew ? 'new' : 'seen'` },
            { type: "formula", as: "o", expr: "datum.flag === 'warn' ? 2 : datum.flag === 'new' ? 1 : 0" },
            { type: "collect", sort: { field: ["o", "n", "reason"], order: ["descending", "descending", "ascending"] } },
          ],
        },
      ],
      marks: [emptyNote("length(data('rs24')) === 0", "No exceptions in the last 24 hours.", { color: C.good })],
    },
    table({
      data: "rs24",
      name: "rt",
      rowH: 28,
      columns: [
        { label: "Reason", text: "datum.reason", tip: "datum.code" },
        { label: "Type", w: 76, text: "datum.type", font: "mono", size: 10.5, color: `datum.type === 'System' ? '${C.system}' : '${C.business}'` },
        { label: "24h", w: 50, align: "right", text: "'' + datum.n", font: "mono" },
        { label: "Top process", w: 170, text: "datum.process", color: `'${C.inkSoft}'` },
        {
          label: "Seen before",
          w: 100,
          spark: (x, w, rowH) => [
            { type: "rect", encode: { update: { x: { signal: `${x} + 8` }, y: { signal: `${rowH} / 2 - 9` }, width: { value: 52 }, height: { value: 18 }, cornerRadius: { value: 9 }, fill: { signal: `parent.flag === 'warn' ? '${C.warnFill}' : '${C.band}'` }, opacity: { signal: "parent.flag === 'seen' ? 0 : 1" } } } },
            { type: "text", encode: { update: { x: { signal: `${x} + 34` }, y: { signal: `${rowH} / 2` }, align: { value: "center" }, baseline: { value: "middle" }, font: { value: FONT.mono }, fontSize: { value: 9.5 }, fontWeight: { value: 600 }, fill: { signal: `parent.flag === 'warn' ? '${C.warn}' : parent.flag === 'new' ? '${C.inkSoft}' : '${C.inkMuted}'` }, text: { signal: "parent.flag === 'seen' ? 'yes' : 'NEW'" } } } },
          ],
        },
      ],
    }),
  );

export const dashboard = {
  id: "service",
  title: "IA · Service",
  description: "Run-team checks: OK, Warning or Action, with the first step. Alerts come from the same checks.",
  time: { from: "now-24h", to: "now" },
  preview: { now: "2026-07-14T15:00:00.000Z", hours: 24, label: "Live view at 15:00 UTC, 14 Jul" },
  panels: [
    { id: "board", title: "Service status", grid: { x: 0, y: 0, w: 48, h: 10 }, build: board },
    { id: "actions", title: "What to do now", grid: { x: 0, y: 10, w: 28, h: 13 }, build: actions },
    { id: "history", title: "Last 24 hours", grid: { x: 28, y: 10, w: 20, h: 13 }, build: history },
    { id: "queues", title: "Queues", grid: { x: 0, y: 23, w: 24, h: 16 }, build: queues },
    { id: "workers", title: "Digital workers", grid: { x: 24, y: 23, w: 24, h: 16 }, build: workers },
    { id: "activity", title: "Activity, last 48 hours", grid: { x: 0, y: 39, w: 48, h: 11 }, build: activity },
    { id: "exceptions", title: "System exceptions by process", grid: { x: 0, y: 50, w: 24, h: 12 }, build: exceptions },
    { id: "reasons", title: "Exception reasons", grid: { x: 24, y: 50, w: 24, h: 12 }, build: reasons },
  ],
};

