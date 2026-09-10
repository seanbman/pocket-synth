# Heroku deployment

CASSIO is configured to run as a single Heroku web dyno with Puma.

## Required buildpack order

The live Heroku app must have these buildpacks in this exact order:

1. `heroku/nodejs`
2. `heroku/ruby`

The Node buildpack installs the JavaScript dependencies and the pinned Node runtime from `package.json`. The Ruby buildpack then runs Rails asset precompilation, whose `javascript:build` task invokes the already-installed `npm run build` to produce the Safari 15-compatible bundle.

`app.json` declares this order for newly-created apps and review apps, but it does **not** reconfigure an existing Heroku app. For an existing app, configure the buildpacks in the Heroku dashboard under **Settings -> Buildpacks** or with the Heroku CLI.

If the dashboard currently shows only `heroku/ruby`, remove it, add `heroku/nodejs`, then add `heroku/ruby` again so Node is first.

CLI equivalent:

```sh
heroku buildpacks:clear -a <app-name>
heroku buildpacks:add --index 1 heroku/nodejs -a <app-name>
heroku buildpacks:add --index 2 heroku/ruby -a <app-name>
```

## Deploy

1. Confirm the buildpack order above.
2. Deploy the intended branch.
3. Heroku installs Node dependencies first, then Ruby dependencies.
4. Rails asset precompilation runs `npm run build` and produces the Safari 15-compatible JavaScript bundle.
5. Heroku starts `web: bundle exec puma -C config/puma.rb`.
6. Verify `https://<app>.herokuapp.com/up` returns 200, then open the root app.

The repository pins Node in `package.json` and Ruby in `.ruby-version` so production builds are reproducible.

## Current persistence model

CASSIO projects and user sounds are stored in the browser. The Rails app currently has no application models requiring durable server persistence. Production therefore uses process-local cache/jobs/cable and an ephemeral SQLite path under `/tmp` so a single dyno can boot cleanly without provisioning unnecessary infrastructure.

Do not use the current SQLite production configuration for future server-owned user data. When server persistence is introduced, migrate production Active Record to Heroku Postgres and shared queue/cable infrastructure before scaling beyond one web dyno.
