#!/usr/bin/env node
/**
 * Regression for the in-app CASSIO manual.
 * Verifies the chassis trigger, full-screen modal, linked index, search filtering,
 * keyboard isolation, and close behavior on a representative phone viewport.
 */
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const PORT = 9347
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-manual")
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
  while (Date.now() - started < 12000) {
    if (chrome.exitCode != null) throw new Error(`Chrome exited ${chrome.exitCode}: ${chromeErr.slice(-2000)}`)
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (response.ok) return await response.json()
    } catch (_) { /* retry */ }
    await sleep(250)
  }
  throw new Error(`Chrome debug endpoint unavailable\n${chromeErr.slice(-2000)}`)
}

let failed = false
const pass = (msg) => console.log(`PASS: ${msg}`)
const fail = (msg) => { failed = true; console.error(`FAIL: ${msg}`) }

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
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description || reply.result.exceptionDetails.text)
    return reply.result?.result?.value
  }

  await send("Runtime.enable")
  await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send("Page.navigate", { url: URL })
  await sleep(7000)

  const opened = await evalJs(`(async () => {
    const trigger = document.querySelector('[data-manual-trigger]')
    const modal = document.querySelector('[data-manual-target="dialog"]')
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    if (!trigger || !modal || !app) return { fatal: 'missing trigger/modal/app' }
    const tr = trigger.getBoundingClientRect()
    const chassis = root.querySelector('.chassis').getBoundingClientRect()
    trigger.click()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const mr = modal.getBoundingClientRect()
    return {
      triggerText: trigger.textContent.trim(),
      triggerInside: tr.left >= chassis.left - 1 && tr.right <= chassis.right + 1 && tr.top >= chassis.top - 1 && tr.bottom <= chassis.bottom + 1,
      hidden: modal.hidden,
      rect: { left: mr.left, top: mr.top, right: mr.right, bottom: mr.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      sections: modal.querySelectorAll('[data-manual-target="section"]').length,
      links: modal.querySelectorAll('[data-manual-link]').length,
      searchFocused: document.activeElement === modal.querySelector('[data-manual-target="search"]'),
      heldBefore: app.heldKeys?.size ?? -1
    }
  })()`)

  if (opened?.fatal) throw new Error(opened.fatal)
  if (opened.triggerText !== "MANUAL") fail(`trigger label is ${opened.triggerText}`); else pass("MANUAL trigger label")
  if (!opened.triggerInside) fail("MANUAL trigger escapes chassis header"); else pass("MANUAL trigger contained in chassis")
  if (opened.hidden) fail("manual did not open"); else pass("manual opens")
  const full = opened.rect.left <= 1 && opened.rect.top <= 1 && opened.rect.right >= opened.viewport.width - 1 && opened.rect.bottom >= opened.viewport.height - 1
  if (!full) fail(`manual not full-screen: ${JSON.stringify(opened.rect)}`); else pass("manual covers full viewport")
  if (opened.sections !== 18 || opened.links !== 18) fail(`expected 18 indexed sections, got ${opened.sections}/${opened.links}`); else pass("18-section linked index present")
  if (!opened.searchFocused) fail("search did not receive focus on open"); else pass("search focused on open")

  const filtered = await evalJs(`(() => {
    const modal = document.querySelector('[data-manual-target="dialog"]')
    const search = modal.querySelector('[data-manual-target="search"]')
    search.value = 'microphone'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    const visibleSections = [...modal.querySelectorAll('[data-manual-target="section"]')].filter((el) => !el.hidden)
    const visibleLinks = [...modal.querySelectorAll('[data-manual-link]')].filter((el) => !el.hidden)
    return {
      visibleSections: visibleSections.length,
      visibleLinks: visibleLinks.length,
      text: visibleSections.map((el) => el.textContent).join(' ').toLowerCase(),
      count: modal.querySelector('[data-manual-target="count"]').textContent.trim()
    }
  })()`)
  if (!(filtered.visibleSections > 0 && filtered.visibleSections < 18)) fail(`search filtering count invalid: ${filtered.visibleSections}`); else pass("search filters manual sections")
  if (filtered.visibleLinks !== filtered.visibleSections) fail(`index/search mismatch: ${filtered.visibleLinks}/${filtered.visibleSections}`); else pass("linked index follows search results")
  if (!filtered.text.includes("microphone")) fail("visible search results do not contain query"); else pass("search results contain query")

  const isolated = await evalJs(`(() => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    const search = document.querySelector('[data-manual-target="search"]')
    const before = app.heldKeys?.size ?? -1
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', bubbles: true, cancelable: true }))
    search.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', code: 'KeyZ', bubbles: true, cancelable: true }))
    return { before, after: app.heldKeys?.size ?? -1 }
  })()`)
  if (isolated.after !== isolated.before) fail(`manual typing leaked to synth keyboard: ${isolated.before} -> ${isolated.after}`); else pass("manual typing isolated from synth keyboard")

  const jumped = await evalJs(`(async () => {
    const modal = document.querySelector('[data-manual-target="dialog"]')
    modal.querySelector('[data-action="manual#clearSearch"]').click()
    const link = modal.querySelector('[data-manual-link="manual-project"]')
    link.click()
    await new Promise((resolve) => setTimeout(resolve, 450))
    return {
      activeId: document.activeElement?.id,
      scrollTop: modal.querySelector('.manual-content').scrollTop
    }
  })()`)
  if (jumped.activeId !== "manual-project" || jumped.scrollTop <= 0) fail(`linked index did not jump: ${JSON.stringify(jumped)}`); else pass("linked index jumps to section")

  const closed = await evalJs(`(() => {
    const modal = document.querySelector('[data-manual-target="dialog"]')
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    return modal.hidden
  })()`)
  if (!closed) fail("Escape did not close manual"); else pass("Escape closes manual")

  ws.close()
} catch (error) {
  fail(error?.stack || String(error))
} finally {
  chrome.kill()
}

process.exit(failed ? 1 : 0)
