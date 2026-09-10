namespace :javascript do
  desc "Build the Safari 15-compatible JavaScript bundle"
  task :build do
    sh "npm run build"
  end
end

unless ENV["SKIP_JAVASCRIPT_BUILD"]
  Rake::Task["assets:precompile"].enhance([ "javascript:build" ]) if Rake::Task.task_defined?("assets:precompile")
  Rake::Task["test:prepare"].enhance([ "javascript:build" ]) if Rake::Task.task_defined?("test:prepare")
end
