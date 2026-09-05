class DebugLogsController < ApplicationController
  skip_forgery_protection

  MAX_EVENTS = 200
  MAX_BYTES = 512.kilobytes

  def create
    return head :not_found unless Rails.env.development? || Rails.env.test?

    if request.content_length.to_i > MAX_BYTES
      return head :payload_too_large
    end

    body = request.request_parameters
    events = Array(body["events"].presence || body["debug_log"].presence || body)
      .first(MAX_EVENTS)
      .select { |event| event.is_a?(Hash) }

    return head :bad_request if events.empty?

    session_id = safe_id(body["sessionId"] || events.first["sessionId"] || "unknown")
    dir = Rails.root.join("tmp", "debug_sessions")
    FileUtils.mkdir_p(dir)
    path = dir.join("#{session_id}.jsonl")

    File.open(path, "a") do |file|
      file.flock(File::LOCK_EX)
      events.each do |event|
        record = event.deep_dup
        record["serverReceivedAt"] = (Time.now.to_f * 1000).round
        record["remoteIp"] = request.remote_ip
        file.puts(JSON.generate(record))
      end
      file.flush
      file.flock(File::LOCK_UN)
    end

    head :no_content
  rescue JSON::GeneratorError, TypeError => error
    Rails.logger.warn("debug ingest rejected: #{error.class}: #{error.message}")
    head :unprocessable_entity
  rescue StandardError => error
    Rails.logger.error("debug ingest failed: #{error.class}: #{error.message}")
    head :internal_server_error
  end

  private

  def safe_id(value)
    value.to_s.gsub(/[^a-zA-Z0-9._-]/, "_").first(96).presence || "unknown"
  end
end
