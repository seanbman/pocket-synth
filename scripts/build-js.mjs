import * as esbuild from "esbuild"

const watch = process.argv.includes("--watch")

const options = {
  entryPoints: ["app/javascript/application.js"],
  bundle: true,
  outfile: "app/assets/builds/application.js",
  platform: "browser",
  format: "iife",
  target: ["safari15"],
  sourcemap: true,
  nodePaths: ["app/javascript"],
  logLevel: "info"
}

if (watch) {
  const context = await esbuild.context(options)
  await context.watch()
  console.log("CASSIO JavaScript watcher targeting Safari 15+")
} else {
  await esbuild.build(options)
}
