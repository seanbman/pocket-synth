import assert from "node:assert/strict"
import fs from "node:fs"

const read = (path) => fs.readFileSync(path, "utf8")

const buildScript = read("scripts/build-js.mjs")
assert.match(buildScript, /target:\s*\["safari15"\]/, "esbuild must target Safari 15")
assert.match(buildScript, /format:\s*"iife"/, "bundle must not require module-script support")

const layout = read("app/views/layouts/application.html.erb")
assert.doesNotMatch(layout, /javascript_importmap_tags/, "layout must not depend on import maps")
assert.match(layout, /javascript_include_tag\s+"application"/, "layout must load the compiled application bundle")

const controllers = read("app/javascript/controllers/index.js")
assert.doesNotMatch(controllers, /stimulus-loading|eagerLoadControllersFrom/, "controller discovery must not depend on import maps")
assert.match(controllers, /application\.register\("cassio"/, "CASSIO controller must be statically registered")
assert.match(controllers, /application\.register\("manual"/, "manual controller must be statically registered")

const bundlePath = "app/assets/builds/application.js"
assert.ok(fs.existsSync(bundlePath), "Safari 15 bundle must exist after npm run build")
const bundle = read(bundlePath)
assert.ok(bundle.length > 1_000, "compiled application bundle is unexpectedly small")
assert.doesNotMatch(bundle, /^\s*(?:import|export)\s/m, "compiled application must be self-contained, not an ESM import graph")

console.log("Safari 15 bundle contract verified")
