// Dashboard order here is the navigation order.
import { dashboard as overview } from "./overview.mjs";
import { dashboard as alerts } from "./alerts.mjs";
import { dashboard as inputOutcome } from "./input-outcome.mjs";
import { dashboard as processAnalysis } from "./process-analysis.mjs";
import { dashboard as exceptions } from "./exceptions.mjs";
import { dashboard as capacity } from "./capacity.mjs";
import { dashboard as processDetail } from "./process-detail.mjs";
import { dashboard as exec } from "./exec.mjs";
import { dashboard as commercial } from "./commercial.mjs";
import { dashboard as valueFinance } from "./value-finance.mjs";

export const DASHBOARDS = [overview, alerts, inputOutcome, processAnalysis, exceptions, processDetail, capacity, exec, valueFinance, commercial];
