#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const PORT = 9344
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-project-v1")
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

  const setup = await evalJs(`(async () => {
    indexedDB.deleteDatabase('cassio-projects-v1')
    localStorage.removeItem('cassio.activeProjectId')
    await new Promise((r) => setTimeout(r, 100))
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    if (!app?.projectRuntime) return { fatal: 'project runtime missing' }
    const press = (action) => {
      const el = root.querySelector('[data-action="' + action + '"]')
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    }
    app.screen = 'menu'; app.menuIndex = 4; app.render(); press('soft-a')
    await new Promise((r) => setTimeout(r, 150))
    return {
      fatal: null,
      screen: app.screen,
      text: app.vscreen.textContent,
      soft: [...app.vscreen.querySelectorAll('.lcd-soft > div')].map((x) => x.textContent.trim())
    }
  })()`)
  if (setup.fatal) throw new Error(setup.fatal)
  if (setup.screen === "project-list" && setup.text.includes("PROJECTS") && setup.soft.join("|").includes("NEW") && setup.soft.join("|").includes("SAVE") && setup.soft.join("|").includes("RENAME") && setup.soft.join("|").includes("OPEN")) pass("PROJECT opens as a real V1 project list")
  else fail(`PROJECT list missing: ${JSON.stringify(setup)}`)

  const lifecycle = await evalJs(`(async () => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus.getControllerForElementAndIdentifier(root, 'cassio').app
    const rt = app.projectRuntime
    const press = async (action, wait = 80) => {
      const el = root.querySelector('[data-action="' + action + '"]')
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }))
      await new Promise((r) => setTimeout(r, wait))
    }
    const name = async (value) => {
      const input = app.vscreen.querySelector('#cassio-project-name-field')
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await press('soft-d', 180)
    }

    await press('soft-b')
    const savePrompt = app.screen === 'project-name'
    await name('FIRST JAM')
    const savedOne = rt.projects.length === 1 && rt.activeProjectId === rt.projects[0].id

    app.transport.bpm = 133
    app.project.bpm = 133
    await press('soft-b', 180)
    const active = rt.projects.find((p) => p.id === rt.activeProjectId)
    const savedBpm = active?.state?.bpm === 133

    await press('soft-c')
    await name('RENAMED JAM')
    const renamed = rt.projects.some((p) => p.name === 'RENAMED JAM')

    await press('nav-right')
    const manage = app.screen === 'project-manage' && app.vscreen.textContent.includes('SAVE AS') && app.vscreen.textContent.includes('DUPLICATE') && app.vscreen.textContent.includes('EXPORT .CASSIO') && app.vscreen.textContent.includes('DELETE')
    await press('nav-down')
    await press('nav-ok', 180)
    const duplicated = rt.projects.length === 2

    const bundle = await rt.exportSelectedBundle({ download: false })
    const exportOk = bundle?.format === 'cassio-project-v1' && bundle?.project?.state?.bpm === 133
    await rt.importBundle(bundle)
    const imported = rt.projects.length === 3

    await press('nav-right')
    await press('nav-down'); await press('nav-down'); await press('nav-down')
    await press('nav-ok')
    const deletePrompt = app.screen === 'project-delete-confirm'
    await press('soft-d', 180)
    const deleted = rt.projects.length === 2

    const targetIndex = rt.projects.findIndex((p) => p.id !== rt.activeProjectId && p.state?.bpm === 133)
    rt.projectIndex = targetIndex
    app.render()
    app.transport.bpm = 77
    app.project.bpm = 77
    await press('soft-d')
    const switchPrompt = app.screen === 'project-switch-confirm'
    await press('soft-c', 50)

    return { savePrompt, savedOne, savedBpm, renamed, manage, duplicated, exportOk, imported, deletePrompt, deleted, switchPrompt }
  })()`)

  for (const [key, value] of Object.entries(lifecycle)) {
    if (value) pass(key)
    else fail(key)
  }

  await sleep(6500)
  const reopened = await evalJs(`(() => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    return { bpm: app?.transport?.bpm, active: app?.projectRuntime?.activeProjectId || null, ready: !!app?.projectRuntime }
  })()`)
  if (reopened.ready && reopened.bpm === 133 && reopened.active) pass("opening a saved project restores the serialized session through recovery")
  else fail(`reopen restore failed: ${JSON.stringify(reopened)}`)

  const newStart = await evalJs(`(async () => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus.getControllerForElementAndIdentifier(root, 'cassio').app
    const rt = app.projectRuntime
    const press = async (action, wait = 80) => {
      const el = root.querySelector('[data-action="' + action + '"]')
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3 }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3 }))
      await new Promise((r) => setTimeout(r, wait))
    }
    await rt.open()
    await press('soft-a')
    const confirm = app.screen === 'project-switch-confirm'
    await press('soft-c')
    const naming = app.screen === 'project-name'
    const input = app.vscreen.querySelector('#cassio-project-name-field')
    input.value = 'NEW CLEAN'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await press('soft-d', 50)
    return { confirm, naming }
  })()`)
  if (newStart.confirm && newStart.naming) pass("NEW prompts through the project workflow")
  else fail(`new project flow failed: ${JSON.stringify(newStart)}`)

  await sleep(6500)
  const fresh = await evalJs(`(() => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    return { bpm: app?.transport?.bpm, active: app?.projectRuntime?.activeProjectId || null }
  })()`)
  if (fresh.bpm === 120 && fresh.active) pass("NEW starts a clean default project and makes it active")
  else fail(`new project did not reset cleanly: ${JSON.stringify(fresh)}`)

  ws.close()
} catch (error) {
  fail(error?.stack || String(error))
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
