#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const PORT = 9352
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-project-audio-export")
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
  for (let i = 0; i < 50; i++) {
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
  await sleep(8000)

  const result = await evalJs(`(async () => {
    indexedDB.deleteDatabase('cassio-projects-v1')
    localStorage.removeItem('cassio.activeProjectId')
    await new Promise((r) => setTimeout(r, 100))
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    if (!app?.projectRuntime || !app?.projectAudioExportRuntime) return { fatal: 'project export runtime missing' }
    const press = async (action, wait = 90) => {
      const el = root.querySelector('[data-action="' + action + '"]')
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 11 }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11 }))
      await new Promise((r) => setTimeout(r, wait))
    }

    await app.projectRuntime.open()
    await press('soft-b')
    const input = app.vscreen.querySelector('#cassio-project-name-field')
    input.value = 'EXPORT TEST'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await press('soft-d', 180)

    await press('nav-right')
    const manageText = app.vscreen.textContent
    await press('nav-down')
    await press('nav-down')
    await press('nav-ok')

    const exportScreen = app.screen
    const exportText = app.vscreen.textContent
    const soft = [...app.vscreen.querySelectorAll('.lcd-soft > div')].map((x) => x.textContent.trim())
    const beforeNav = {
      formatIndex: app.projectAudioExportRuntime.formatIndex,
      screen: app.screen,
      rows: [...app.vscreen.querySelectorAll('.lib-row')].map((x) => ({ text: x.textContent.trim(), className: x.className }))
    }
    await press('nav-down')
    const afterNav = {
      formatIndex: app.projectAudioExportRuntime.formatIndex,
      screen: app.screen,
      rows: [...app.vscreen.querySelectorAll('.lib-row')].map((x) => ({ text: x.textContent.trim(), className: x.className })),
      html: app.vscreen.innerHTML.slice(0, 1400)
    }
    const selected = app.vscreen.querySelector('.lib-row.selected')?.textContent?.trim() || ''
    await press('soft-d')

    return {
      fatal: null,
      manageText,
      exportScreen,
      exportText,
      soft,
      beforeNav,
      afterNav,
      selected,
      backScreen: app.screen
    }
  })()`)

  if (result?.fatal) throw new Error(result.fatal)
  if (result.manageText.includes("EXPORT AUDIO") && result.manageText.includes("EXPORT .CASSIO")) pass("PROJECT Manage exposes audio and editable project export")
  else fail(`PROJECT Manage export actions missing: ${JSON.stringify(result)}`)

  if (result.exportScreen === "project-audio-export" && result.exportText.includes("EXPORT SONG")) pass("hardware navigation opens song export screen")
  else fail(`song export screen missing: ${JSON.stringify(result)}`)

  if (result.soft.join("|").includes("WAV") && result.soft.join("|").includes("MP3") && result.soft.join("|").includes("M4A")) pass("WAV MP3 M4A are direct export choices")
  else fail(`format soft keys missing: ${JSON.stringify(result.soft)}`)

  if (result.selected.includes("MP3")) pass("format selector follows hardware navigation")
  else fail(`format navigation failed: ${JSON.stringify({ beforeNav: result.beforeNav, afterNav: result.afterNav, selected: result.selected })}`)

  if (result.backScreen === "project-manage") pass("export screen returns to PROJECT Manage")
  else fail(`export back navigation failed: ${result.backScreen}`)

  ws.close()
} catch (error) {
  fail(error?.stack || String(error))
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
