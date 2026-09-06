require "active_support/core_ext/integer/time"

Rails.application.configure do
  config.enable_reloading = false
  config.eager_load = true
  config.consider_all_requests_local = false

  config.action_controller.perform_caching = true
  config.public_file_server.headers = { "cache-control" => "public, max-age=#{1.year.to_i}" }

  # CASSIO user projects/sounds are browser-persisted. Keep server-side runtime
  # services process-local on Heroku until the app actually introduces durable
  # server data and a shared database/queue backend.
  config.active_storage.service = :local
  config.cache_store = :memory_store
  config.active_job.queue_adapter = :async

  config.assume_ssl = true
  config.force_ssl = true
  config.ssl_options = { redirect: { exclude: ->(request) { request.path == "/up" } } }

  config.log_tags = [ :request_id ]
  config.logger = ActiveSupport::TaggedLogging.logger(STDOUT)
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")
  config.silence_healthcheck_path = "/up"
  config.active_support.report_deprecations = false

  config.i18n.fallbacks = true
  config.active_record.dump_schema_after_migration = false
  config.active_record.attributes_for_inspect = [ :id ]
end
