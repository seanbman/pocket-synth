require "uri"

class ErrorReportSanitizer
  MAX_MESSAGE = 500
  MAX_STACK = 4_000
  MAX_USER_AGENT = 500
  MAX_BREADCRUMBS = 24

  class << self
    def call(raw)
      data = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw
      return unless data.is_a?(Hash)

      id = text(data["id"], 120)
      fingerprint = text(data["fingerprint"], 80)
      return if id.blank? || fingerprint.blank?

      {
        "id" => id,
        "createdAt" => integer(data["createdAt"]),
        "build" => text(data["build"], 80),
        "fingerprint" => fingerprint,
        "kind" => text(data["kind"], 80),
        "name" => text(data["name"], 120),
        "message" => text(data["message"], MAX_MESSAGE),
        "stack" => text(data["stack"], MAX_STACK),
        "source" => path_only(data["source"]),
        "line" => integer(data["line"]),
        "column" => integer(data["column"]),
        "route" => path_only(data["route"]),
        "userAgent" => text(data["userAgent"], MAX_USER_AGENT),
        "language" => text(data["language"], 40),
        "viewport" => numeric_hash(data["viewport"], %w[width height dpr]),
        "capabilities" => boolean_hash(data["capabilities"]),
        "breadcrumbs" => breadcrumbs(data["breadcrumbs"]),
        "retryCount" => integer(data["retryCount"])
      }.compact
    end

    private

    def text(value, limit)
      return if value.nil?

      value.to_s
        .delete("\0")
        .gsub(/data:[^\s]+/i, "<data-url>")
        .gsub(/blob:https?:\/\/[^\s)]+/i, "<blob-url>")
        .gsub(%r{https?://[^\s)]+}i) { |url| safe_url(url) }
        .gsub(/[A-Za-z0-9+\/]{256,}={0,2}/, "<binary>")
        .strip
        .slice(0, limit)
    end

    def safe_url(raw)
      uri = URI.parse(raw)
      return "<url>" unless uri.is_a?(URI::HTTP)

      "#{uri.scheme}://#{uri.host}#{uri.path}"
    rescue URI::InvalidURIError
      "<url>"
    end

    def path_only(value)
      raw = text(value, 300)
      return if raw.blank?
      return raw if raw.start_with?("/") && !raw.start_with?("//")

      uri = URI.parse(raw)
      uri.path.presence || "<path>"
    rescue URI::InvalidURIError
      raw.slice(0, 300)
    end

    def integer(value)
      return if value.nil? || value == ""

      Integer(value, exception: false)
    end

    def numeric_hash(value, keys)
      return {} unless value.is_a?(Hash)

      keys.to_h do |key|
        number = Float(value[key], exception: false)
        [key, number&.finite? ? number : nil]
      end.compact
    end

    def boolean_hash(value)
      return {} unless value.is_a?(Hash)

      value.each_with_object({}) do |(key, item), out|
        next unless key.to_s.match?(/\A[a-zA-Z][a-zA-Z0-9_]{0,39}\z/)
        next unless item == true || item == false

        out[key.to_s] = item
      end.first(24).to_h
    end

    def breadcrumbs(value)
      Array(value).last(MAX_BREADCRUMBS).filter_map do |item|
        next unless item.is_a?(Hash)

        {
          "at" => integer(item["at"]),
          "event" => text(item["event"], 80),
          "detail" => text(item["detail"], 160)
        }.compact
      end
    end
  end
end
