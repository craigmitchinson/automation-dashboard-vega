# Formulas: every measure on every panel

All measures are sums over `ia-workqueue-items` (mapped items only, unless stated), worked out in the Vega spec from a small aggregated response. The **window** is the Kibana time picker, bucketed into whole UTC days by `@timestamp` (the outcome time). The **previous period** is the same number of days immediately before it. The **fiscal year** is the one containing the window's last day, starting in `fiscal_year_start_month` (April). The React source for each rule is given so it can be checked line by line.

Short names used below (all `sum` aggregations): `c` completed, `b` business exceptions, `s` system exceptions, `e` exceptions, `a` attempts (c + e), `w` worktime seconds, `cw` completed worktime seconds, `h` hours saved, `gb` gross benefit, `rw` rework cost, `ec` estate cost, `cp` people cost, `ci` infra cost.

## Shared measures

| Measure | Formula | React source |
|---|---|---|
| Completion rate | c / a | filters-context.tsx `aggregate()` |
| Exception rate | e / a | |
| System exception rate | s / a | alerts/engine.ts `aggregateRates()` |
| Cost per completed case | ec / c | |
| Gross benefit | Σ benefit (SMV × grade rate in force ÷ 60, per completed item) | economics.ts `benefitForRow()` |
| Estate cost | Σ stamped cost (hub + own spoke pools, shared by worktime) | economics.ts `costForRow()` |
| Net benefit | gb − ec | |
| ROI | gb / ec | |
| Colleague hours saved | Σ SMV / 60 over completed items | |
| FTE released | h / (days in window × working days per year / 365.25 × productive hours per day), with the working assumptions in force on the window's last day (`ia-cost-daily` HUB doc) | filters-context.tsx |
| Exception (rework) cost | Σ rw | economics.ts `reworkCostForRow()` |
| Delta vs previous period | (current − previous) / previous; null when previous is 0. Net uses abs(previous) | |
| Target in force | `ia-reference` override for the spoke when exactly one spoke is in the selection, else the global target | target-rules.ts `resolvedTarget()` |
| Rate band colour | red above target; purple within `warn_margin` (10%) below it; ink otherwise | target-rules.ts `rateBand()` |

## Overview

| Panel | Measure |
|---|---|
| KPIs | Completion rate (target ≥), cost per completed case (target ≤), exceptions with daily sparkline, net/FTE value = (gb − ec) / FTE, completed cases with sparkline, colleague time saved. All carry the delta vs previous period. |
| Daily case flow | c, b, s per day, weekends shaded. The 7-day average toggle is a trailing 7-day mean, offered from 60 days up. |
| Watchlist | Top 5 processes by e / a, with process estate cost. Click filters to the process. |
| Throughput by process | Top 7 by c. Click filters. |
| Outcome mix | c, b, s as share of a; daily 100% strip from 15 days up; estate cost total. |

## Input & Outcome

| Panel | Measure |
|---|---|
| KPIs | Volume in = a; completed out = c (c/a of intake); business b (b/a); system s (s/a) |
| Case flow | a (dashed), c, b, s per day or per month |
| Outcome split | c/a and e/a per day or month, with the completion target and exception ceiling as reference lines |
| Period summary | a, c, b, s, active days (days in the window with a > 0), average cases per day = a / active days |

## Process Analysis

| Panel | Measure |
|---|---|
| Process performance | Avg completion time = cw / c (bot runtime per completed case); throughput = c; exception rate = e / a × 100. Click filters. |
| Exception time trend | s and b per day or month |
| Process league table | Sorted by ec. Cycle = cw / c, exc % = e / a (rate band), cost = ec. Footer: weighted average cycle = Σ(cycle × a) / Σ a. |

## Exceptions

| Panel | Measure |
|---|---|
| KPIs | e (delta vs previous), s and its share of e, b and its share of e, rework cost split business/system |
| Heatmap | Exception count by process (rows, by attempts descending) × reason (columns, system then business, by volume). Cell opacity = 0.12 + 0.8 × value / max. Row totals with bars; column totals. |
| Exception detail | Per reason: volume, share of all exceptions, rework cost, most recent (max `@timestamp`). Category toggle and search box (Kibana shows the search under the panel). |

## Process detail

| Panel | Measure |
|---|---|
| Chooser | Shown until exactly one process is in the selection. Top 3 by e / a, then every process in the selection grouped by spoke. Click filters. |
| Banner + KPIs | c; e (e/a of attempts); c / a; average cycle = cw / c in seconds; ec (ec / c per case) |
| Daily flow | c, b, s per day |
| Top exceptions | Top 7 reasons by volume, coloured by type; subtitle shows the process's rework cost |
| Digital workers | VDIs that ran the process: items and utilisation (see Capacity) |
| Process profile | SMV, grade, current grade rate (reference), hours released (h), description |

## VDI & Capacity

