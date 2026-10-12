# -----------------------------------------------------------------------------
# ia-enrich.rb: Logstash ruby filter for stage 1 of the ETL (one Blue Prism
# work-queue item in, one ia-workqueue-items document out).
#
# Ruby twin of etl/reference-impl/pipeline.mjs enrichItem(); tests/ruby
# checks the two agree on the mock data. Wire it in with:
#
#   filter {
#     ruby {
#       path => "/etc/logstash/ia/ia-enrich.rb"
#       script_params => {
#         "reference_path" => "/etc/logstash/ia/reference.json"
#         "reload_seconds" => 300
#       }
#     }
#   }
#
# SOURCE_FIELDS maps the contract's names to wherever your existing Blue
# Prism index keeps them. Change the right-hand side only.
# -----------------------------------------------------------------------------
require "json"
require "time"

SOURCE_FIELDS = {
  "ID" => "[ID]",
  "KeyValue" => "[KeyValue]",
  "Priority" => "[Priority]",
  "Status" => "[Status]",
  "Tags" => "[Tags]",
  "Resource" => "[Resource]",
  "Attempt" => "[Attempt]",
  "LoadedDate" => "[LoadedDate]",
  "LastUpdatedDate" => "[LastUpdatedDate]",
  "DeferredDate" => "[DeferredDate]",
  "LockedDate" => "[LockedDate]",
  "CompletedDate" => "[CompletedDate]",
  "Worktime" => "[Worktime]",
  "ExceptionDate" => "[ExceptionDate]",
  "ExceptionReason" => "[ExceptionReason]",
  "QueueName" => "[QueueName]",
}.freeze

# Set to 1000 if Worktime arrives in milliseconds (common from Elastic).
WORKTIME_DIVISOR = 1

def register(params)
  @reference_path = params["reference_path"]
  @reload_seconds = (params["reload_seconds"] || 300).to_i
  load_reference
end

def load_reference
  ref = JSON.parse(File.read(@reference_path))
  @ref = ref
  @loaded_at = Time.now
  @proc_by_id = ref["processes"].map { |p| [p["processId"], p] }.to_h
  @prop_by_id = ref["propositions"].map { |p| [p["propositionId"], p] }.to_h
  @spoke_by_id = ref["spokes"].map { |s| [s["spokeId"], s] }.to_h
  @queue_map = ref["queueMap"].map { |q| [q["queueName"], q] }.to_h
  @resource_by_name = ref["resources"].map { |r| [r["resourceName"], r] }.to_h
  @patterns = ref["exceptionPatterns"]
    .map { |p| p.merge("needle" => p["matchPattern"].delete("%").downcase) }
    .sort { |a, b| [-a["priority"], -a["matchPattern"].length] <=> [-b["priority"], -b["matchPattern"].length] }
  @grade_names = (ref["grades"] || []).map { |g| [g["grade"], g["gradeName"]] }.to_h
end

# T1. Blue Prism dates are UTC with no offset; blank or bad becomes nil.
def parse_bp(value)
  return nil if value.nil?
  s = value.to_s.strip
  return nil if s.empty?
  s = s.sub(" ", "T")
  s += "Z" unless s =~ /(Z|[+-]\d\d:?\d\d)\z/i
  Time.iso8601(s).utc
rescue ArgumentError
  nil
end

def iso(t)
  t && t.strftime("%Y-%m-%dT%H:%M:%S.%LZ")
end

# T2/T3. Latest row with effectiveFrom <= date; spoke rows win over universal.
def in_force(rows, date_iso)
  rows.select { |r| r["effectiveFrom"] <= date_iso }.max_by { |r| r["effectiveFrom"] }
end

def grade_rate(grade, spoke_id, date_iso)
  rows = @ref["gradeRates"].select { |g| g["grade"] == grade }
  unless spoke_id.nil?
    via_spoke = in_force(rows.select { |g| g["spokeId"] == spoke_id.to_s }, date_iso)
    return via_spoke["hourlyCostGBP"] if via_spoke
  end
  universal = in_force(rows.select { |g| g["spokeId"].nil? }, date_iso)
  universal ? universal["hourlyCostGBP"] : 0
end

# T4. Prefix wins, then patterns (priority, then longest), else Business.
def classify(reason)
  return "Business" if reason.nil? || reason.empty?
  return "Business" if reason =~ /\Abusiness exception/i
  return "System" if reason =~ /\Asystem exception/i
  low = reason.downcase
  hit = @patterns.find { |p| low.include?(p["needle"]) }
  hit ? hit["exceptionType"] : "Business"
end

def display_reason(reason)
  r = (reason || "").sub(/\A(business|system) exception:?\s*/i, "")
  r.empty? ? "(no reason recorded)" : r
end

def reason_code(display)
  fixed = (@ref["exceptionDisplayCodes"] || {})[display]
  return fixed if fixed
  display.split(%r{[\s/]+}).reject(&:empty?).map { |w| w[0] }.join[0, 3].upcase
end

def int_or_nil(v)
  Integer(v.to_s.strip, 10)
rescue ArgumentError, TypeError
  nil
end

