// ---------------------------------------------------------------------------
// mini-es.mjs — a deliberately small Elasticsearch query + aggregation engine
// for previewing the Vega specs without a cluster. It implements exactly the
// subset of the DSL the specs use; anything else throws, so a spec can't
// quietly rely on something the preview didn't really run.
//
// Query:  bool (must/filter/should/must_not, minimum_should_match), term,
//         terms, range, exists, match_phrase, match_all
// Aggs:   filter, filters, terms, date_histogram, sum, avg, min, max,
//         value_count, cardinality, top_hits
// ---------------------------------------------------------------------------
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const DAY = 86400000;

export async function loadNdjson(path) {
  const docs = [];
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let isAction = true;
  for await (const line of rl) {
    if (!line) continue;
    if (isAction) { isAction = false; continue; }
    isAction = true;
    docs.push(JSON.parse(line));
  }
  return docs;
}

// Values of a dotted path; arrays are flattened. Missing => [].
const pathCache = new Map();
export function values(doc, field) {
  let parts = pathCache.get(field);
  if (!parts) pathCache.set(field, (parts = field.split(".")));
  let cur = [doc];
  for (const p of parts) {
    const next = [];
    for (const c of cur) {
      if (c == null) continue;
      const v = c[p];
      if (v == null) continue;
      if (Array.isArray(v)) next.push(...v);
      else next.push(v);
    }
    cur = next;
  }
  return cur;
}

const DATE_FIELDS = /(^|\.)(@timestamp|date|outcome_date|.*_at)$/;
function asComparable(field, v) {
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (DATE_FIELDS.test(field)) {
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s + "T00:00:00Z") : Date.parse(s);
  }
  return v;
}
function bound(field, v) {
  if (v == null) return v;
  if (typeof v === "number") return v;
  return asComparable(field, v);
}

export function matches(doc, q) {
  if (q == null) return true;
  if (Array.isArray(q)) return q.every((c) => matches(doc, c));
  const [kind] = Object.keys(q);
  const body = q[kind];
  switch (kind) {
    case "match_all":
      return true;
    case "bool": {
      const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
      for (const c of arr(body.must)) if (!matches(doc, c)) return false;
      for (const c of arr(body.filter)) if (!matches(doc, c)) return false;
      for (const c of arr(body.must_not)) if (matches(doc, c)) return false;
      const should = arr(body.should);
      if (should.length) {
        const need = body.minimum_should_match ?? (arr(body.must).length || arr(body.filter).length ? 0 : 1);
        const hit = should.filter((c) => matches(doc, c)).length;
        if (hit < need) return false;
      }
      return true;
    }
    case "term": {
      const [field] = Object.keys(body);
      const want = typeof body[field] === "object" && body[field] !== null ? body[field].value : body[field];
      return values(doc, field).some((v) => v === want);
    }
    case "terms": {
      const [field] = Object.keys(body);
      const set = new Set(body[field]);
      return values(doc, field).some((v) => set.has(v));
    }
    case "match_phrase": {
      const [field] = Object.keys(body);
      const want = typeof body[field] === "object" && body[field] !== null ? body[field].query : body[field];
      return values(doc, field).some((v) => String(v) === String(want));
    }
    case "exists":
      return values(doc, body.field).length > 0;
    case "range": {
      const [field] = Object.keys(body);
      const r = body[field];
      return values(doc, field).some((raw) => {
        const v = asComparable(field, raw);
        if (r.gte != null && !(v >= bound(field, r.gte))) return false;
        if (r.gt != null && !(v > bound(field, r.gt))) return false;
        if (r.lte != null && !(v <= bound(field, r.lte))) return false;
        if (r.lt != null && !(v < bound(field, r.lt))) return false;
        return true;
      });
    }
    default:
      throw new Error(`mini-es: unsupported query "${kind}"`);
  }
}

function utcMonthStart(ts) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
function nextMonth(ts) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

function histogramKeyFn(spec) {
  const iv = spec.calendar_interval ?? spec.fixed_interval ?? spec.interval;
  if (iv === "1d" || iv === "day") return { key: (t) => Math.floor(t / DAY) * DAY, next: (k) => k + DAY };
  if (iv === "7d" || iv === "week" || iv === "1w") {
    // ES calendar weeks start Monday; fixed 7d intervals are epoch-aligned
    if (spec.calendar_interval) return { key: (t) => { const d = Math.floor(t / DAY); const dow = (d + 3) % 7; return (d - dow) * DAY; }, next: (k) => k + 7 * DAY };
    return { key: (t) => Math.floor(t / (7 * DAY)) * 7 * DAY, next: (k) => k + 7 * DAY };
  }
  if (iv === "1M" || iv === "month") return { key: utcMonthStart, next: nextMonth };
  throw new Error(`mini-es: unsupported histogram interval "${iv}"`);
}

