require "fileutils"
require "json"

class DebugLogsController < ApplicationController
  skip_forgery_protection

  MAX_EVENTS = 200
  MAX_BYTES = 512.kilobytes

  def create
    return head :not_found unless Rails.env.development? || Rails.env.test?
    return head :payload_too_large if request.content_length.to_i > MAX_BYTES

    body = request.request_parameters
    raw_events = body["events"].presence || body["debug_log"].presence || body
    events = (raw_events.is_a?(Array) ? raw_events : [ raw_events ])
      .first(MAX_EVENTS)
      .select { |event| event.is_a?(Hash) }

    return head :bad_request if events.empty?

    directory = Rails.root.join("tmp", "debug_sessions")
    FileUtils.mkdir_p(directory)

    File.open(directory.join("events.jsonl"), "a") do |file|
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
end
