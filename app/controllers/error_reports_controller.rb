require "digest"
require "json"

class ErrorReportsController < ApplicationController
  skip_forgery_protection

  MAX_BYTES = 256.kilobytes
  MAX_REPORTS = 10
  RATE_LIMIT_PER_MINUTE = 40

  def create
    return head :payload_too_large if request.content_length.to_i > MAX_BYTES
    return head :too_many_requests unless within_rate_limit?

    raw_reports = request.request_parameters["reports"]
    reports = Array(raw_reports).first(MAX_REPORTS).filter_map { |raw| ErrorReportSanitizer.call(raw) }
    return head :bad_request if reports.empty?

    accepted = reports.filter_map do |report|
      Rails.logger.error(JSON.generate(event: "cassio_client_error", report: report))
      report["id"]
    end

    render json: { accepted: accepted }, status: :accepted
  rescue ActionDispatch::Http::Parameters::ParseError, JSON::ParserError, TypeError => error
    Rails.logger.warn("error report ingest rejected: #{error.class}: #{error.message}")
    head :bad_request
  rescue StandardError => error
    Rails.logger.error("error report ingest failed: #{error.class}: #{error.message}")
    head :internal_server_error
  end

  private

  def within_rate_limit?
    bucket = Time.current.utc.strftime("%Y%m%d%H%M")
    identity = Digest::SHA256.hexdigest("#{Rails.application.secret_key_base}:#{request.remote_ip}:#{bucket}")
    key = "cassio:error-report-rate:#{identity}"
    count = Rails.cache.read(key).to_i
    return false if count >= RATE_LIMIT_PER_MINUTE

    Rails.cache.write(key, count + 1, expires_in: 2.minutes)
    true
  end
end
