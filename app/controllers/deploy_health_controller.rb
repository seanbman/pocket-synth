class DeployHealthController < ApplicationController
  DEPLOY_VERSION_PATH = Rails.root.join("DEPLOY_VERSION")

  def show
    response.set_header("Cache-Control", "no-store")

    render json: {
      status: "ok",
      deploy_version: DEPLOY_VERSION_PATH.read.strip,
      revision: runtime_revision
    }
  end

  private

  def runtime_revision
    ENV["HEROKU_SLUG_COMMIT"].presence ||
      ENV["SOURCE_VERSION"].presence ||
      "unknown"
  end
end
