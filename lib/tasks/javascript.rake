namespace :javascript do
  desc "Install JavaScript dependencies and build the Safari 15-compatible bundle"
  task :build do
    sh "npm install --no-audit --no-fund"
    sh "npm run build"
  end
end

unless ENV["SKIP_JAVASCRIPT_BUILD"]
  Rake::Task["assets:precompile"].enhance([ "javascript:build" ]) if Rake::Task.task_defined?("assets:precompile")
  Rake::Task["test:prepare"].enhance([ "javascript:build" ]) if Rake::Task.task_defined?("test:prepare")
end
