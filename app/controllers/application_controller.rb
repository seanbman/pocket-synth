class ApplicationController < ActionController::Base
  # Browser compatibility is capability-driven in CASSIO. Do not reject older
  # browsers before the client can report which required APIs are actually missing.
end
