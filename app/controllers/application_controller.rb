class ApplicationController < ActionController::Base
  # CASSIO targets modern browsers and the native Rails import-map path.
  # Browser-specific legacy compatibility shims are intentionally not supported.

  # Changes to the importmap will invalidate the etag for HTML responses
  stale_when_importmap_changes
end
