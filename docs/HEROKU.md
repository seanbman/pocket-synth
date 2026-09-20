# Heroku deployment

CASSIO is configured to run as a single Heroku web dyno with Puma.

## Buildpack policy

CASSIO uses the Rails 8.1 import-map JavaScript path and does not require a Node build step in production.

The live Heroku app should have one buildpack:

1. `heroku/ruby`

The former `heroku/nodejs` + esbuild Safari 15 compatibility path is superseded. Do not add a dummy `package.json` and do not restore the Node buildpack solely for legacy-browser support.

For an existing Heroku app:

```sh
heroku buildpacks:clear -a <app-name>
heroku buildpacks:set heroku/ruby -a <app-name>
```

## Deploy

1. Confirm `heroku/ruby` is the only buildpack.
2. Deploy the intended branch.
3. Heroku installs Ruby dependencies and precompiles Rails assets.
4. Heroku starts `web: bundle exec puma -C config/puma.rb`.
5. Verify `https://<app>.herokuapp.com/up` returns 200, then open the root app.

## Browser policy

CASSIO targets modern browsers capable of the current Rails import-map/module path and the Web APIs required by the full synth/sampler experience. Legacy Safari/iOS compatibility is not a product requirement. We prefer the full feature set over transpilation, shims, or degraded modes for obsolete browsers.

## Current persistence model

CASSIO projects and user sounds are stored in the browser. The Rails app currently has no application models requiring durable server persistence. Production therefore uses process-local cache/jobs/cable and an ephemeral SQLite path under `/tmp` so a single dyno can boot cleanly without provisioning unnecessary infrastructure.

Do not use the current SQLite production configuration for future server-owned user data. When server persistence is introduced, migrate production Active Record to Heroku Postgres and shared queue/cable infrastructure before scaling beyond one web dyno.
