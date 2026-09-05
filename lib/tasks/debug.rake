require "json"
require "fileutils"
require "open3"

module CassioDebugReport
  module_function

  REPO = "seanbman/pocket-synth"
  MAX_TIMELINE = 240

  def sessions_dir
    Rails.root.join("tmp", "debug_sessions")
  end

  def reports_dir
    Rails.root.join("tmp", "debug_reports")
  end

  def resolve_session(session)
    files = Dir[sessions_dir.join("*.jsonl")].sort_by { |path| File.mtime(path) }
    raise "No debug sessions found in #{sessions_dir}" if files.empty?

    return files.last if session.blank? || session == "latest"

    exact = sessions_dir.join("#{session}.jsonl").to_s
    return exact if File.exist?(exact)

    match = files.reverse.find { |path| File.basename(path, ".jsonl").start_with?(session.to_s) }
    match || raise("Debug session #{session.inspect} not found")
  end

  def load_events(path)
    File.readlines(path, chomp: true).filter_map do |line|
      JSON.parse(line)
    rescue JSON::ParserError
      nil
    end.sort_by { |e| [e["timestamp"].to_i, e["seq"].to_i] }
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

  def markdown(path, events)
    session_id = File.basename(path, ".jsonl")
    t0 = events.first&.dig("timestamp").to_i
    runs = events.map { |e| e["runId"] }.compact.uniq
    errors = events.select { |e| e["severity"] == "error" || e["channel"] == "error" || e["event"].to_s.end_with?(".throw") }
    interrupted = events.select { |e| e["event"] == "previous_run_interrupted" }
    audio = events.select { |e| e["channel"] == "audio" }
    timeline = events.select do |e|
      e["channel"] == "audio" || e["channel"] == "error" || e["channel"] == "lifecycle" ||
        e["event"].to_s.include?("construct") || e["event"].to_s.include?("persist")
    end.last(MAX_TIMELINE)

    peak_events = audio.filter_map do |event|
      output = state_for(event)["output"]
      next unless output.is_a?(Hash)
      [output["maxDelta"].to_f, output["clipped"].to_i, event]
    end.sort_by { |delta, clipped, _| [-clipped, -delta] }.first(20)

    lines = []
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
    lines << "- Runs: #{runs.map { |r| "`#{r}`" }.join(", ")}"
    lines << "- Events: #{events.length}"
    lines << "- Audio events: #{audio.length}"
    lines << "- Error events: #{errors.length}"
    lines << "- Interrupted previous runs observed: #{interrupted.length}"
    lines << "- Raw local log: `#{path}`"
    lines << ""

    unless errors.empty?
      lines << "## Errors"
      lines << ""
      errors.last(20).each do |event|
        lines << "- `#{event["event"]}` seq=#{event["seq"]} run=`#{event["runId"]}`: `#{JSON.generate(event["data"] || {}).slice(0, 1200)}`"
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
        lines << [delta, clipped, event["seq"], event["event"], state["screen"] || "-", source_ids(state)].join("\t")
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

  def write(session = nil)
    path = resolve_session(session)
    events = load_events(path)
    raise "No parseable events in #{path}" if events.empty?

    FileUtils.mkdir_p(reports_dir)
    out = reports_dir.join("#{File.basename(path, ".jsonl")}.md")
    File.write(out, markdown(path, events))
    out
  end
end

namespace :debug do
  desc "Generate a Markdown diagnostic report. Usage: bin/rails 'debug:report[latest]'"
  task :report, [:session] => :environment do |_task, args|
    puts CassioDebugReport.write(args[:session] || "latest")
  end

  desc "Generate latest diagnostic report and open a GitHub issue. Usage: bin/rails 'debug:github[latest]'"
  task :github, [:session] => :environment do |_task, args|
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