def src(event, name)
  v = event.get(SOURCE_FIELDS[name])
  v.is_a?(String) ? v.strip : v
end

def filter(event)
  load_reference if Time.now - @loaded_at > @reload_seconds

  id = src(event, "ID").to_s
  return [] if id.empty? # blank-ID rows are dropped

  loaded = parse_bp(src(event, "LoadedDate"))
  completed = parse_bp(src(event, "CompletedDate"))
  exception_at = parse_bp(src(event, "ExceptionDate"))
  locked = parse_bp(src(event, "LockedDate"))
  last_updated = parse_bp(src(event, "LastUpdatedDate")) || completed || exception_at || locked || loaded
  worktime = ((int_or_nil(src(event, "Worktime")) || 0) / WORKTIME_DIVISOR.to_f).round

  # Outcome from which date is populated, never the Status text.
  outcome = completed ? "Completed" : exception_at ? "Exception" : "Pending"
  outcome_ts = completed || exception_at || loaded
  outcome_date = outcome_ts.strftime("%Y-%m-%d")

  queue_name = src(event, "QueueName")
  qm = @queue_map[queue_name]
  proc_ref = qm && @proc_by_id[qm["processId"]]
  prop = proc_ref && @prop_by_id[proc_ref["propositionId"]]
  spoke = prop && @spoke_by_id[prop["spokeId"]]
  res_name = src(event, "Resource")
  res = @resource_by_name[res_name]
  res_owner = res ? (res["spokeId"].nil? ? "Hub" : @spoke_by_id[res["spokeId"]]["spokeName"]) : nil

  reason = src(event, "ExceptionReason")
  reason = nil if reason.respond_to?(:empty?) && reason.empty?
  exc_type = outcome == "Exception" ? classify(reason) : nil
  display = outcome == "Exception" ? display_reason(reason) : nil

  rate = proc_ref ? grade_rate(proc_ref["grade"], prop["spokeId"], outcome_date) : 0
  smv = proc_ref ? proc_ref["smvMinutes"] : 0
  is_c = outcome == "Completed" ? 1 : 0
  is_e = outcome == "Exception" ? 1 : 0

  doc = {
    "@timestamp" => iso(outcome_ts),
    "outcome_date" => outcome_date,
    "item" => {
      "id" => id,
      "key_value" => src(event, "KeyValue").to_s.empty? ? nil : src(event, "KeyValue"),
      "priority" => int_or_nil(src(event, "Priority")),
      "status" => src(event, "Status").to_s.empty? ? nil : src(event, "Status"),
      "tags" => src(event, "Tags").to_s.empty? ? nil : src(event, "Tags"),
      "attempt" => int_or_nil(src(event, "Attempt")),
      "loaded_at" => iso(loaded),
      "last_updated_at" => iso(last_updated),
      "completed_at" => iso(completed),
      "exception_at" => iso(exception_at),
      "locked_at" => iso(locked),
      "deferred_at" => iso(parse_bp(src(event, "DeferredDate"))),
    },
    "queue" => { "name" => queue_name.to_s.empty? ? nil : queue_name, "stage" => qm && qm["stageName"], "stage_order" => qm && qm["stageOrder"] },
    "resource" => { "name" => res_name.to_s.empty? ? nil : res_name, "bot" => res && res["botName"], "owner_spoke" => res_owner },
    "outcome" => outcome,
    "exception" => exc_type ? { "type" => exc_type, "reason" => reason, "reason_display" => display, "code" => reason_code(display) } : nil,
    "worktime_sec" => worktime,
    "worktime_completed_sec" => is_c == 1 ? worktime : 0,
    "mapped" => !proc_ref.nil?,
    "n" => {
      "completed" => is_c,
      "exception" => is_e,
      "business" => exc_type == "Business" ? 1 : 0,
      "system" => exc_type == "System" ? 1 : 0,
      "pending" => outcome == "Pending" ? 1 : 0,
      "attempt" => is_c + is_e,
    },
    "process" => proc_ref && {
      "id" => proc_ref["processId"].to_s,
      "name" => proc_ref["processName"],
      "acronym" => proc_ref["processAcronym"],
      "tags" => proc_ref["tags"] || [],
      "smv_minutes" => smv,
      "grade" => proc_ref["grade"],
      "grade_name" => @grade_names[proc_ref["grade"]] || proc_ref["grade"],
    },
    "proposition" => prop && { "name" => prop["propositionName"] },
    "spoke" => spoke && { "id" => spoke["spokeId"].to_s, "name" => spoke["spokeName"], "short" => spoke["shortName"] },
    "value" => {
      "hourly_rate_gbp" => rate,
      "hours_saved" => proc_ref && is_c == 1 ? smv / 60.0 : 0,
      "benefit_gbp" => proc_ref && is_c == 1 ? (smv * rate / 60.0).round(6) : 0,
      "rework_gbp" => proc_ref && is_e == 1 ? (smv * rate / 60.0).round(6) : 0,
    },
    "cost" => nil, # stamped by the cost job (stage 2)
  }

  out = LogStash::Event.new(doc)
  out.set("[@metadata][doc_id]", id)
  [out]
end
