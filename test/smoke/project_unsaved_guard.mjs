#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const PORT = 9345
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-project-unsaved")
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

  const guard = await evalJs(`(async () => {
    indexedDB.deleteDatabase('cassio-projects-v1')
    localStorage.removeItem('cassio.activeProjectId')
    await new Promise((r) => setTimeout(r, 100))
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    const rt = app?.projectRuntime
    if (!rt) return { fatal: 'project runtime missing' }

    const targetState = rt.snapshotCurrent()
    targetState.bpm = 99
    await rt.importBundle({
      format: 'cassio-project-v1',
      version: 1,
      project: { name: 'TARGET', state: targetState },
      userSounds: []
    })
    rt.activeProjectId = null
    localStorage.removeItem('cassio.activeProjectId')
    app.transport.bpm = 147
    app.project.bpm = 147

    const press = async (action, wait = 90) => {
      const el = root.querySelector('[data-action="' + action + '"]')
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 11 }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11 }))
      await new Promise((r) => setTimeout(r, wait))
    }

    await press('soft-d')
    const switchPrompt = app.screen === 'project-switch-confirm'
    await press('soft-d')
    const saveNamePrompt = app.screen === 'project-name' && app.vscreen.textContent.includes('SAVE CURRENT AS')
    return { fatal: null, switchPrompt, saveNamePrompt }
  })()`)

  if (guard?.fatal) throw new Error(guard.fatal)
  if (guard.switchPrompt) pass("unnamed/recovery session gets Save/Discard guard before OPEN")
  else fail("unnamed session bypassed switch guard")
  if (guard.saveNamePrompt) pass("SAVE from unnamed switch asks for a project name")
  else fail("unnamed switch did not enter Save As naming")

  await evalJs(`(() => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus.getControllerForElementAndIdentifier(root, 'cassio').app
    const input = app.vscreen.querySelector('#cassio-project-name-field')
    input.value = 'UNNAMED SAVE'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const el = root.querySelector('[data-action="soft-d"]')
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 12 }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 12 }))
    return true
  })()`)

  await sleep(6500)
  const restored = await evalJs(`(async () => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    const rt = app?.projectRuntime
    if (!rt) return { fatal: 'project runtime missing after reload' }
    await rt.open()
    return {
      fatal: null,
      bpm: app.transport?.bpm,
      savedUnnamed: rt.projects.some((p) => p.name === 'UNNAMED SAVE' && p.state?.bpm === 147),
      activeName: rt.projects.find((p) => p.id === rt.activeProjectId)?.name || ''
    }
  })()`)

  if (restored?.fatal) throw new Error(restored.fatal)
  if (restored.bpm === 99 && restored.activeName === "TARGET") pass("saved unnamed session then opened the requested project")
  else fail(`target project restore failed: ${JSON.stringify(restored)}`)
  if (restored.savedUnnamed) pass("pre-switch unnamed session was preserved as a named project")
  else fail("pre-switch session was not saved before OPEN")

  ws.close()
} catch (error) {
  fail(error?.stack || String(error))
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