function metric(kind, spec, docs) {
  const field = spec.field;
  switch (kind) {
    case "sum": {
      let s = 0;
      for (const d of docs) for (const v of values(d, field)) s += Number(v) || 0;
      return { value: s };
    }
    case "avg": {
      let s = 0, n = 0;
      for (const d of docs) for (const v of values(d, field)) { s += Number(v) || 0; n++; }
      return { value: n ? s / n : null };
    }
    case "min":
    case "max": {
      let best = null;
      for (const d of docs) for (const raw of values(d, field)) {
        const v = asComparable(field, raw);
        if (best == null || (kind === "min" ? v < best : v > best)) best = v;
      }
      const out = { value: best };
      if (best != null && DATE_FIELDS.test(field)) out.value_as_string = new Date(best).toISOString();
      return out;
    }
    case "value_count": {
      let n = 0;
      for (const d of docs) n += values(d, field).length;
      return { value: n };
    }
    case "cardinality": {
      const set = new Set();
      for (const d of docs) for (const v of values(d, field)) set.add(v);
      return { value: set.size };
    }
    case "top_hits": {
      let arr = [...docs];
      for (const s of [...(spec.sort ?? [])].reverse()) {
        const [f] = Object.keys(s);
        const dir = (typeof s[f] === "string" ? s[f] : s[f].order) === "desc" ? -1 : 1;
        arr.sort((a, b) => {
          const va = asComparable(f, values(a, f)[0]);
          const vb = asComparable(f, values(b, f)[0]);
          return va < vb ? -dir : va > vb ? dir : 0;
        });
      }
      return { hits: { total: { value: docs.length }, hits: arr.slice(0, spec.size ?? 3).map((d) => ({ _source: d })) } };
    }
    default:
      return undefined;
  }
}

export function runAggs(aggs, docs) {
  const out = {};
  for (const [name, spec] of Object.entries(aggs ?? {})) out[name] = runAgg(spec, docs);
  return out;
}

function runAgg(spec, docs) {
  const sub = spec.aggs ?? spec.aggregations;
  const kinds = Object.keys(spec).filter((k) => k !== "aggs" && k !== "aggregations");
  if (kinds.length !== 1) throw new Error(`mini-es: agg must have exactly one type, got ${kinds}`);
  const kind = kinds[0];
  const s = spec[kind];

  const m = metric(kind, s, docs);
  if (m !== undefined) return m;

  if (kind === "filter") {
    const inside = docs.filter((d) => matches(d, s));
    return { doc_count: inside.length, ...runAggs(sub, inside) };
  }
  if (kind === "filters") {
    const buckets = {};
    for (const [k, q] of Object.entries(s.filters)) {
      const inside = docs.filter((d) => matches(d, q));
      buckets[k] = { doc_count: inside.length, ...runAggs(sub, inside) };
    }
    return { buckets };
  }
  if (kind === "terms") {
    const groups = new Map();
    for (const d of docs) {
      const vs = values(d, s.field);
      const keys = vs.length ? vs : s.missing !== undefined ? [s.missing] : [];
      for (const k of new Set(keys)) {
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(d);
      }
    }
    let buckets = [...groups.entries()]
      .filter(([, g]) => g.length >= (s.min_doc_count ?? 1))
      .map(([key, g]) => ({ key, doc_count: g.length, ...runAggs(sub, g) }));
    const orders = s.order ? (Array.isArray(s.order) ? s.order : [s.order]) : [{ _count: "desc" }, { _key: "asc" }];
    const val = (b, k) => (k === "_count" ? b.doc_count : k === "_key" ? b.key : (() => { const [a, p] = k.split("."); const o = b[a]; return p ? o?.[p] : o?.value ?? o?.doc_count; })());
    buckets.sort((a, b) => {
      for (const o of orders) {
        const [k] = Object.keys(o);
        const dir = o[k] === "desc" ? -1 : 1;
        const va = val(a, k), vb = val(b, k);
        if (va < vb) return -dir;
        if (va > vb) return dir;
      }
      return 0;
    });
    const size = s.size ?? 10;
    const other = buckets.slice(size).reduce((n, b) => n + b.doc_count, 0);
    return { doc_count_error_upper_bound: 0, sum_other_doc_count: other, buckets: buckets.slice(0, size) };
  }
  if (kind === "date_histogram") {
    const { key: keyOf, next } = histogramKeyFn(s);
    const groups = new Map();
    for (const d of docs) {
      for (const raw of values(d, s.field)) {
        const k = keyOf(asComparable(s.field, raw));
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(d);
      }
    }
    const minDoc = s.min_doc_count ?? 0;
    let keys = [...groups.keys()].sort((a, b) => a - b);
    if (minDoc === 0 && (keys.length || s.extended_bounds)) {
      let lo = keys.length ? keys[0] : Infinity;
      let hi = keys.length ? keys.at(-1) : -Infinity;
      if (s.extended_bounds) {
        lo = Math.min(lo, keyOf(bound(s.field, s.extended_bounds.min)));
        hi = Math.max(hi, keyOf(bound(s.field, s.extended_bounds.max)));
      }
      keys = [];
      for (let k = lo; k <= hi; k = next(k)) keys.push(k);
    }
    if (s.hard_bounds) {
      const hlo = keyOf(bound(s.field, s.hard_bounds.min));
      const hhi = bound(s.field, s.hard_bounds.max);
      keys = keys.filter((k) => k >= hlo && k <= hhi);
    }
    const buckets = keys
      .map((k) => ({ key: k, key_as_string: new Date(k).toISOString(), doc_count: groups.get(k)?.length ?? 0, ...runAggs(sub, groups.get(k) ?? []) }))
      .filter((b) => b.doc_count >= minDoc);
    return { buckets };
  }
  throw new Error(`mini-es: unsupported aggregation "${kind}"`);
}

export function search(docs, body) {
  const hits = body.query ? docs.filter((d) => matches(d, body.query)) : docs;
  const size = body.size ?? 10;
  let sorted = hits;
  if (body.sort && size > 0) sorted = metric("top_hits", { sort: body.sort, size: hits.length }, hits).hits.hits.map((h) => h._source);
  return {
    took: 1,
    timed_out: false,
    hits: { total: { value: hits.length, relation: "eq" }, hits: sorted.slice(0, size).map((d) => ({ _source: body._source === false ? undefined : d })) },
    aggregations: body.aggs || body.aggregations ? runAggs(body.aggs ?? body.aggregations, hits) : undefined,
  };
}
