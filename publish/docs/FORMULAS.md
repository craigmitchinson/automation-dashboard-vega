# Formulas: every measure on every panel

All measures are sums over `ia-workqueue-items` (mapped items only, unless stated), worked out in the Vega spec from a small aggregated response. The **window** is the Kibana time picker, bucketed into whole UTC days by `@timestamp` (the outcome time). The **previous period** is the same number of days immediately before it. The **fiscal year** is the one containing the window's last day, starting in `fiscal_year_start_month` (April). The React app source for each rule is given so it can be checked line by line.

Short names used below (all `sum` aggregations): `c` items completed, `b` business exceptions, `s` system exceptions, `e` exceptions, `a` attempts (c + e), `w` worktime seconds, `cw` completed worktime seconds, `h` hours saved, `gb` gross benefit, `rw` rework exposure (£), `rh` rework exposure (hours), `ec` estate cost, `cp` people cost, `ci` infra cost, `cd` cases completed, `f1` first attempts, `fo` first attempts completed, `sl` completed within SLA, `ta` turnaround seconds.

**Mastheads.** Every dashboard opens with its group, title and the question it answers, then the period (the picker's days; Service: the 24 hours to the picker's end; Executive Summary: fiscal year to date), the scope (all hubs, one hub, a number of hubs, or one process) and the latest item's outcome time in that selection.

**Items and cases.** Every count is of Blue Prism work items. A case can produce several items: a retry is a new item, and a multi-stage process (Pension Transfers) has one item per stage. **Cases completed** counts only completed items at a process's final stage. Benefit and hours saved are earned once per case (T13): split across the stages by `stageShare` where reference data sets it, otherwise at the final stage. The React app earned the full SMV at every stage.

**Release markers** (◆ on Overview, Process Analysis, Exceptions and Process detail) come from `releases` in reference.json (`ia-reference` doc_type `release`).

## Shared measures

