import assert from "node:assert/strict"
import { fingerprintFor, sanitizeReportText } from "../../app/javascript/cassio/error_reporter.js"

const sanitized = sanitizeReportText("boom https://example.test/path?token=secret data:text/plain,PRIVATE")
assert.equal(sanitized.includes("token=secret"), false)
assert.equal(sanitized.includes("PRIVATE"), false)
assert.equal(sanitized.includes("https://example.test/path"), true)

const a = fingerprintFor({ kind: "startup", name: "TypeError", message: "bad thing at 12345", source: "/app.js" })
const b = fingerprintFor({ kind: "startup", name: "TypeError", message: "bad thing at 98765", source: "/app.js" })
const c = fingerprintFor({ kind: "runtime", name: "TypeError", message: "bad thing at 12345", source: "/app.js" })
assert.equal(a, b, "dynamic long numbers should not fragment one error fingerprint")
assert.notEqual(a, c, "different error kinds should remain distinct")
assert.match(a, /^[0-9a-f]{16}$/)

console.log("PASS: error reporter sanitizes URLs/data and produces stable fingerprints")
