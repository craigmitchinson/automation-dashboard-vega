// ---------------------------------------------------------------------------
// fmt.mjs — the React app's number formatters (src/components/viz.tsx) as
// Vega expression strings. Each takes an expression and returns an
// expression, e.g. F.gbpc("datum.net") -> "(...)". Non-finite values render
// as an em dash-free "–", matching the app's "no figure" convention.
// ---------------------------------------------------------------------------

const wrap = (x) => `(${x})`;
const fin = (x, body) => `(isValid(${x}) && isFinite(${x}) ? ${body} : '–')`;

const RAW = {
  // 37,374
  int: (x) => fin(x, `format(${x}, ',.0f')`),
  // 3.5k / 37k / 1.2M
  compact: (x) =>
    fin(x, `(abs(${x}) >= 1e6 ? format(${x} / 1e6, abs(${x}) >= 1e7 ? '.0f' : '.1f') + 'M' : abs(${x}) >= 1e3 ? format(${x} / 1e3, abs(${x}) >= 1e4 ? '.0f' : '.1f') + 'k' : format(${x}, '.0f'))`),
  // 91.3%  (x is a fraction)
  pct: (x, dp = 1) => fin(x, `format(${x} * 100, '.${dp}f') + '%'`),
  // £382,687 / -£53,320
  gbp: (x) => fin(x, `(${x} < 0 ? '-' : '') + '£' + format(round(abs(${x})), ',')`),
  // £160.9k / £1.20M / £236.18
  gbpc: (x) =>
    fin(x, `(${x} < 0 ? '-' : '') + '£' + (abs(${x}) >= 1e6 ? format(abs(${x}) / 1e6, '.2f') + 'M' : abs(${x}) >= 1e3 ? format(abs(${x}) / 1e3, '.1f') + 'k' : format(abs(${x}), '.2f'))`),
  // £10.24 / £1,024.50
  money2: (x) => fin(x, `(${x} < 0 ? '-' : '') + '£' + format(abs(${x}), ',.2f')`),
  // £4.3k (compact, one decimal at k/M, whole pounds below 1k)
  moneyCompact: (x) =>
    fin(x, `(${x} < 0 ? '-' : '') + '£' + (abs(${x}) >= 1e6 ? format(abs(${x}) / 1e6, '.1f') + 'M' : abs(${x}) >= 1e3 ? format(abs(${x}) / 1e3, '.1f') + 'k' : format(round(abs(${x})), ','))`),
  // £53,320 above £100, £10.24 below
  money: (x) => fin(x, `(${x} < 0 ? '-' : '') + '£' + (abs(${x}) < 100 ? format(abs(${x}), '.2f') : format(round(abs(${x})), ','))`),
  // 45s / 10m 21s / 1h 04m
  duration: (x) =>
    fin(
      x,
      `(round(${x}) < 60 ? round(max(0, ${x})) + 's' : round(${x}) < 3600 ? floor(round(${x}) / 60) + 'm ' + pad('' + (round(${x}) % 60), 2, '0', 'left') + 's' : floor(round(${x}) / 3600) + 'h ' + pad('' + floor((round(${x}) % 3600) / 60), 2, '0', 'left') + 'm')`,
    ),
  // ▲ 1.3%  (signed fractional change)
  delta: (x) => fin(x, `(${x} >= 0 ? '▲ ' : '▼ ') + format(abs(${x}) * 100, '.1f') + '%'`),
  // 16 Apr
  day: (x) => `utcFormat(${x}, '%d %b')`,
  // 14 Jul 2026
  dayLong: (x) => `utcFormat(${x}, '%-d %b %Y')`,
  // Apr 26
  month: (x) => `utcFormat(${x}, '%b %y')`,
};

// Every formatter parenthesises its argument so callers can pass any expression.
export const F = Object.fromEntries(Object.entries(RAW).map(([k, f]) => [k, (x, ...rest) => f(`(${x})`, ...rest)]));

export const expr = { wrap };
