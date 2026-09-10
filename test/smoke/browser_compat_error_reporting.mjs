#!/usr/bin/env node
import assert from "node:assert/strict"

const ROOT = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const base = new URL(ROOT)
const oldSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1"

const page = await fetch(base, { headers: { Accept: "text/html", "User-Agent": oldSafari } })
assert.equal(page.status, 200, `older Safari must reach CASSIO instead of Rails 406; got ${page.status}`)
assert.match(await page.text(), /CASSIO/)

const id = `smoke-${Date.now()}`
const endpoint = new URL("/error_reports", base)
const ingest = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ reports: [{
    id,
    createdAt: Date.now(),
    build: "smoke",
    fingerprint: "0123456789abcdef",
    kind: "smoke",
    name: "SmokeError",
    message: "synthetic compatibility smoke error",
    route: "/",
    userAgent: oldSafari,
    viewport: { width: 390, height: 844, dpr: 2 },
    capabilities: { webAudio: true, indexedDb: true },
    breadcrumbs: [{ at: Date.now(), event: "smoke", detail: "ci" }]
  }] })
})
assert.equal(ingest.status, 202)
const body = await ingest.json()
assert.deepEqual(body.accepted, [id])

const invalid = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ reports: [{ message: "missing identity" }] })
})
assert.equal(invalid.status, 400)

console.log("PASS: older Safari reaches CASSIO and error-report ingest acknowledges valid UUIDs")
