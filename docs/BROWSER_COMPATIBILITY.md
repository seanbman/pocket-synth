# Browser Compatibility

## Supported baseline

CASSIO's JavaScript delivery target is **Safari 15 / iOS 15 and newer**. This baseline is intended to include the iPhone 7 generation, whose final iOS line is iOS 15.

Browser admission is capability-driven. Rails must not reject an older browser by user-agent before the application has a chance to load and report a real missing capability.

## JavaScript delivery

CASSIO source remains split into ES modules under `app/javascript`, but production and development browsers receive one transpiled bundle:

```text
app/javascript/application.js
        |
        v
esbuild -- target safari15
        |
        v
app/assets/builds/application.js
        |
        v
Rails / Propshaft
```

The runtime no longer depends on native JavaScript Import Maps. Stimulus controllers are registered statically in `app/javascript/controllers/index.js` so their discovery also does not require import-map support.

The application layout loads the compiled bundle with a normal deferred script tag. A classic-script timeout remains outside the bundle so an early JavaScript bootstrap failure cannot leave the user on an endless `POWER ON` screen.

## Commands

Install and build once:

```sh
npm install
npm run build
```

Watch JavaScript during development:

```sh
npm run build:watch
```

`bin/setup` installs dependencies and builds once. `bin/dev` starts the Rails server, Tailwind watcher, and JavaScript watcher through `Procfile.dev`.

## Deployment

`javascript:build` is attached to Rails `assets:precompile`, but production must provide Node/npm before the Ruby asset phase runs. On Heroku, the live app therefore requires buildpacks in this order:

1. `heroku/nodejs`
2. `heroku/ruby`

The Node buildpack installs the pinned Node runtime and JavaScript dependencies; the Ruby buildpack then runs Rails asset precompilation and `npm run build`. `app.json` declares this order for newly-created/review apps only and does not alter an existing Heroku app's configured buildpacks.

Docker installs Node/npm in the throw-away build stage, runs the same asset precompile path, and removes `node_modules` before producing the runtime image.

## Verification

CI runs on both `main` and `dev`, installs the JavaScript dependencies, runs the Safari 15-targeted esbuild compilation, then executes the existing unit and browser smoke suites.

The build target verifies syntax/module delivery compatibility; final acceptance for the original incident still requires loading the deployed `dev` build on the affected iPhone 7/iOS 15 device and exercising audio startup, pads/keys, recording, and persistence. Browser APIs are capability-checked separately from syntax transpilation.

## Legacy importmap files

`config/importmap.rb` and the `importmap-rails` gem are temporarily retained to keep this migration narrow. They are no longer part of the browser boot path and can be removed in a later dependency-cleanup change after the Safari 15 bundle has been device-verified.
