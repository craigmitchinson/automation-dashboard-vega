# -----------------------------------------------------------------------------
# ia-cost.rb: Logstash ruby filter for stage 2 of the ETL, the daily cost.
# One script, two modes, chosen by script_params "mode". The rules are in
# docs/JOBS.md.
#
#   mode "pools"  (pipeline ia-cost-daily.conf)
#     In: one event holding the worktime aggregation (see below).
#     Out: one ia-cost-daily event per pool per day and one ia-vdi-daily event
#     per VDI per day, for every day in the lookback, including days with no
#     worktime (their pools are the unattributed memo).
#
#   mode "stamp"  (pipeline ia-cost-stamp.conf)
#     In: one mapped ia-workqueue-items event, plus the day's hub and own-spoke
#     pool docs looked up into [@metadata] by filter-elasticsearch.
#     Out: the same event reduced to the cost fields, for a scripted update.
#
# script_params
#   mode            "pools" or "stamp"
#   reference_path  pools mode: path to reference.json
#   reload_seconds  pools mode: how often reference.json is re-read (300)
#   lookback_days   pools mode: whole past days emitted, ending yesterday UTC (14)
#   as_of_date      pools mode: yyyy-mm-dd standing in for today (tests only)
# Today is never emitted: a day is costed only once it is over, so no item is
# stamped against a partial day's worktime.
#
# The aggregation (pools mode) is read in either shape, so the same filter
# serves both inputs:
#   elasticsearch input, response_type "aggregations":  { "by_day": {...} }
#   http_poller input calling _search:                  { "aggregations": { "by_day": {...} } }
# Expected: by_day = date_histogram on outcome_date, format yyyy-MM-dd, with a
# sum "w" of worktime_sec and a terms "sp" on spoke.name holding the same sum.
# -----------------------------------------------------------------------------
require "json"
require "date"
require "time"

def register(params)
  @mode = params["mode"] || "pools"
  @lookback = [(params["lookback_days"] || 14).to_i, 1].max
  @as_of = params["as_of_date"]
  return unless @mode == "pools"
  @reference_path = params["reference_path"]
  @reload_seconds = (params["reload_seconds"] || 300).to_i
  load_reference
end

def load_reference
  @ref = JSON.parse(File.read(@reference_path))
  @loaded_at = Time.now
end

# --- the economics (docs/JOBS.md; twin of economics.mjs poolsOn / vdiDailyCost) -----------------------
# Latest row with effectiveFrom on or before the day; the first of equals wins.
def in_force(rows, date_iso)
  best = nil
  rows.each do |r|
    best = r if r["effectiveFrom"] <= date_iso && (best.nil? || r["effectiveFrom"] > best["effectiveFrom"])
  end
  best
end

# Latest row for the location on or before the day, else the latest location-less row.
def estate_assumptions(date_iso, location)
  rows = @ref["estateCostHistory"]
  est = in_force(rows.select { |e| e["location"] == location }, date_iso) || in_force(rows.select { |e| e["location"].nil? }, date_iso) || {}
  [est.fetch("workingDaysPerYear", 252), est.fetch("productiveHoursPerDay", 7.5)]
end

def vdi_class_rate(cost_class, date_iso, spoke_id)
  rows = @ref["vdiCostHistory"].select { |v| v["costClass"] == cost_class }
  unless spoke_id.nil?
    via = in_force(rows.select { |v| v["spokeId"] == spoke_id.to_s }, date_iso)
    return via["annualCostPerVDIGBP"] if via
  end
  uni = in_force(rows.select { |v| v["spokeId"].nil? }, date_iso)
  uni ? uni["annualCostPerVDIGBP"] : 0
end

# Renewal cycles repeat every 365 days from renewalDate.
def cycle_start(renewal_iso, date)
  renewal = Date.iso8601(renewal_iso)
  renewal + ((date - renewal).to_i.div(365) * 365)
end

def vdi_daily_cost(vdi, date)
  cs = cycle_start(vdi["renewalDate"], date)
  stop = cs + 365
  stop = [stop, Date.iso8601(vdi["licenseExpiryDate"]) + 1].min if vdi["licenseExpiryDate"]
  stop = [stop, Date.iso8601(vdi["activeTo"]) + 1].min if vdi["status"] == "retired" && vdi["activeTo"]
  start = [cs, Date.iso8601(vdi["activeFrom"])].max
  return 0.0 if date < start || date >= stop
  window = (stop - start).to_i
  annual = vdi["annualCostGBP"]
  annual = vdi_class_rate(vdi["costClass"], cs.iso8601, vdi["spokeId"]) if annual.nil?
  window > 0 ? annual / window.to_f : 0.0
end

def people_cost_on(owner_id, date_iso)
  r = in_force(@ref["peopleCostHistory"].select { |p| p["ownerId"] == owner_id }, date_iso)
  r ? r["annualCostGBP"] : 0.0
end

def whole(n)
  n.is_a?(Float) && n.finite? && n == n.round ? n.round : n
end

