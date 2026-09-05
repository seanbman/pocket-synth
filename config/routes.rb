Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
  get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker

  post "debug_ingest" => "debug_logs#create"

  root "instrument#show"
end
