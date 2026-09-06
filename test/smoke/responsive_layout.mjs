#!/usr/bin/env node
/**
 * Regression for the 2026-09-05 portrait-layout user-test finding.
 * The full CASSIO chassis, keyboard, and all six main-menu rows must remain
 * contained on representative phone portrait viewports.
 */
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const PORT = 9342
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-responsive-layout")
const chromeBin = process.env.CHROME_BIN || "google-chrome"
const chrome = spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage",
  "--remote-debugging-address=127.0.0.1",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"
], { stdio: ["ignore", "ignore", "pipe"] })

let chromeErr = ""
chrome.stderr.on("data", (chunk) => { chromeErr += chunk.toString() })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const deadline = async (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
])

async function waitForChrome() {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < 12000) {
    if (chrome.exitCode != null) {
      throw new Error(`Chrome exited ${chrome.exitCode}: ${chromeErr.slice(-3000)}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (response.ok) return await response.json()
      lastError = new Error(`Chrome debug endpoint HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await sleep(250)
  }
  throw new Error(`Chrome debug endpoint unavailable: ${lastError?.message || "unknown"}\n${chromeErr.slice(-3000)}`)
}

let failed = false
const pass = (msg) => console.log(`PASS: ${msg}`)
const fail = (msg) => { failed = true; console.error(`FAIL: ${msg}`) }
const inside = (inner, outer, tolerance = 1) => (
  inner.left >= outer.left - tolerance &&
  inner.top >= outer.top - tolerance &&
  inner.right <= outer.right + tolerance &&
  inner.bottom <= outer.bottom + tolerance
)

try {
  const targets = await waitForChrome()
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("chrome-extension:")) || targets[0]
  if (!page?.webSocketDebuggerUrl) throw new Error("No Chrome page target")

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await deadline(new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject }), 5000, "CDP websocket")
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (!msg.id || !pending.has(msg.id)) return
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
  const send = (method, params = {}) => deadline(new Promise((resolve) => {
    const callId = ++id
    pending.set(callId, resolve)
    ws.send(JSON.stringify({ id: callId, method, params }))
  }), 6000, method)
  const evalJs = async (expression) => {
    const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (reply.result?.exceptionDetails) {
      throw new Error(reply.result.exceptionDetails.exception?.description || reply.result.exceptionDetails.text)
    }
    return reply.result?.result?.value
  }

  await send("Runtime.enable")
  await send("Page.enable")

  const viewports = [
    { width: 320, height: 568, label: "small-phone" },
    { width: 375, height: 667, label: "compact-phone" },
    { width: 390, height: 844, label: "user-test-target" },
    { width: 430, height: 932, label: "large-phone" }
  ]

  await send("Emulation.setDeviceMetricsOverride", {
    width: viewports[0].width,
    height: viewports[0].height,
    deviceScaleFactor: 2,
    mobile: true
  })
  await send("Page.navigate", { url: URL })
  await sleep(7000)

  for (const viewport of viewports) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 2,
      mobile: true
    })
    await sleep(220)

    const snapshot = await evalJs(`(async () => {
      const root = document.querySelector('[data-controller~="cassio"]')
      const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
      if (!root || !app) return { fatal: 'no app' }
      app.screen = 'menu'
      app.menuIndex = 5
      app.render()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      const rect = (el) => {
        const r = el?.getBoundingClientRect()
        return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null
      }
      const chassis = root.querySelector('.chassis')
      const keyboard = root.querySelector('.keyboard')
      const mid = root.querySelector('.mid-row')
      const menu = root.querySelector('.menu-screen')
      const body = menu?.querySelector('.menu-body')
      const soft = menu?.querySelector('.lcd-soft')
      const items = [...(menu?.querySelectorAll('.menu-item') || [])]
      return {
        fatal: (!chassis || !keyboard || !mid || !menu || !body || !soft) ? 'missing layout node' : null,
        inner: { width: innerWidth, height: innerHeight },
        doc: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        chassis: rect(chassis),
        keyboard: rect(keyboard),
        mid: rect(mid),
        menu: rect(menu),
        body: rect(body),
        soft: rect(soft),
        items: items.map((el) => ({ text: el.textContent.trim(), rect: rect(el) })),
        dvh: CSS.supports('height', '1dvh')
      }
    })()`)

    if (snapshot?.fatal) throw new Error(`${viewport.label}: ${snapshot.fatal}`)
    const frame = { left: 0, top: 0, right: snapshot.inner.width, bottom: snapshot.inner.height }
    const prefix = `${viewport.label} ${viewport.width}x${viewport.height}`

    if (!inside(snapshot.chassis, frame)) fail(`${prefix}: chassis escaped viewport ${JSON.stringify(snapshot.chassis)}`)
    else pass(`${prefix}: chassis contained`)

    if (!inside(snapshot.keyboard, snapshot.chassis)) fail(`${prefix}: keyboard escaped chassis ${JSON.stringify(snapshot.keyboard)}`)
    else pass(`${prefix}: keyboard contained`)

    if (snapshot.mid.bottom > snapshot.keyboard.top + 1) fail(`${prefix}: mid controls overlap keyboard`)
    else pass(`${prefix}: controls clear keyboard`)

    if (snapshot.doc.width > snapshot.inner.width + 1 || snapshot.doc.height > snapshot.inner.height + 1) {
      fail(`${prefix}: document overflow ${snapshot.doc.width}x${snapshot.doc.height}`)
    } else {
      pass(`${prefix}: no document overflow`)
    }

    if (snapshot.items.length !== 6) {
      fail(`${prefix}: expected 6 menu rows, got ${snapshot.items.length}`)
      continue
    }

    const expected = ["PLAY", "LOOP", "SOUND", "MIX", "PROJECT", "SETTINGS"]
    const labels = snapshot.items.map((item) => item.text)
    if (labels.join("|") !== expected.join("|")) fail(`${prefix}: canonical menu order changed: ${labels.join(", ")}`)

    const badItem = snapshot.items.find((item) => (
      !item.rect || item.rect.height < 8 ||
      item.rect.top < snapshot.body.top - 1 ||
      item.rect.bottom > snapshot.body.bottom + 1 ||
      item.rect.bottom > snapshot.soft.top + 1
    ))
    if (badItem) fail(`${prefix}: menu row collides/clips at ${badItem.text} ${JSON.stringify(badItem.rect)}`)
    else pass(`${prefix}: all six menu rows clear lcd-soft`)

    const settings = snapshot.items[5]?.rect
    if (!settings || settings.height < 8 || settings.bottom > snapshot.soft.top + 1) {
      fail(`${prefix}: SETTINGS is not fully reachable`)
    } else {
      pass(`${prefix}: SETTINGS remains visible/selectable`)
    }
  }

  ws.close()
} catch (error) {
  fail(error?.stack || String(error))
} finally {
  chrome.kill()
}

process.exit(failed ? 1 : 0)
