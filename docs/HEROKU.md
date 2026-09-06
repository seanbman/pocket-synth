# Heroku deployment

CASSIO is configured to run as a single Heroku web dyno with Puma.

## Deploy

1. Create a Heroku app from this GitHub repository or connect the repo in the Heroku dashboard.
2. Use the Ruby buildpack. `app.json` targets `heroku-24` and the repository pins Ruby 3.4.10 via `.ruby-version`.
3. Deploy `main`. Heroku will precompile Rails assets and start `web: bundle exec puma -C config/puma.rb`.
4. Verify `https://<app>.herokuapp.com/up` returns 200, then open the root app.

## Current persistence model

CASSIO projects and user sounds are stored in the browser. The Rails app currently has no application models requiring durable server persistence. Production therefore uses process-local cache/jobs/cable and an ephemeral SQLite path under `/tmp` so a single dyno can boot cleanly without provisioning unnecessary infrastructure.

Do not use the current SQLite production configuration for future server-owned user data. When server persistence is introduced, migrate production Active Record to Heroku Postgres and shared queue/cable infrastructure before scaling beyond one web dyno.
