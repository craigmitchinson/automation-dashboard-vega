# Runs etl/logstash/ia-enrich.rb outside Logstash on CSV rows and prints one
# JSON document per line, for comparison with the JS reference implementation.
#   ruby tests/ruby_enrich_harness.rb mock/BPAWorkQueueItem.csv 5000
require "csv"
require "json"
module LogStash
  class Event
    def initialize(h = {}) ; @h = h ; @meta = {} ; end
    def get(path) ; key = path.delete("[]") ; @h[key] ; end
    def set(path, v) ; path.start_with?("[@metadata]") ? @meta[path] = v : @h[path.delete("[]")] = v ; end
    def to_hash ; @h ; end
  end
end
load File.expand_path("../etl/logstash/ia-enrich.rb", __dir__)
register("reference_path" => File.expand_path("../etl/reference/reference.json", __dir__))
limit = (ARGV[1] || "5000").to_i
n = 0
CSV.foreach(ARGV[0], headers: true) do |row|
  break if n >= limit
  n += 1
  out = filter(LogStash::Event.new(row.to_h))
  out.each { |e| puts JSON.generate(e.to_hash) }
end
