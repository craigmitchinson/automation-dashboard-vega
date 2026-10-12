// Dashboard order here is the navigation order, grouped by who uses them.
//   Run:    the run team, day to day
//   Manage: squad and process owners, week to week
//   Money:  finance, the CoE lead and ExCo
// Retired: Input & Outcome (now Overview's item flow) and Commercial (its
// charts are on Value & Finance).
import { dashboard as service } from "./service.mjs";
import { dashboard as processDetail } from "./process-detail.mjs";
import { dashboard as overview } from "./overview.mjs";
import { dashboard as processAnalysis } from "./process-analysis.mjs";
import { dashboard as exceptions } from "./exceptions.mjs";
import { dashboard as capacity } from "./capacity.mjs";
import { dashboard as alerts } from "./alerts.mjs";
import { dashboard as exec } from "./exec.mjs";
import { dashboard as valueFinance } from "./value-finance.mjs";

export const GROUPS = [
  { name: "Run", dashboards: [service, processDetail] },
  { name: "Manage", dashboards: [overview, processAnalysis, exceptions, capacity, alerts] },
  { name: "Money", dashboards: [exec, valueFinance] },
];
export const DASHBOARDS = GROUPS.flatMap((g) => g.dashboards);
