// Dashboard order here is the navigation order, grouped by who uses them.
//   Run:    the run team, day to day
//   Manage: squad and process owners, week to week
//   Money:  finance, the CoE lead and ExCo
// Retired: Commercial (its charts are on Value & Finance). Input & Outcome
// returned as Work in & out.
import { masthead } from "../lib/masthead.mjs";
import { merge } from "../lib/kit.mjs";
import { dashboard as service } from "./service.mjs";
import { dashboard as processDetail } from "./process-detail.mjs";
import { dashboard as overview } from "./overview.mjs";
import { dashboard as workFlow } from "./work-flow.mjs";
import { dashboard as processAnalysis } from "./process-analysis.mjs";
import { dashboard as exceptions } from "./exceptions.mjs";
import { dashboard as capacity } from "./capacity.mjs";
import { dashboard as alerts } from "./alerts.mjs";
import { dashboard as exec } from "./exec.mjs";
import { dashboard as valueFinance } from "./value-finance.mjs";

export const GROUPS = [
  { name: "Run", dashboards: [service, processDetail] },
  { name: "Manage", dashboards: [overview, workFlow, processAnalysis, exceptions, capacity, alerts] },
  { name: "Money", dashboards: [exec, valueFinance] },
];
export const DASHBOARDS = GROUPS.flatMap((g) => g.dashboards);

// Every dashboard opens with a masthead: group, page, what it answers, and
// the period, scope and freshness of what is on screen.
const PURPOSE = {
  service: ["Is anything wrong right now, and what do we do first", "now"],
  "process-detail": ["One process in depth: volume, outcomes, exceptions, workers and value"],
  overview: ["How the estate performed this period, hub by hub, and what changed"],
  "work-flow": ["What came in, what we worked, what is still waiting and what it cost"],
  "process-analysis": ["Which processes are slow, failing or costly, and where bot time is lost"],
  exceptions: ["What fails, why and when, and how much colleague time it hands back"],
  capacity: ["How hard the digital workers are working, and how many we need"],
  alerts: ["Where we are off target, ranked by the money at stake"],
  exec: ["Value delivered this financial year, hub by hub", "fy"],
  "value-finance": ["What the automation is worth, what it costs and where the value comes from"],
};
const MAST_H = 4;
DASHBOARDS.forEach((d, i) => {
  const group = GROUPS.find((g) => g.dashboards.includes(d)).name;
  const [purpose, mode] = PURPOSE[d.id];
  d.purpose = purpose;
  for (const p of d.panels) p.grid = { ...p.grid, y: p.grid.y + MAST_H };
  d.panels.unshift({
    id: "masthead",
    title: "Masthead",
    grid: { x: 0, y: 0, w: 48, h: MAST_H },
    states: null,
    build: () => merge(masthead({ group, index: i + 1, total: DASHBOARDS.length, title: d.title.replace(/^IA · /, ""), purpose, mode })),
  });
});
