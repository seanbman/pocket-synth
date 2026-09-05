require "json"
require "fileutils"
require "open3"

module CassioDebugReport
  module_function

  REPO = "seanbman/pocket-synth"
  MAX_TIMELINE = 240

  def log_path
    Rails.root.join("tmp", "debug_sessions", "events.jsonl")
  end

  def reports_dir
    Rails.root.join("tmp", "debug_reports")
  end

  def load_events
    raise "No debug event journal found at #{log_path}" unless File.exist?(log_path)

    File.readlines(log_path, chomp: true).filter_map do |line|
      JSON.parse(line)
    rescue JSON::ParserError
      nil
    end.sort_by { |event| [ event["timestamp"].to_i, event["seq"].to_i ] }
  end

  def resolve_session(events, requested)
    session_ids = events.filter_map { |event| event["sessionId"].presence }.uniq
    raise "No session IDs found in #{log_path}" if session_ids.empty?

    if requested.blank? || requested == "latest"
      latest = events.reverse.find { |event| event["sessionId"].present? }
      return latest["sessionId"]
    end

    exact = session_ids.find { |session_id| session_id == requested }
    return exact if exact

    matches = session_ids.select { |session_id| session_id.start_with?(requested.to_s) }
    return matches.first if matches.one?

    raise "Debug session #{requested.inspect} not found or ambiguous"
  end

  def safe_report_id(session_id)
    session_id.to_s.gsub(/[^a-zA-Z0-9._-]/, "_").first(96).presence || "unknown"
  end

  def git_value(*args)
    out, status = Open3.capture2("git", *args, chdir: Rails.root.to_s)
    status.success? ? out.strip : "unknown"
  rescue StandardError
    "unknown"
  end

  def state_for(event)
    data = event["data"].is_a?(Hash) ? event["data"] : {}
    state = data["state"]
    state = data["audio"] if !state.is_a?(Hash) && data["audio"].is_a?(Hash)
    state.is_a?(Hash) ? state : {}
  end

  def source_ids(state)
    Array(state.dig("loop", "sources")).map do |source|
      "T#{source["trackId"]}:#{source["nodeId"]}"
    end.join(",")
  end

  def compact_row(event, t0)
    state = state_for(event)
    transport = state["transport"] || {}
    context = state["context"] || {}
    step = state["stepSeq"] || {}
    output = state["output"] || {}
    delta = event["timestamp"].to_i - t0
    play = transport["playing"] ? "P" : "-"
    rec = transport["recording"] ? "R" : "-"
    sources = source_ids(state)
    sources = "-" if sources.empty?
    seq_state = step["running"] ? "#{step["mode"] || "?"}:on" : "off"
    out = if output.empty?
      "-"
    else
      "pk=#{output["peak"]} rms=#{output["rms"]} d=#{output["maxDelta"]} clip=#{output["clipped"]}"
    end

    [
      delta,
      event["seq"],
      event["channel"],
      event["event"],
      state["screen"] || "-",
      state["playContext"] || "-",
      "#{play}#{rec}",
      context["state"] || "-",
      context["currentTime"] || "-",
      sources,
      seq_state,
      out
    ]
  end

  def markdown(session_id, events)
    t0 = events.first&.dig("timestamp").to_i
    runs = events.map { |event| event["runId"] }.compact.uniq
    errors = events.select do |event|
      event["severity"] == "error" || event["channel"] == "error" || event["event"].to_s.end_with?(".throw")
    end
    interrupted = events.select { |event| event["event"] == "previous_run_interrupted" }
    audio = events.select { |event| event["channel"] == "audio" }
    timeline = events.select do |event|
      event["channel"] == "audio" || event["channel"] == "error" || event["channel"] == "lifecycle" ||
        event["event"].to_s.include?("construct") || event["event"].to_s.include?("persist")
    end.last(MAX_TIMELINE)

    peak_events = audio.filter_map do |event|
      output = state_for(event)["output"]
      next unless output.is_a?(Hash)

      [ output["maxDelta"].to_f, output["clipped"].to_i, event ]
    end.sort_by { |delta, clipped, _event| [ -clipped, -delta ] }.first(20)

    lines = [ ]
    lines << "# CASSIO diagnostic session #{session_id}"
    lines << ""
    lines << "Generated from persisted browser telemetry. This report is evidence only; it does not infer a root cause."
    lines << ""
    lines << "## Build"
    lines << ""
    lines << "- Repository: `#{REPO}`"
    lines << "- Branch: `#{git_value("branch", "--show-current")}`"
    lines << "- Commit: `#{git_value("rev-parse", "HEAD")}`"
    lines << "- Session: `#{session_id}`"
    lines << "- Runs: #{runs.map { |run_id| "`#{run_id}`" }.join(", ")}"
    lines << "- Events: #{events.length}"
    lines << "- Audio events: #{audio.length}"
    lines << "- Error events: #{errors.length}"
    lines << "- Interrupted previous runs observed: #{interrupted.length}"
    lines << "- Raw local event journal: `#{log_path}`"
    lines << ""

    unless errors.empty?
      lines << "## Errors"
      lines << ""
      errors.last(20).each do |event|
        data = JSON.generate(event["data"] || {}).slice(0, 1200)
        lines << "- `#{event["event"]}` seq=#{event["seq"]} run=`#{event["runId"]}`: `#{data}`"
      end
      lines << ""
    end

    lines << "## Audio transition timeline"
    lines << ""
    lines << "Columns: elapsed ms, seq, channel, event, screen, play context, transport, AudioContext state/time, active PCM source IDs, step sequencer, analyser."
    lines << ""
    lines << "```text"
    lines << "ms\tseq\tchannel\tevent\tscreen\tcontext\tTR\tctx\taudioTime\tpcmSources\tstepSeq\toutput"
    timeline.each { |event| lines << compact_row(event, t0).join("\t") }
    lines << "```"
    lines << ""

    lines << "## Highest observed output discontinuity/clipping samples"
    lines << ""
    if peak_events.empty?
      lines << "No analyser samples were captured."
    else
      lines << "```text"
      lines << "maxDelta\tclipped\tseq\tevent\tscreen\tpcmSources"
      peak_events.each do |delta, clipped, event|
        state = state_for(event)
        row = [ delta, clipped, event["seq"], event["event"], state["screen"] || "-", source_ids(state) ]
        lines << row.join("\t")
      end
      lines << "```"
    end
    lines << ""

    lines << "## Reproduction notes"
    lines << ""
    lines << "Add the exact button/window sequence and the moment the audible glitch was heard. The timeline above can then be matched to Web Audio time and source-node churn without reconstructing state from memory."
    lines << ""
    lines.join("\n")
  end

  def write(requested = nil)
    all_events = load_events
    session_id = resolve_session(all_events, requested)
    events = all_events.select { |event| event["sessionId"] == session_id }
    raise "No events found for session #{session_id}" if events.empty?

    FileUtils.mkdir_p(reports_dir)
    out = reports_dir.join("#{safe_report_id(session_id)}.md")
    File.write(out, markdown(session_id, events))
    out
  end
end

namespace :debug do
  desc "Generate a Markdown diagnostic report. Usage: bin/rails 'debug:report[latest]'"
  task :report, [ :session ] => :environment do |_task, args|
    puts CassioDebugReport.write(args[:session] || "latest")
  end

  desc "Generate latest diagnostic report and open a GitHub issue. Usage: bin/rails 'debug:github[latest]'"
  task :github, [ :session ] => :environment do |_task, args|
    report = CassioDebugReport.write(args[:session] || "latest")
    session_id = File.basename(report, ".md")
    title = "CASSIO audio diagnostic #{session_id}"
    ok = system(
      "gh", "issue", "create",
      "--repo", CassioDebugReport::REPO,
      "--title", title,
      "--body-file", report.to_s,
      chdir: Rails.root.to_s
    )
    abort "GitHub issue creation failed. Is `gh auth status` valid?" unless ok
  end
end
