# Runs etl/logstash/ia-cost.rb outside Logstash and compares it with the JS
# reference's mock output (run `npm run mock` first):
#   1. pools mode: the mock's per-day worktime, summed from ia-workqueue-items.ndjson and
#      fed as an elasticsearch-input event (day by day shape A, and again as an
#      http_poller _search body, shape B) must give every ia-cost-daily and
#      ia-vdi-daily document in mock/, exactly;
#   2. stamp mode: the pool docs just made, looked up the way filter-elasticsearch
#      would, must give every mapped item the cost.* the mock holds.
#   ruby tests/ruby_cost_harness.rb
require "json"
require "date"

module LogStash
  class Event
    def initialize(h = {}) ; @h = JSON.parse(JSON.generate(h)) ; @meta = {} ; end
    def keys_of(path) ; path.scan(/[^\[\]]+/) ; end
    def get(path)
      ks = keys_of(path)
      cur = ks.first == "@metadata" ? @meta : @h
      ks = ks.drop(1) if ks.first == "@metadata"
      ks.each { |k| return nil unless cur.is_a?(Hash) ; cur = cur[k] }
      cur
    end
    def set(path, v)
      ks = keys_of(path)
      cur = ks.first == "@metadata" ? @meta : @h
      ks = ks.drop(1) if ks.first == "@metadata"
      ks[0..-2].each { |k| cur = (cur[k] ||= {}) }
      cur[ks.last] = v
    end
    def remove(path) ; @h.delete(path) ; end
    def to_hash ; @h ; end
  end
end

ROOT = File.expand_path("..", __dir__)
load File.join(ROOT, "etl/logstash/ia-cost.rb")
REF = File.join(ROOT, "etl/reference/reference.json")

def mock_docs(name)
  File.foreach(File.join(ROOT, "mock", name)).each_slice(2).map { |_meta, doc| JSON.parse(doc) }
end

def same?(a, b)
  case a
  when Hash then b.is_a?(Hash) && a.keys.sort == b.keys.sort && a.all? { |k, v| same?(v, b[k]) }
  when Numeric then b.is_a?(Numeric) && (a - b).abs <= 1e-9 * [1, a.abs, b.abs].max
  else a == b
  end
end

# Worktime per outcome_date, estate-wide and per spoke: the aggregation, summed by hand.
estate = Hash.new(0)
per_spoke = Hash.new { |h, k| h[k] = Hash.new(0) }
File.foreach(File.join(ROOT, "mock/ia-workqueue-items.ndjson")).each_slice(2) do |_meta, line|
  it = JSON.parse(line)
  estate[it["outcome_date"]] += it["worktime_sec"]
  per_spoke[it["outcome_date"]][it["spoke"]["name"]] += it["worktime_sec"] if it["spoke"]
end
days = estate.keys.sort
first, last = Date.iso8601(days.first), Date.iso8601(days.last)

by_day = { "buckets" => days.map { |d| { "key_as_string" => d, "doc_count" => 1, "w" => { "value" => estate[d].to_f }, "sp" => { "buckets" => per_spoke[d].map { |n, v| { "key" => n, "doc_count" => 1, "w" => { "value" => v.to_f } } } } } } }
agg_input = { "by_day" => by_day }
poller_input = { "took" => 5, "timed_out" => false, "hits" => { "hits" => [] }, "aggregations" => { "by_day" => by_day } }

bad = 0
expected = (mock_docs("ia-cost-daily.ndjson") + mock_docs("ia-vdi-daily.ndjson")).map { |d| [d["resource"] ? "ia-vdi-daily" : "ia-cost-daily", d] }
made = {}
{ "elasticsearch input" => agg_input, "http_poller" => poller_input }.each do |label, body|
  register("mode" => "pools", "reference_path" => REF, "lookback_days" => (last - first).to_i + 1, "as_of_date" => (last + 1).iso8601)
  out = filter(LogStash::Event.new(body))
  docs = out.map { |e| [e.get("[@metadata][index]"), e.get("[@metadata][doc_id]"), e.to_hash] }
  made[label] = docs
  bad_here = 0
  bad_here += (expected.size - docs.size).abs
  by_id = docs.map { |i, id, d| [[i, id], d] }.to_h
  expected.each do |idx, d|
    id = idx == "ia-vdi-daily" ? "#{d["date"]}|#{d["resource"]["name"]}" : "#{d["date"]}|#{d["pool"]}"
    bad_here += 1 unless same?(d, by_id[[idx, id]])
  end
  puts "pools via #{label}: #{docs.size} documents (#{expected.size} expected), #{bad_here} mismatches"
  bad += bad_here
end
bad += 1 unless same?(made["elasticsearch input"].map(&:last), made["http_poller"].map(&:last))

# A bad body writes nothing.
register("mode" => "pools", "reference_path" => REF, "lookback_days" => 3)
bad += filter(LogStash::Event.new("error" => "x")).size

# Stamp mode: look the pool docs up as filter-elasticsearch would.
pool = {}
made["elasticsearch input"].each { |i, _id, d| pool[[d["date"], d["pool"]]] = d if i == "ia-cost-daily" }
register("mode" => "stamp")
stamped = 0
bad_stamp = 0
first_item = nil
File.foreach(File.join(ROOT, "mock/ia-workqueue-items.ndjson")).each_slice(2) do |_meta, line|
  it = JSON.parse(line)
  next unless it["mapped"]
  first_item ||= it
  e = LogStash::Event.new(it.reject { |k, _| k == "cost" })
  hub = pool[[it["outcome_date"], "HUB"]]
  sp = pool[[it["outcome_date"], it["spoke"]["name"]]]
  e.set("[@metadata][hub_people]", hub["people_gbp"]); e.set("[@metadata][hub_infra]", hub["infra_gbp"]); e.set("[@metadata][hub_wt]", hub["worktime_sec"])
  e.set("[@metadata][spoke_people]", sp["people_gbp"]); e.set("[@metadata][spoke_infra]", sp["infra_gbp"]); e.set("[@metadata][spoke_wt]", sp["worktime_sec"])
  out = filter(e)
  if out.size != 1 then bad_stamp += 1 ; next end
  h = out[0].to_hash
  want = it["cost"]
  got = h["cost"]
  ok = h.keys.sort == %w[@timestamp cost] && out[0].get("[@metadata][doc_id]") == it["item"]["id"] && !got["stamped_at"].nil? &&
       want.all? { |k, v| (got[k] - v).abs <= 2e-8 } # the mock rounds to 8 dp
  bad_stamp += 1 unless ok
  stamped += 1
end
# An item with no pool doc for its day is skipped, not stamped with zeros.
e = LogStash::Event.new(first_item.reject { |k, _| k == "cost" })
bad_stamp += 1 unless filter(e).empty?
puts "stamp: #{stamped} mapped items, #{bad_stamp} mismatches"
bad += bad_stamp

puts "ruby cost: #{bad} mismatches"
exit(bad.zero? ? 0 : 1)
