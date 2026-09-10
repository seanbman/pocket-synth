class ApplicationController < ActionController::Base
  # Browser compatibility is capability-driven in CASSIO. Do not reject older
  # browsers before the client can report which required APIs are actually missing.

  # Changes to the importmap will invalidate the etag for HTML responses
  stale_when_importmap_changes
end
