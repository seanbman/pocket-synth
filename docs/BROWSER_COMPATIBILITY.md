# Browser support policy

## Current policy

CASSIO targets modern browsers and prioritizes the complete synth, sampler, loop, sequencer, project, and audio feature set.

The application uses Rails 8.1 Import Maps and native ES modules. We do not transpile the runtime to Safari 15, maintain an esbuild IIFE fallback, or carry a Node production build solely for obsolete-browser compatibility.

## Superseded legacy path

The Safari 15 compatibility work introduced:

- an esbuild IIFE bundle targeting `safari15`
- static Stimulus registration for the bundle
- a classic-script startup fallback
- Node/npm requirements in development, CI, Docker, and Heroku
- Safari 15 bundle contract tests

That path was created to support an older iPhone/iOS Safari report and is now intentionally superseded.

## Feature-first rule

Do not disable, rewrite, or constrain modern CASSIO functionality merely to preserve support for obsolete browsers. When a required Web API is unavailable, unsupported browsers may fail the capability requirement rather than forcing the main application into a degraded compatibility architecture.

Error reporting and startup diagnostics remain useful independently of legacy-browser support.
