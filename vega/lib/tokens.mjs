// ---------------------------------------------------------------------------
// tokens.mjs: the one place the look is defined. Values are lifted from the
// React app's src/theme.ts (light mode) so the Kibana build reads as the same
// product. Change a value here and rebuild; never hand-edit a colour inside a
// panel.
// ---------------------------------------------------------------------------

// Platform Health palette (platform-health: src/styles.css light tokens and
// powerbi/theme/platform-health.theme.json), so the IA dashboards sit in the
// same family as the Platform Health report. Semantic roles from the React
// app are mapped onto it: completed = brand, business exception = amber,
// system exception = red.
export const C = {
  paper: "#FFFFFF", // --c-surface
  paperDeep: "#F7F6F2", // --c-cream
  page: "#F2F0EA", // --c-bg
  ink: "#0F4D43", // --c-ink / --c-brand
  inkSoft: "#5F6E69", // --c-muted
  inkMuted: "#8FA09A",
  rule: "#D6D9D2", // --c-line
  ruleStrong: "#0F4D43",
  band: "#F7F6F2", // --c-cream
  track: "#E6E8E2", // --c-gridline
  accent: "#2A6A5F", // --c-brand-mid
  completed: "#0F4D43", // --c-brand
  business: "#B9852C", // --c-amber
  system: "#B6462F", // --c-red
  good: "#0B8A6B", // --c-green
  bad: "#B6462F", // --c-red
  positive: "#0B8A6B",
  warn: "#B9852C",
  teams: "#5E8C82", // --c-brand-soft
  machines: "#44618A", // --c-lab-3
  unattributed: "#D9A08F", // --c-red, softened
  netLine: "#B9852C", // --c-amber
  hub: "#5F6E69",
  goodFill: "#DDF0E8",
  warnFill: "#F5EAD6",
  badFill: "#F3E0DA",
  sage: "#DCE8E0", // --c-panel
};

export const FONT = {
  display: "Fraunces, Cambria, Georgia, Gelasio, serif",
  body: "Inter, 'Segoe UI', Carlito, Calibri, Arial, sans-serif",
  mono: "'JetBrains Mono', Consolas, 'Roboto Mono', monospace",
};

// Spoke accents, used only as a fallback: panels read the live colours from
// the ia-reference index (doc_type: spoke) so a new spoke needs no rebuild.
export const SPOKE_FALLBACK = {
  "Insurance, Pensions & Investments": "#1E5B4F",
  Risk: "#8E5E48",
  Commercial: "#44618A",
  "Consumer Lending": "#1A6F7C",
  Hub: "#5F6E69",
};

// Index and data view names. The Logstash and cost-job outputs must match.
export const IDX = {
  items: "ia-workqueue-items",
  costDaily: "ia-cost-daily",
  vdiDaily: "ia-vdi-daily",
  ref: "ia-reference",
  serviceChecks: "ia-service-checks", // written by etl/service-job
  dataView: "ia-workqueue-items*", // used by kibanaAddFilter
};

// Vega config shared by every panel.
export const CONFIG = {
  background: C.paper,
  padding: 0,
  font: FONT.body,
  text: { font: FONT.body, fill: C.ink, fontSize: 12 },
  axis: {
    gridColor: C.track,
    labelFont: FONT.mono,
    labelFontSize: 10,
    labelColor: C.inkSoft,
    titleFont: FONT.mono,
    titleColor: C.inkSoft,
    titleFontSize: 10,
    titleFontWeight: 400,
    domain: false,
    ticks: false,
    gridWidth: 1,
    labelPadding: 6,
  },
  style: { "guide-label": { font: FONT.mono } },
  view: { stroke: null },
  kibana: { renderer: "svg", hideWarnings: true },
};
