// ---------------------------------------------------------------------------
// kibana-context.mjs: emulates what Kibana's Vega plugin does to an
// Elasticsearch data url before it runs the query:
//   %context% / %timefield%            dashboard query, filters and time range
//   "%dashboard_context-*_clause%"     the same clauses, spliced into a custom bool
//   {"%timefilter%": true|"min"|"max", shift, unit}
// Mirrors Kibana's es_query_parser closely enough to prove each spec's query
// shape; it is not a replacement for testing in Kibana itself.
// ---------------------------------------------------------------------------

const UNIT_MS = { ms: 1, s: 1e3, second: 1e3, m: 6e4, minute: 6e4, h: 36e5, hour: 36e5, d: 864e5, day: 864e5, w: 6048e5, week: 6048e5 };

function timeBound(state, opts, which) {
  let t = which === "min" ? state.time.min : state.time.max;
  if (opts.shift) {
    const unit = UNIT_MS[opts.unit ?? "d"];
    if (unit == null) throw new Error(`unknown %timefilter% unit "${opts.unit}"`);
    t += opts.shift * unit;
  }
  return t;
}

function substitute(node, state) {
  if (Array.isArray(node)) {
    const out = [];
    for (const el of node) {
      if (el === "%dashboard_context-must_clause%") out.push(...state.must);
      else if (el === "%dashboard_context-must_not_clause%") out.push(...state.mustNot);
      else if (el === "%dashboard_context-filter_clause%") out.push(...state.filter);
      else out.push(substitute(el, state));
    }
    return out;
  }
  if (node && typeof node === "object") {
    if ("%timefilter%" in node) {
      const v = node["%timefilter%"];
      if (v === true) {
        const lo = timeBound(state, node, "min"), hi = timeBound(state, node, "max");
        return { gte: new Date(lo).toISOString(), lte: new Date(hi).toISOString(), format: "strict_date_optional_time" };
      }
      if (v === "min" || v === "max") return timeBound(state, node, v);
      throw new Error(`bad %timefilter% value ${v}`);
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = substitute(v, state);
    return out;
  }
  return node;
}

/** url: the Vega data.url object. state: { time: {min,max}, must: [], mustNot: [], filter: [] } */
export function toSearch(url, state) {
  const { index, body = {} } = url;
  if (!index) throw new Error("Kibana ES url needs an index");
  const ctx = url["%context%"] === true;
  if (ctx && body.query) throw new Error("%context% and body.query cannot both be set (Kibana rejects this)");
  const out = substitute(structuredClone(body), state);
  if (ctx) {
    const must = [...state.must];
    if (url["%timefield%"]) {
      must.push({ range: { [url["%timefield%"]]: { gte: new Date(state.time.min).toISOString(), lte: new Date(state.time.max).toISOString(), format: "strict_date_optional_time" } } });
    }
    out.query = { bool: { must, filter: [...state.filter], must_not: [...state.mustNot] } };
  }
  return { index, body: out };
}