# --- pools mode ----------------------------------------------------------------------------------------
def day_events(date, estate_wt, spoke_wt)
  iso = date.iso8601
  ts = "#{iso}T00:00:00.000Z"
  hub_people = people_cost_on("HUB", iso) / 365.25
  hub_infra = 0.0
  spokes = @ref["spokes"].map { |s| [s["spokeId"], { name: s["spokeName"], people: people_cost_on(s["spokeId"].to_s, iso) / 365.25, infra: 0.0 }] }.to_h
  vdi_costs = @ref["resources"].map { |r| [r, vdi_daily_cost(r, date)] }
  vdi_costs.each do |r, c|
    if r["spokeId"].nil? then hub_infra += c else spokes[r["spokeId"]][:infra] += c end
  end
  wd_on, ph_on = estate_assumptions(iso, "Onshore")
  wd_off, ph_off = estate_assumptions(iso, "Offshore")
  common = { "@timestamp" => ts, "date" => iso, "estate_worktime_sec" => estate_wt, "working_days_per_year" => wd_on, "productive_hours_per_day" => ph_on, "working_days_per_year_offshore" => wd_off, "productive_hours_per_day_offshore" => ph_off }

  out = []
  hub_total = hub_people + hub_infra
  out << cost_event(common.merge("pool" => "HUB", "pool_type" => "hub", "spoke" => nil, "people_gbp" => hub_people, "infra_gbp" => hub_infra, "total_gbp" => hub_total, "worktime_sec" => estate_wt, "cost_per_bot_sec" => estate_wt > 0 ? hub_total / estate_wt : 0))
  spokes.each_value do |s|
    wt = spoke_wt[s[:name]] || 0
    total = s[:people] + s[:infra]
    out << cost_event(common.merge("pool" => s[:name], "pool_type" => "spoke", "spoke" => { "name" => s[:name] }, "people_gbp" => s[:people], "infra_gbp" => s[:infra], "total_gbp" => total, "worktime_sec" => wt, "cost_per_bot_sec" => wt > 0 ? total / wt : 0))
  end
  spoke_name = @ref["spokes"].map { |s| [s["spokeId"], s["spokeName"]] }.to_h
  vdi_costs.each do |r, c|
    doc = {
      "@timestamp" => ts,
      "date" => iso,
      "resource" => { "name" => r["resourceName"], "bot" => r["botName"], "owner_spoke" => r["spokeId"].nil? ? "Hub" : (spoke_name[r["spokeId"]] || "Hub"), "cost_class" => r["costClass"], "status" => r["status"] },
      "available" => c > 0,
      "daily_cost_gbp" => c,
      "operating_hours" => c > 0 ? @ref["vdiOperatingHoursPerDay"] : 0,
    }
    e = LogStash::Event.new(doc)
    e.set("[@metadata][index]", "ia-vdi-daily")
    e.set("[@metadata][doc_id]", "#{iso}|#{r["resourceName"]}")
    out << e
  end
  out
end

def cost_event(doc)
  e = LogStash::Event.new(doc)
  e.set("[@metadata][index]", "ia-cost-daily")
  e.set("[@metadata][doc_id]", "#{doc["date"]}|#{doc["pool"]}")
  e
end

def pools(event)
  load_reference if Time.now - @loaded_at > @reload_seconds
  h = event.to_hash
  aggs = h["aggregations"].is_a?(Hash) ? h["aggregations"] : h
  by_day = aggs["by_day"]
  # No aggregation (an error body, say): write nothing rather than zero worktime over good history.
  return [] unless by_day.is_a?(Hash) && by_day["buckets"].is_a?(Array)

  estate = {}
  per_spoke = {}
  by_day["buckets"].each do |b|
    day = b["key_as_string"]
    estate[day] = whole((b["w"] || {})["value"] || 0)
    per_spoke[day] = (((b["sp"] || {})["buckets"]) || []).map { |s| [s["key"], whole((s["w"] || {})["value"] || 0)] }.to_h
  end
  today = @as_of ? Date.iso8601(@as_of) : Time.now.utc.to_date
  out = []
  ((today - @lookback)..(today - 1)).each do |date|
    iso = date.iso8601
    out.concat(day_events(date, estate[iso] || 0, per_spoke[iso] || {}))
  end
  out
end

# --- stamp mode ------------------------------------------------------------------------------------------
# Item cost = worktime x (hub pool per bot-second + own spoke pool per bot-second), by component.
# The hub and spoke pool docs arrive in [@metadata][hub_*] and [@metadata][spoke_*] (people_gbp,
# infra_gbp, worktime_sec of that day's ia-cost-daily doc).
def rate(pool_gbp, worktime)
  worktime > 0 ? pool_gbp / worktime : 0
end

def stamp(event)
  return [] unless event.get("mapped") == true
  vals = %w[hub_people hub_infra hub_wt spoke_people spoke_infra spoke_wt].map { |k| event.get("[@metadata][#{k}]") }
  # A missing pool doc means ia-cost-daily has no row for the day yet: leave the item for the next run.
  return [] if vals.any?(&:nil?)
  hub_people, hub_infra, hub_wt, spoke_people, spoke_infra, spoke_wt = vals.map(&:to_f)
  w = (event.get("worktime_sec") || 0).to_f

  c = {
    "hub_people_gbp" => w * rate(hub_people, hub_wt),
    "hub_infra_gbp" => w * rate(hub_infra, hub_wt),
    "spoke_people_gbp" => w * rate(spoke_people, spoke_wt),
    "spoke_infra_gbp" => w * rate(spoke_infra, spoke_wt),
  }
  c["people_gbp"] = c["hub_people_gbp"] + c["spoke_people_gbp"]
  c["infra_gbp"] = c["hub_infra_gbp"] + c["spoke_infra_gbp"]
  c["estate_gbp"] = c["people_gbp"] + c["infra_gbp"]
  c["stamped_at"] = Time.now.utc.strftime("%Y-%m-%dT%H:%M:%S.000Z")

  event.set("[@metadata][doc_id]", event.get("[item][id]").to_s)
  event.set("cost", c)
  # Leave only cost (Logstash cannot drop @timestamp, but the scripted update in
  # ia-cost-stamp.conf reads only cost from the event).
  event.to_hash.keys.each { |k| event.remove(k) unless %w[cost @timestamp].include?(k) }
  [event]
end

def filter(event)
  @mode == "stamp" ? stamp(event) : pools(event)
end
