#!/usr/bin/env node
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(resolve(here, "../../app/javascript/cassio/app.js"), "utf8")
const loopSrc = readFileSync(resolve(here, "../../app/javascript/cassio/loop_controller.js"), "utf8")

assert.match(appSrc, /if \(!this\._loopUiRaf\)/, "transport beat refresh must stay guarded")
assert.match(loopSrc, /a\._loopUiRaf = requestAnimationFrame\(frame\)/, "playback UI loop must own the guarded rAF slot")
assert.ok(loopSrc.includes('querySelectorAll(".loop-ph")'), "LOOP playhead should update in place")
assert.ok(loopSrc.includes('querySelector(".loop-tmeta")'), "LOOP transport label should update in place")

const syncStart = loopSrc.indexOf("#syncPlaybackUi()")
const syncEnd = loopSrc.indexOf("\n  openHome()", syncStart)
assert.ok(syncStart >= 0 && syncEnd > syncStart, "playback UI sync method should be present")
const syncBody = loopSrc.slice(syncStart, syncEnd)
assert.doesNotMatch(syncBody, /\.render\(/, "playback UI sync must not rebuild the LCD DOM")

console.log("PASS: playback UI updates in place instead of rebuilding the LCD on transport beats")