| Measure | Formula | React source |
|---|---|---|
| Licensed hours (per VDI) | Σ `operating_hours` in `ia-vdi-daily` over the window (20 a day while inside the coverage window) | economics.ts `availableDaysInWindow()` |
| Active hours | Σ worktime / 3,600 of mapped items run on the VDI, in the current selection | |
| Utilisation | min(1, active / licensed) | |
| Idle hours / idle % | max(0, licensed − active); idle / licensed | |
| Which VDIs appear | Any with activity in the selection, plus those owned by a spoke in the selection; all of them (Hub test machine included) when every spoke is in the selection | filters-context.tsx `vdis` |
| Active digital workers | count with items > 0 | Capacity.tsx |
| Average utilisation | Σ active / Σ licensed, over active workers only | |
| Spare capacity | Σ idle over active workers | |
| Utilisation colour | red at or above utilMax; teal within the band; purple below utilMin | |
| Cost share | Σ stamped estate cost of the VDI's items | |

## Executive Summary (fiscal year to date)

| Panel | Measure |
|---|---|
| KPIs | Net, gross and cost for the FY to date. ROI. vs annual target = projected FY-end / target (`finance_target` for the single selected spoke, else ESTATE). Projected FY-end = FYTD net + (FYTD net / FY days so far) × days left in the FY (excluding the last day). |
| Net comparison | vs the same day-offset in the prior FY: a percentage only when both are positive, otherwise "improved/worsened from £x" (exec-rules.ts `comparePeriods()`) |
| Operations | Completed (monthly sparkline), completion rate, exception rate, cost per case (global targets), FTE over FY days, hours saved; each vs prior FY to the same point |
| Estate health | Breach and warning counts from the alert engine (estate plus the selected spoke's own alerts first); active workers and utilisation over the FY; spare hours |
| By hub / by proposition | Per spoke (or per proposition within one spoke): FYTD net, vs target, completed, e / a, ec / c, trend vs last FY |
| Movers | Top 5 processes by FYTD net with share of positive net and trend vs last FY. Bottom 3 loss-makers with the review reason. |
| Briefing | Three generated sentences (exec-rules.ts `buildBriefing()`): FYTD net and comparison (and target, when set); highest-priority breach, else the worst process above the exception ceiling; top loss-maker and its reason. Monthly net bars. |

## Value & Finance

| Panel | Measure |
|---|---|
| KPIs | Net (window, delta vs previous); annualised run-rate = net × 365.25 / days; ROI; payback months = ec / (run-rate / 12); FTE; cost per case vs target |
| FY target attainment | FYTD net, projected FY-end (window run-rate × days left), target, projected / target, prior FY to the same point |
| Benefit waterfall | Gross; less teams (Σ `cost.people_gbp`); less machines (Σ `cost.infra_gbp`); net. Memo: unattributed pool cost = Σ `total_gbp` in `ia-cost-daily` on days with no worktime estate-wide (not subtracted). |
| Monthly value trend | Monthly cost split teams/machines at the window's overall ratio; net line; FYTD vs prior FYTD |
| Spoke P&L | Per spoke: gross, people, infra, net, margin = net / gross, ec / c, completed, FYTD net / spoke target, 12 weekly net buckets over the 84 days to the window end |
| Process value league | Processes with net > 0, top 15, with cumulative net and the 80% line; "80% comes from N processes" |
| Review candidates | Net < 0, worst first. Reason, first match wins (value-rules.ts): fewer than 30 completions; rework > 30% of cost; cost per case > 1.5 × the global target; else cost exceeds benefit. |

## Commercial Performance

| Panel | Measure |
|---|---|
| KPIs | ec / c vs the global target (delta vs previous), ec, gb, gb − ec, gb / ec |
| Human cost assumption | Blended rate = gb / h. The what-if slider (under the panel) re-values benefit at a flat £/h: gross = h × rate, net and ROI follow. Affects this panel only. |
| Cost per completed case over time | Per day: ec / max(c, 0.5 × a), with the target line |
| Cumulative benefit vs cost | Running Σ gb and Σ ec over the window |
| Forecasts (both charts) | 14 days. Each day = mean of the same weekday 1 to 4 weeks back where present (two or more needed, else the mean of the last 7 days with activity). Band = max(standard deviation, 5% of mean), floored at 0. Cumulative forecasts integrate the daily forecasts onto the last actual. (forecast.ts) |

## Alerts

Trailing 7 days to the window's last day, estate-wide: dashboard filters are ignored, except that a single selected spoke narrows the list to the estate alerts plus that spoke's own. (alerts/engine.ts)

| Scope | Metrics | Threshold used |
|---|---|---|
| Estate | completion, exception, system exception rates, cost per case | global |
| Spoke | same, skipped with no attempts | spoke override, else global |
| Process | same, only with 30 or more attempts | process override, then spoke override, then global |
| Digital worker | utilisation = active / licensed hours over the 7 days | spoke utilMin / utilMax |
| Digital worker | days since its last item ever (all items, mapped or not), not retired | vdiStaleDays; warning only |

Severity for a floor (completion, utilisation minimum): below it is a breach; below threshold + (1 − threshold) × 10% is a warning. For a ceiling: above it is a breach; above threshold × 90% is a warning. Ordered by severity, then scope (estate, spoke, process, worker), then name.
