// ---------------------------------------------------------------------------
// tokens.mjs — the one place the look is defined. Values are lifted from the
// React app's src/theme.ts (light mode) so the Kibana build reads as the same
// product. Change a value here and rebuild; never hand-edit a colour inside a
// panel.
// ---------------------------------------------------------------------------

export const C = {
  paper: "#FAF7F2",
  paperDeep: "#F3EFE8", // paper with the React card's band tint baked in
  page: "#ECE8E1",
  ink: "#0B3239",
  inkSoft: "#5A7378", // rgba(11,50,57,0.68) flattened onto paper
  inkMuted: "#8FA0A3",
  rule: "#DCDCD7", // rgba(11,50,57,0.15) on paper
  ruleStrong: "#0B3239",
  band: "#F1EEE8", // themeBand on paper
  track: "#E4E3DE", // bar tracks / gauge background
  accent: "#FF222F",
  completed: "#0B3239",
  business: "#8A6FB0",
  system: "#FF222F",
  good: "#0B3239",
  bad: "#FF222F",
  positive: "#0F766E",
  warn: "#B45309",
  teams: "#5F6F72",
  machines: "#8A6FB0",
  unattributed: "#E87BA4",
  netLine: "#4A3AA7",
  hub: "#5A7378",
};

export const FONT = {
  display: "Georgia, Gelasio, 'Times New Roman', serif",
  body: "Calibri, Carlito, 'Segoe UI', Inter, Arial, sans-serif",
  mono: "'JetBrains Mono', 'Roboto Mono', Consolas, 'Courier New', monospace",
};

// Spoke accents, used only as a fallback: panels read the live colours from
// the ia-reference index (doc_type: spoke) so a new spoke needs no rebuild.
export const SPOKE_FALLBACK = {
  "Insurance, Pensions & Investments": "#2A78D6",
  Risk: "#D29200",
  Commercial: "#C2416B",
  "Consumer Lending": "#006B00",
  Hub: "#5A7378",
};

// Index and data view names. The Logstash and cost-job outputs must match.
export const IDX = {
  items: "ia-workqueue-items",
  costDaily: "ia-cost-daily",
  vdiDaily: "ia-vdi-daily",
  ref: "ia-reference",
  dataView: "ia-workqueue-items*", // used by kibanaAddFilter
};

// Vega config shared by every panel.
export const CONFIG = {
  background: C.paper,
  padding: 0,
  font: FONT.body,
  text: { font: FONT.body, fill: C.ink, fontSize: 12 },
  axis: {
    labelFont: FONT.mono,
    labelFontSize: 10,
    labelColor: C.inkSoft,
    titleFont: FONT.mono,
    titleColor: C.inkSoft,
    titleFontSize: 10,
    titleFontWeight: 400,
    domain: false,
    ticks: false,
    gridColor: C.rule,
    gridWidth: 1,
    labelPadding: 6,
  },
  style: { "guide-label": { font: FONT.mono } },
  view: { stroke: null },
  kibana: { renderer: "svg", hideWarnings: true },
};
