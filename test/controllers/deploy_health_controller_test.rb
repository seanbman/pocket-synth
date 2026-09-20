require "test_helper"

class DeployHealthControllerTest < ActionDispatch::IntegrationTest
  test "reports the deployed application version without caching" do
    get deploy_health_path

    assert_response :success
    payload = JSON.parse(response.body)

    assert_equal "ok", payload.fetch("status")
    assert_equal Rails.root.join("DEPLOY_VERSION").read.strip, payload.fetch("deploy_version")
    assert payload.key?("revision")
    assert_includes response.headers.fetch("Cache-Control"), "no-store"
  end
end