| Measure | Formula | React source |
|---|---|---|
| Completion rate | c / a | filters-context.tsx `aggregate()` |
| Exception rate | e / a | |
| System exception rate | s / a | alerts/engine.ts `aggregateRates()` |
| Cost per completed item | ec / c | |
| Gross benefit | Σ benefit (SMV × stage share × grade rate in force ÷ 60, per completed item; share 1 at the final stage when no shares are set) | economics.ts `benefitForRow()`, plus T13 |
| Estate cost | Σ stamped cost (hub + own spoke pools, shared by worktime) | economics.ts `costForRow()` |
| Net benefit | gb − ec | |
| ROI | gb / ec | |
| Colleague hours saved | Σ SMV / 60 over completed items | |
| FTE released | h / (days in window × working days per year / 365.25 × productive hours per day), with the working assumptions in force on the window's last day (`ia-cost-daily` HUB doc) | filters-context.tsx |
| Rework exposure | Σ rw: every exception charged the process's full manual time at the grade rate. An upper bound: a retried system exception may cost nobody anything. | economics.ts `reworkCostForRow()` |
| Within SLA | sl / c (completed within the process's `slaHours`, else `slaHoursDefault`) | T14 |
| Turnaround | ta / a: loaded to outcome | T14 |
| First-time success | fo / f1 | |
| Delta vs previous period | (current − previous) / previous; null when previous is 0. Net uses abs(previous) | |
| Target in force | `ia-reference` override for the spoke when exactly one spoke is in the selection, else the global target | target-rules.ts `resolvedTarget()` |
| Rate band colour | red above target; purple within `warn_margin` (10%) below it; ink otherwise | target-rules.ts `rateBand()` |

## Overview

| Panel | Measure |
|---|---|
| KPIs | Completion rate (target ≥), cost per completed item (target ≤), exceptions with daily sparkline, cases completed (cd, with c / cd items per case), items completed with sparkline, colleague time saved. All carry the delta vs previous period. |
| Item flow | c, b, s per day, as a trailing 7-day mean, or per month; weekends shaded on daily views; release markers |
| Watchlist | Top 5 processes by e / a among those with 30 or more attempts, with process estate cost. Click filters to the process. |
| What moved | Per process, this window against the equal window before (30+ attempts in both): change in items, exception rate (percentage points), cost per completed item, and net benefit (gb − ec); ranked by the size of the net change. Click filters. |
| Hub scorecard | Per spoke, this window: items a (▲▼ against the previous equal window), completion c / a and system exceptions s / a against the spoke's targets (spoke override, else global), all exceptions e / a, within SLA sl / c, cost per item ec / c against target, net benefit gb − ec, FTE released. Hubs missing most targets first. Click filters. |
| Day by day | Each day's e / a, as a calendar (weeks across, weekdays down) with the figure in each cell, shaded from better (green) to worse (red) against the window's own e / a; outlined when 1.5 times it. Days with under 20 items are grey. |

## Work in & out

"In" is items by `item.loaded_at`; "out" is attempts (completed + exceptions) by `@timestamp`. Waiting at the window's end = items loaded by then that were still pending or finished later.

| Panel | Measure |
|---|---|
| KPIs | Work in; work out (c and e); waiting at the period end, with the change over the period (in − out) and the oldest; cases completed (cd, with c / cd items per case); cost per completed item (ec / c); cost per completed case (ec / cd). Deltas against the previous equal period. |
| In and out | In, c and e per day, week or month; waiting at the end of each = waiting at the window's end − Σ (in − out) over the days after it |
| Where the work went | Items in the window (pending ones by their loaded date) from process to queue or stage to outcome, widths in items; top 12 processes by items |
| Waiting by age | Pending items loaded by the window's end, per process (top 30), by age at the window's end: under 4 h, 4 to 24 h, 1 to 3 days, 3 to 7 days, over 7 days; with the count past `item.sla_due_at` and the oldest. Processes with the oldest work first. |
| Period by period | Per month or week: in, c, b, s, c / a, cd, bot hours (w / 3,600), ec, ec / c, ec / cd, FTE saved (h, as the FTE formula over the period's days in the window), FTE handed back (business rh, the same way) |

## Process Analysis

| Panel | Measure |
|---|---|
| Process performance | One of: missed SLA (1 − sl / c), turnaround (ta / a), needed a retry (1 − fo / f1), bot runtime (cw / c), throughput (c), exception rate (e / a); worst first, so the bar length is the problem. Click filters. |
| SLA and first time | Daily or monthly sl / c and fo / f1, with release markers; subtitle has the window's totals and turnaround |
| Bot time per item | Daily or monthly cw / c (completed) and (w − cw) / e (time spent before an exception), with release markers |
| Bot time lost to exceptions | Per process: e; lost bot hours (w − cw) / 3,600 and their share of the process's bot time; cost of lost time = Σ ec over its exception items; rework exposure; the reason with the most lost bot time and its share. Worst cost first, with an all-process total. |
| Process league table | Per process: items, SLA hours, within SLA, turnaround, first time, runtime, exception rate (rate band), cost; sortable, by cost by default. Under 30 attempts is flagged in the tooltip. |

## Exceptions

| Panel | Measure |
|---|---|
| KPIs | e (delta vs previous), s and its share of e, b and its share of e, rework exposure split business/system, work handed back = Σ rh over business exceptions / window days |
| Heatmap | Exception count by process (rows, by attempts descending) × reason (columns, system then business, by volume). Cell opacity = 0.12 + 0.8 × value / max. Row totals with bars; column totals. |
| Exception trend | s and b per day or month, with release markers (moved from Process Analysis) |
| Work handed back | Per proposition: Σ rh of business exceptions / window days (colleague hours a day); items a day in the tooltip |
| Exception detail | Per reason: volume, share of all exceptions, rework exposure, most recent (max `@timestamp`). Category toggle and search box (Kibana shows the search under the panel). Clicking a row, or a reason code on the heatmap, filters the page to that reason; so does the Exception reason control. |
| When exceptions happen | The 12 most frequent reasons by `outcome_hour` or `outcome_weekday` (T16), cells shaded by count, coloured by type |

## Process detail

| Panel | Measure |
|---|---|
| Chooser | Shown until exactly one process is in the selection. Top 3 by e / a, then every process in the selection grouped by spoke. Click filters. |
| Banner + KPIs | c; e (e/a of attempts); c / a; average cycle = cw / c in seconds; ec (ec / c per item) |
| Daily flow | c, b, s per day, with release markers for this process and estate-wide changes |
| Top exceptions | Top 7 reasons by volume, coloured by type; subtitle shows the process's rework exposure |
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
| Room for more work | spare hours × 3,600 ÷ (w / a) ÷ window days × 30.44: items a month the idle hours could take at the current average runtime | |
| Utilisation colour | red at or above utilMax; teal within the band; purple below utilMin | |
| Cost share | Σ stamped estate cost of the VDI's items | |
| Utilisation over time | Per day, week or month: Σ w / 3,600 ÷ Σ licensed hours of the workers in view, against the utilisation floor and ceiling | |
| Digital workers needed | Σ w / 3,600 ÷ (days × operating hours a day), against licensed workers = licensed hours ÷ (days × operating hours). Filter a process to size it. | |
| When the work runs | Σ w / 3,600 by process (top 20 by bot time) and `outcome_hour` or `outcome_weekday` (T16). With one worker in the Digital worker control, that worker's day. | |

## Executive Summary (fiscal year to date)

| Panel | Measure |
|---|---|
| KPIs | Net, gross and cost for the FY to date. ROI. vs annual target = projected FY-end / target (`finance_target` for the single selected spoke, else ESTATE); when no target is set, the tile shows cases completed instead. Projected FY-end = FYTD net + (FYTD net / FY days so far) × days left in the FY (excluding the last day). Value & Finance uses the same projection. |
| Net comparison | vs the same day-offset in the prior FY: a percentage only when both are positive, otherwise "improved/worsened from £x" (exec-rules.ts `comparePeriods()`) |
| Operations | Items completed (monthly sparkline), completion rate, exception rate, cost per item (global targets), FTE over FY days, hours saved; each vs prior FY to the same point |
| Estate health | Processes in breach of a target over the trailing 7 days, and the money at stake (per process: its 7-day rework exposure, counted once, plus cost above target), the two biggest named; active workers and utilisation over the FY; room for more work (as Capacity, over the FY) |
| By hub / by proposition | Per spoke (or per proposition within one spoke): FYTD net, vs target (net per item when no targets are set), items, e / a, ec / c, trend vs last FY |
| Movers | Top 5 processes by FYTD net with share of positive net and trend vs last FY. Bottom 3 loss-makers with the review reason. |
| Briefing | Three generated sentences (exec-rules.ts `buildBriefing()`): FYTD net and comparison (and target, when set); highest-priority breach, else the worst process above the exception ceiling; top loss-maker and its reason. Monthly net bars. |

## Value & Finance

| Panel | Measure |
|---|---|
| KPIs | Net (window, delta vs previous); annualised net = net × 365.25 / window days; ROI; colleague hours released (h); FTE; cost per item vs target. (Payback was removed: it divided running cost by net benefit, which repays nothing.) |
| FY target attainment | FYTD net, projected FY-end (the Executive Summary projection), prior FY to the same point; target and projected / target appear only when a target is set |
| Benefit waterfall | Gross; less teams (Σ `cost.people_gbp`); less machines (Σ `cost.infra_gbp`); net. Memo, shown only when non-zero: unattributed pool cost = Σ `total_gbp` in `ia-cost-daily` on days with no worktime estate-wide (not subtracted). |
| Monthly value trend | Σ cp and Σ ci per month (the stamped split), net line; FYTD vs prior FYTD (a percentage only when both are positive) |
| Cost per completed item over time | Trailing 7 days: Σ ec / max(Σ c, 0.5 × Σ a), so weekend days (fixed cost over few items) don't swamp the trend; target line and a 14-day forecast (moved from Commercial) |
| Cumulative benefit vs cost | Running Σ gb and Σ ec over the window, with 14-day forecasts (moved from Commercial) |
| Colleague time | Per week or month: FTE released (h) and FTE handed back (rh of business exceptions), each over that period's days in the window; subtitle totals and the £ of business rework |
| Spoke P&L | Per spoke: gross, people, infra, net, margin = net / gross, ec / c, items, FYTD net / spoke target (FYTD net when no targets are set), 12 weekly net buckets over the 84 days to the window end |
| Process value league | Processes with net > 0 as ranked bars with the running share; the processes that make up 80% of positive net are darker, above a dashed line; "80% comes from N processes" |
| Review candidates | Net < 0, worst first. Reason, first match wins (value-rules.ts): fewer than 30 completions; rework exposure > 30% of cost; cost per item > 1.5 × the global target; else cost exceeds benefit. |
| Forecasts | 14 days. Each day = mean of the same weekday 1 to 4 weeks back where present (two or more needed, else the mean of the last 7 days with activity). Band = max(standard deviation, 5% of mean), floored at 0. Cumulative forecasts integrate the daily forecasts onto the last actual. (forecast.ts) |

## Service

**Hubs at a glance**: one card per spoke with mapped work in the 29 days to "now". Worked = attempts in the last 24 hours, against usual (the same 24 hours 1 to 4 weeks back). Completed = c / a over the last 24 hours, against the spoke's completion target. Waiting = pending items and how many are past SLA. Cost per item = ec / c over the 7 days to 24 hours ago (cost is stamped daily). Status: Action when the hub has items past SLA, stuck on a lock, or a process or worker check at Action; Warning for items due within 2 hours, a process or worker check at Warning, completion below target (30+ attempts) or cost per item above target; otherwise OK. Hubs are ordered worst first.

Every check, threshold and rule is in [JOBS.md](JOBS.md). "Now" is the end of the time picker. Usual = mean of the same 24-hour window 1, 2, 3 and 4 weeks earlier. A process's usual system exception rate = max(0.5%, s / a over the 28 days before the last 24 hours).

## Alerts

Performance against target over the trailing 7 days to the window's last day, estate-wide: dashboard filters are ignored, except that a single selected spoke narrows the list to the estate alerts plus that spoke's own. (alerts/engine.ts)

**KPIs**: processes breaching at least one target; processes within the warning margin of one; money at stake over the 7 days (per process, counted once, as in the register); hubs breaching at spoke level; digital workers outside the utilisation band.

**Hubs against target**: per spoke and measure, the spoke's own severity (cell colour) and how many of its processes, or for utilisation its workers, breach or are close.

| Scope | Metrics | Threshold used |
|---|---|---|
| Estate | completion, exception, system exception rates, cost per item | global |
| Spoke | same, skipped with no attempts | spoke override, else global |
| Process | same, only with 30 or more attempts | process override, then spoke override, then global |
| Digital worker | utilisation = active / licensed hours over the 7 days | spoke utilMin / utilMax |

Severity for a floor (completion, utilisation minimum): below it is a breach; below threshold + (1 − threshold) × 10% is a warning. For a ceiling: above it is a breach; above threshold × 90% is a warning.

The register shows one row per process, spoke, estate or worker, listing every metric it breaches. **Money at stake** = the scope's 7-day rework exposure (counted once, as all three rate metrics share it) plus, for cost per item, ec − target × c. Rows are ordered by severity, then scope (processes first, as they are what someone can act on), then money at stake. Idle digital workers moved to the Service dashboard ("Workers running").
