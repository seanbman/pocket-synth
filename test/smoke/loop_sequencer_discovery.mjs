#!/usr/bin/env node
/**
 * Regression for the 2026-09-05 user-test finding that the pattern sequencer
 * was difficult to discover from LOOP. Verifies the visible affordance and the
 * real hold-B hardware path at the phone portrait target.
 */
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const PORT = 9343
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-loop-seq-discovery")
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
    if (chrome.exitCode != null) throw new Error(`Chrome exited ${chrome.exitCode}: ${chromeErr.slice(-3000)}`)
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (response.ok) return await response.json()
    } catch (_) { /* retry */ }
    await sleep(250)
  }
  throw new Error(`Chrome debug endpoint unavailable\n${chromeErr.slice(-3000)}`)
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
    if (reply.result?.exceptionDetails) {
      throw new Error(reply.result.exceptionDetails.exception?.description || reply.result.exceptionDetails.text)
    }
    return reply.result?.result?.value
  }

  await send("Runtime.enable")
  await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  })
  await send("Page.navigate", { url: URL })
  await sleep(7000)

  const result = await evalJs(`(async () => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    if (!root || !app) return { fatal: 'no app' }

    app.looper.openHome()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const homeText = app.vscreen?.innerText || ''
    const softBText = app.vscreen?.querySelector('.lcd-soft > div:nth-child(2)')?.innerText || ''
    const visibleAffordance = homeText.includes('PATTERN SEQUENCER') && homeText.includes('HOLD B')
    const softKeyAffordance = softBText.includes('MUTE/SEQ')

    const hardwareB = root.querySelector('[data-action="soft-b"]')
    if (!hardwareB) return { fatal: 'no physical soft B' }
    hardwareB.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerId: 41, pointerType: 'touch', isPrimary: true
    }))
    await new Promise((resolve) => setTimeout(resolve, 460))
    hardwareB.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 41, pointerType: 'touch', isPrimary: true
    }))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const openedSequencer = app.screen === 'sequencer' && !!app.vscreen?.querySelector('.seq-grid')
    const sequencerText = app.vscreen?.innerText || ''

    return {
      fatal: null,
      visibleAffordance,
      softKeyAffordance,
      openedSequencer,
      sequencerNamed: /SEQUENC|PATTERN/i.test(sequencerText)
    }
  })()`)

  if (result?.fatal) throw new Error(result.fatal)
  if (result.visibleAffordance) pass("LOOP home visibly names PATTERN SEQUENCER and HOLD B")
  else fail("LOOP home does not expose the sequencer shortcut clearly")

  if (result.softKeyAffordance) pass("soft B advertises its MUTE/SEQ dual role")
  else fail("soft B does not advertise the sequencer path")

  if (result.openedSequencer) pass("holding the real B hardware control opens the sequencer")
  else fail("hold-B did not open the sequencer")

  if (result.sequencerNamed) pass("destination identifies the pattern/sequencer workflow")
  else fail("sequencer destination is not identifiable")

  ws.close()
} catch (error) {
  fail(error?.stack || String(error))
} finally {
  chrome.kill()
}

process.exit(failed ? 1 : 0)
