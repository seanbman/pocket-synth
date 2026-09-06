#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const PORT = 9347
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-settings-bridge")
const chrome = spawn(process.env.CHROME_BIN || "google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"
], { stdio: "ignore" })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failed = false
const pass = (msg) => console.log(`PASS: ${msg}`)
const fail = (msg) => { failed = true; console.error(`FAIL: ${msg}`) }

async function waitChrome() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (res.ok) return await res.json()
    } catch (_) { /* retry */ }
    await sleep(250)
  }
  throw new Error("Chrome debug endpoint unavailable")
}

try {
  const targets = await waitChrome()
  const page = targets.find((t) => t.type === "page") || targets[0]
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (!msg.id || !pending.has(msg.id)) return
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const callId = ++id
    pending.set(callId, resolve)
    ws.send(JSON.stringify({ id: callId, method, params }))
  })
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

  const changed = await evalJs(`(() => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    const rt = app?.settingsRuntime
    if (!rt) return { fatal: 'settings runtime missing' }
    rt.update({ chassisTheme: 'mint' })
    app.setMetroOn(false)
    app.setMetroLevel(0.4)
    const persisted = JSON.parse(localStorage.getItem('cassio.systemSettings.v1') || '{}')
    const chassis = root.querySelector('.chassis')
    return {
      theme: rt.settings.chassisTheme,
      computed: getComputedStyle(chassis).backgroundImage,
      metroOn: rt.settings.metroOn,
      metroLevel: rt.settings.metroLevel,
      persistedOn: persisted.metroOn,
      persistedLevel: persisted.metroLevel,
      liveOn: app.metro.on,
      liveLevel: app.metro.level
    }
  })()`)
  if (changed.fatal) throw new Error(changed.fatal)

  if (changed.theme === "mint" && /107,\s*214,\s*189/.test(changed.computed)) pass("MINT is rendered on the actual chassis gradient")
  else fail(`actual chassis did not render MINT: ${JSON.stringify(changed)}`)

  if (changed.metroOn === false && changed.persistedOn === false && changed.liveOn === false && Math.abs(changed.metroLevel - 0.4) < 0.001 && Math.abs(changed.persistedLevel - 0.4) < 0.001 && Math.abs(changed.liveLevel - 0.4) < 0.001) pass("PLAY metronome controls stay synchronized with global SETTINGS")
  else fail(`metronome SETTINGS bridge failed: ${JSON.stringify(changed)}`)

  await evalJs("location.reload(); true")
  await sleep(7000)
  const reloaded = await evalJs(`(() => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    return {
      theme: app?.settingsRuntime?.settings?.chassisTheme,
      metroOn: app?.settingsRuntime?.settings?.metroOn,
      metroLevel: app?.settingsRuntime?.settings?.metroLevel,
      liveOn: app?.metro?.on,
      liveLevel: app?.metro?.level,
      computed: getComputedStyle(root.querySelector('.chassis')).backgroundImage
    }
  })()`)

  if (reloaded.theme === "mint" && reloaded.metroOn === false && reloaded.liveOn === false && Math.abs(reloaded.metroLevel - 0.4) < 0.001 && Math.abs(reloaded.liveLevel - 0.4) < 0.001 && /107,\s*214,\s*189/.test(reloaded.computed)) pass("chassis and PLAY metronome changes survive reload as system settings")
  else fail(`SETTINGS bridge reload failed: ${JSON.stringify(reloaded)}`)

  ws.close()
} catch (error) {
  fail(error?.stack || String(error))
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
