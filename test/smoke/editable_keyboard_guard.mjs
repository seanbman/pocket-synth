#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const PORT = 9352
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-editable-keyboard")
const chrome = spawn(process.env.CHROME_BIN || "google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"
], { stdio: ["ignore", "ignore", "pipe"] })

let chromeErr = ""
chrome.stderr.on("data", (chunk) => { chromeErr += chunk.toString() })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const deadline = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
])

async function waitChrome() {
  for (let i = 0; i < 50; i++) {
    if (chrome.exitCode != null) throw new Error(`Chrome exited ${chrome.exitCode}: ${chromeErr.slice(-2000)}`)
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (res.ok) return await res.json()
    } catch (_) { /* retry */ }
    await sleep(250)
  }
  throw new Error(`Chrome debug endpoint unavailable\n${chromeErr.slice(-2000)}`)
}

let failed = false
const pass = (msg) => console.log(`PASS: ${msg}`)
const fail = (msg) => { failed = true; console.error(`FAIL: ${msg}`) }

try {
  const targets = await waitChrome()
  const page = targets.find((t) => t.type === "page") || targets[0]
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
  await sleep(7500)

  const ready = await evalJs(`(async () => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    if (!app?.projectRuntime) return { fatal: 'project runtime missing' }
    app.projectRuntime.startName('save-as', '', 'SAVE PROJECT')
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const input = app.vscreen.querySelector('#cassio-project-name-field')
    input.value = ''
    input.focus()
    app.heldKeys.clear()
    return { fatal: null, focused: document.activeElement === input, before: input.value }
  })()`)
  if (ready.fatal) throw new Error(ready.fatal)
  if (ready.focused) pass("project name field focused")
  else fail("project name field did not receive focus")

  await send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "z", code: "KeyZ", text: "z", unmodifiedText: "z",
    windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90
  })
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "z", code: "KeyZ",
    windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90
  })
  await sleep(120)

  const projectResult = await evalJs(`(() => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus.getControllerForElementAndIdentifier(root, 'cassio').app
    const input = app.vscreen.querySelector('#cassio-project-name-field')
    return {
      value: input.value,
      held: app.heldKeys.size,
      visual: root.querySelector('[data-action="key-0"]')?.classList.contains('active') || false
    }
  })()`)
  if (projectResult.value.toUpperCase().includes("Z")) pass("mapped piano key still types into PROJECT name")
  else fail(`mapped key did not type into PROJECT name: ${JSON.stringify(projectResult)}`)
  if (projectResult.held === 0 && !projectResult.visual) pass("PROJECT typing does not trigger or latch synth note")
  else fail(`PROJECT typing leaked to synth: ${JSON.stringify(projectResult)}`)

  const genericReady = await evalJs(`(() => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus.getControllerForElementAndIdentifier(root, 'cassio').app
    const textarea = document.createElement('textarea')
    textarea.id = 'guard-probe'
    document.body.appendChild(textarea)
    textarea.focus()
    app.heldKeys.clear()
    return document.activeElement === textarea
  })()`)
  if (!genericReady) fail("generic textarea probe did not receive focus")

  await send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "x", code: "KeyX", text: "x", unmodifiedText: "x",
    windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88
  })
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "x", code: "KeyX",
    windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88
  })
  await sleep(100)

  const genericResult = await evalJs(`(() => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus.getControllerForElementAndIdentifier(root, 'cassio').app
    const textarea = document.querySelector('#guard-probe')
    const result = { value: textarea.value, held: app.heldKeys.size }
    textarea.remove()
    return result
  })()`)
  if (genericResult.value.includes("x") && genericResult.held === 0) pass("generic textarea is protected from global synth mapping")
  else fail(`generic editable guard failed: ${JSON.stringify(genericResult)}`)

  ws.close()
} catch (error) {
  fail(error?.stack || String(error))
} finally {
  chrome.kill("SIGTERM")
  await sleep(250)
}

process.exit(failed ? 1 : 0)
