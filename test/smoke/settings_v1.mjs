#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const PORT = 9346
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-settings-v1")
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
  await sleep(8000)

  const home = await evalJs(`(async () => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    if (!app?.settingsRuntime) return { fatal: 'settings runtime missing' }
    const press = async (action, wait = 90) => {
      const el = root.querySelector('[data-action="' + action + '"]')
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 30 }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 30 }))
      await new Promise((r) => setTimeout(r, wait))
    }
    app.screen = 'menu'; app.menuIndex = 5; app.render(); await press('soft-a', 180)
    return {
      fatal: null,
      screen: app.screen,
      text: app.vscreen.textContent,
      contained: app.vscreen.scrollWidth <= app.vscreen.clientWidth + 1
    }
  })()`)
  if (home.fatal) throw new Error(home.fatal)
  if (home.screen === "settings-home" && ["AUDIO", "METRONOME", "DISPLAY", "STORAGE", "PERMISSIONS", "ABOUT"].every((x) => home.text.includes(x))) pass("SETTINGS opens all six canonical V1 rows")
  else fail(`SETTINGS home incomplete: ${JSON.stringify(home)}`)
  if (home.contained) pass("SETTINGS home is horizontally contained at 390x844")
  else fail("SETTINGS home overflows at 390x844")

  const functional = await evalJs(`(async () => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus.getControllerForElementAndIdentifier(root, 'cassio').app
    const rt = app.settingsRuntime
    let pointerId = 40
    const press = async (action, wait = 100) => {
      const el = root.querySelector('[data-action="' + action + '"]')
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: pointerId++ }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: pointerId++ }))
      await new Promise((r) => setTimeout(r, wait))
    }
    const openIndex = async (target) => {
      while (rt.homeIndex !== target) await press('soft-c', 20)
      await press('soft-a', 180)
    }

    await openIndex(0)
    const audioOpen = app.screen === 'settings-audio'
    await press('nav-right'); await press('nav-right')
    await press('nav-down'); await press('nav-left')
    await press('soft-b', 160)
    const audio = {
      bass: rt.settings.masterBassDb,
      treble: rt.settings.masterTrebleDb,
      limiter: rt.settings.limiter,
      engineBass: app.engine.masterBassDb,
      engineTreble: app.engine.masterTrebleDb,
      engineLimiter: app.engine.limiterEnabled
    }
    await press('soft-d')

    await openIndex(1)
    const metroOpen = app.screen === 'settings-metro'
    await press('nav-down'); await press('nav-down'); await press('nav-right')
    await press('soft-b', 120)
    const metro = {
      countIn: rt.settings.countInBars,
      projectCountIn: app.project.loop.countInBars,
      sound: rt.settings.metroSound,
      metroSound: app.metro.sound
    }
    await press('soft-d')

    await openIndex(2)
    const displayOpen = app.screen === 'settings-display'
    await press('nav-down'); await press('nav-right', 140)
    const display = {
      theme: rt.settings.chassisTheme,
      chassisVar: root.style.getPropertyValue('--chassis').trim(),
      text: app.vscreen.textContent,
      contained: app.vscreen.scrollWidth <= app.vscreen.clientWidth + 1
    }
    await press('soft-d')

    await openIndex(3)
    await new Promise((r) => setTimeout(r, 250))
    const storage = { open: app.screen === 'settings-storage', message: rt.storageMessage, text: app.vscreen.textContent }
    await press('soft-d')

    await openIndex(4)
    await new Promise((r) => setTimeout(r, 150))
    await press('soft-c', 80)
    const permissions = { open: app.screen === 'settings-permissions', status: rt.micPermission, message: rt.permissionMessage, text: app.vscreen.textContent }
    await press('soft-d')

    await openIndex(5)
    const about = { open: app.screen === 'settings-about', text: app.vscreen.textContent, diag: rt.diagnosticSnapshot() }

    return { audioOpen, audio, metroOpen, metro, displayOpen, display, storage, permissions, about }
  })()`)

  if (functional.audioOpen && functional.audio.bass === 2 && functional.audio.treble === -1 && functional.audio.limiter === false && functional.audio.engineBass === 2 && functional.audio.engineTreble === -1 && functional.audio.engineLimiter === false) pass("master EQ and limiter are live system controls")
  else fail(`audio settings failed: ${JSON.stringify(functional.audio)}`)

  if (functional.metroOpen && functional.metro.countIn === 2 && functional.metro.projectCountIn === 2 && functional.metro.sound === "tick" && functional.metro.metroSound === "tick") pass("metronome sound and count-in settings apply live")
  else fail(`metronome settings failed: ${JSON.stringify(functional.metro)}`)

  if (functional.displayOpen && functional.display.theme === "mint" && functional.display.chassisVar.toLowerCase() === "#6bd6bd" && functional.display.text.includes("CHASSIS COLOR") && functional.display.contained) pass("DISPLAY changes the actual chassis to persistent MINT without overflow")
  else fail(`display/chassis settings failed: ${JSON.stringify(functional.display)}`)

  if (functional.storage.open && functional.storage.message && !functional.storage.message.includes("NOT CHECKED") && functional.storage.text.includes("PERSISTENT")) pass("storage surface reports usage/persistence state explicitly")
  else fail(`storage settings failed: ${JSON.stringify(functional.storage)}`)

  if (functional.permissions.open && functional.permissions.status && functional.permissions.message.includes("ALLOW MICROPHONE") && functional.permissions.text.includes("MICROPHONE")) pass("permissions surface exposes mic state and recovery help")
  else fail(`permission settings failed: ${JSON.stringify(functional.permissions)}`)

  if (functional.about.open && functional.about.text.includes("V1 PROTOTYPE") && functional.about.diag?.chassisTheme === "mint") pass("About/diagnostics surface is functional")
  else fail(`about settings failed: ${JSON.stringify(functional.about)}`)

  await evalJs("location.reload(); true")
  await sleep(7000)

  const persisted = await evalJs(`(() => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    const rt = app?.settingsRuntime
    return {
      ready: !!rt,
      theme: rt?.settings?.chassisTheme,
      bass: rt?.settings?.masterBassDb,
      treble: rt?.settings?.masterTrebleDb,
      limiter: rt?.settings?.limiter,
      countIn: rt?.settings?.countInBars,
      metroSound: rt?.settings?.metroSound,
      engineBass: app?.engine?.masterBassDb,
      engineLimiter: app?.engine?.limiterEnabled,
      projectCountIn: app?.project?.loop?.countInBars,
      chassisVar: root?.style?.getPropertyValue('--chassis')?.trim()
    }
  })()`)

  if (persisted.ready && persisted.theme === "mint" && persisted.bass === 2 && persisted.treble === -1 && persisted.limiter === false && persisted.countIn === 2 && persisted.metroSound === "tick" && persisted.engineBass === 2 && persisted.engineLimiter === false && persisted.projectCountIn === 2 && persisted.chassisVar.toLowerCase() === "#6bd6bd") pass("system settings and chassis color survive reload independently of projects")
  else fail(`SETTINGS persistence failed: ${JSON.stringify(persisted)}`)

  ws.close()
} catch (error) {
  fail(error?.stack || String(error))
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
