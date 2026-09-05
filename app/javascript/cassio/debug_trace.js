const DEBUG_ENDPOINT = "/debug_ingest"
const SESSION_KEY = "cassio.debug.session.v2"
const ACTIVE_RUN_KEY = "cassio.debug.activeRun.v2"
const TAIL_KEY = "cassio.debug.tail.v2"
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000
const FLUSH_MS = 350
const MAX_BATCH = 60
const MAX_TAIL = 120

const nowMs = () => Date.now()
const perfMs = () => Math.round((performance?.now?.() || 0) * 10) / 10
const rand = () => Math.random().toString(36).slice(2, 8)

function loadJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null") } catch (_) { return null }
}

function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch (_) { /* best effort */ }
}

function getSession() {
  const prev = loadJson(SESSION_KEY)
  const now = nowMs()
  if (prev?.id && now - Number(prev.lastSeen || prev.startedAt || 0) < SESSION_MAX_AGE_MS) {
    prev.lastSeen = now
    saveJson(SESSION_KEY, prev)
    return prev
  }
  const session = { id: `${now.toString(36)}-${rand()}`, startedAt: now, lastSeen: now }
  saveJson(SESSION_KEY, session)
  return session
}

const session = getSession()
const runId = `${nowMs().toString(36)}-${rand()}`
let seq = 0
let queue = []
let tail = []
let flushTimer = null
let tailTimer = null
let hooksInstalled = false
let audioTraceInstalled = false
let probeTimer = null
const nodeIds = new WeakMap()
let nextNodeId = 1

function nodeId(node) {
  if (!node || (typeof node !== "object" && typeof node !== "function")) return null
  if (!nodeIds.has(node)) nodeIds.set(node, `n${nextNodeId++}`)
  return nodeIds.get(node)
}

function clean(value, depth = 0) {
  if (depth > 5) return "[depth]"
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (value instanceof Error) return { name: value.name, message: value.message, stack: String(value.stack || "").slice(0, 1600) }
  if (Array.isArray(value)) return value.slice(0, 80).map((v) => clean(v, depth + 1))
  if (typeof value === "object") {
    const out = {}
    for (const [k, v] of Object.entries(value).slice(0, 80)) {
      if (typeof v === "function") continue
      try { out[k] = clean(v, depth + 1) } catch (_) { out[k] = "[unreadable]" }
    }
    return out
  }
  return String(value)
}

function persistTailSoon() {
  if (tailTimer) return
  tailTimer = setTimeout(() => {
    tailTimer = null
    saveJson(TAIL_KEY, { sessionId: session.id, runId, events: tail })
  }, 900)
}

function scheduleFlush() {
  if (queue.length >= MAX_BATCH) {
    void flushDebug()
    return
  }
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushDebug()
  }, FLUSH_MS)
}

export function trace(channel, event, data = {}, severity = "info") {
  const record = {
    sessionId: session.id,
    runId,
    seq: ++seq,
    timestamp: nowMs(),
    perfMs: perfMs(),
    channel,
    event,
    severity,
    data: clean(data)
  }
  queue.push(record)
  tail.push(record)
  if (tail.length > MAX_TAIL) tail = tail.slice(-MAX_TAIL)
  persistTailSoon()
  scheduleFlush()
  return record
}

export async function flushDebug({ beacon = false } = {}) {
  if (!queue.length) return true
  const batch = queue.splice(0, MAX_BATCH)
  const body = JSON.stringify({ sessionId: session.id, runId, events: batch })
  if (beacon && navigator.sendBeacon) {
    const ok = navigator.sendBeacon(DEBUG_ENDPOINT, new Blob([body], { type: "application/json" }))
    if (!ok) queue.unshift(...batch)
    return ok
  }
  try {
    const res = await fetch(DEBUG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    })
    if (!res.ok) throw new Error(`debug ingest ${res.status}`)
    if (queue.length) scheduleFlush()
    return true
  } catch (_) {
    queue.unshift(...batch)
    if (queue.length > 600) queue = queue.slice(-600)
    return false
  }
}

function analyserStats(engine) {
  const analyser = engine?.analyser
  if (!analyser?.getFloatTimeDomainData) return null
  try {
    const data = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(data)
    let peak = 0
    let sum = 0
    let maxDelta = 0
    let clipped = 0
    let prev = data[0] || 0
    for (const x of data) {
      const a = Math.abs(x)
      peak = Math.max(peak, a)
      sum += x * x
      maxDelta = Math.max(maxDelta, Math.abs(x - prev))
      if (a >= 0.995) clipped++
      prev = x
    }
    return {
      peak: Math.round(peak * 10000) / 10000,
      rms: Math.round(Math.sqrt(sum / Math.max(1, data.length)) * 10000) / 10000,
      maxDelta: Math.round(maxDelta * 10000) / 10000,
      clipped,
      fftSize: analyser.fftSize
    }
  } catch (_) {
    return null
  }
}

function sourceSnapshot(loopEngine) {
  const rows = []
  for (const [trackId, src] of loopEngine?._sources || []) {
    rows.push({
      trackId,
      nodeId: nodeId(src),
      duration: src?.buffer?.duration ?? null,
      loop: !!src?.loop,
      loopStart: src?.loopStart ?? null,
      loopEnd: src?.loopEnd ?? null,
      rate: src?.playbackRate?.value ?? null
    })
  }
  return rows
}

function chainSnapshot(loopEngine) {
  const rows = []
  for (const [trackId, chain] of loopEngine?._chains || []) {
    rows.push({
      trackId,
      inputGain: chain?.input?.gain?.value ?? null,
      active: chain?._active ?? null
    })
  }
  return rows
}

export function audioSnapshot(app) {
  const ctx = app?.engine?.ctx
  const loop = app?.loopEngine
  const step = app?.stepSeq
  return {
    screen: app?.screen ?? null,
    renderedScreen: app?._renderScreen ?? null,
    playContext: app?.playContext ?? null,
    context: ctx ? {
      state: ctx.state,
      currentTime: Math.round(ctx.currentTime * 100000) / 100000,
      sampleRate: ctx.sampleRate,
      baseLatency: ctx.baseLatency ?? null,
      outputLatency: ctx.outputLatency ?? null
    } : null,
    transport: app?.transport ? {
      playing: !!app.transport.playing,
      recording: !!app.transport.recording,
      bpm: app.transport.bpm,
      origin: app.transport._origin ?? null
    } : null,
    loop: loop ? {
      playOrigin: loop._playOrigin ?? null,
      recording: !!loop.recording,
      selected: loop.selected,
      sources: sourceSnapshot(loop),
      chains: chainSnapshot(loop),
      tracks: (loop.tracks || []).map((t) => ({
        id: t.id,
        assigned: !!t.assigned,
        hasBuffer: !!t.buffer,
        duration: t.buffer?.duration ?? null,
        mute: !!t.mute,
        solo: !!t.solo,
        armed: !!t.armed,
        level: t.level,
        pan: t.pan,
        offsetSec: t.offsetSec ?? 0,
        lengthBars: t.lengthBars
      }))
    } : null,
    stepSeq: step ? {
      running: !!step.running,
      mode: step._mode ?? null,
      trackId: step._trackId ?? null,
      origin: step._origin ?? null,
      next: step._next ?? null,
      scheduled: step._scheduled?.length ?? null,
      timerArmed: !!step._timer
    } : null,
    voices: {
      synth: app?.synth?.voices?.size ?? null,
      padSynth: app?.padSynth?.voices?.size ?? null
    },
    output: analyserStats(app?.engine)
  }
}

function traceAudio(app, event, data = {}, severity = "info") {
  return trace("audio", event, { ...data, state: audioSnapshot(app) }, severity)
}

function wrapMethod(target, name, app, label, argsToData = null) {
  if (!target || typeof target[name] !== "function") return
  const original = target[name]
  if (original.__cassioDebugWrapped) return
  let callNo = 0
  const wrapped = function(...args) {
    const callId = `${label}:${++callNo}`
    traceAudio(app, `${label}.before`, { callId, args: argsToData ? argsToData(args) : clean(args) })
    let result
    try {
      result = original.apply(this, args)
    } catch (error) {
      traceAudio(app, `${label}.throw`, { callId, error }, "error")
      throw error
    }
    traceAudio(app, `${label}.after`, { callId })
    setTimeout(() => traceAudio(app, `${label}.settled.25ms`, { callId }), 25)
    setTimeout(() => traceAudio(app, `${label}.settled.120ms`, { callId }), 120)
    return result
  }
  wrapped.__cassioDebugWrapped = true
  target[name] = wrapped
}

export function installAudioTrace(app) {
  if (!app || audioTraceInstalled) return
  audioTraceInstalled = true

  traceAudio(app, "install")

  const previousRender = app.render?.bind(app)
  if (previousRender) {
    let lastScreen = app._renderScreen ?? app.screen
    app.render = (...args) => {
      const nextScreen = app.screen
      const changed = lastScreen !== nextScreen
      if (changed) traceAudio(app, "screen.transition.before", { from: lastScreen, to: nextScreen })
      const result = previousRender(...args)
      if (changed) {
        traceAudio(app, "screen.transition.after", { from: lastScreen, to: nextScreen })
        const from = lastScreen
        lastScreen = nextScreen
        setTimeout(() => traceAudio(app, "screen.transition.settled.40ms", { from, to: nextScreen }), 40)
        setTimeout(() => traceAudio(app, "screen.transition.settled.200ms", { from, to: nextScreen }), 200)
      } else {
        lastScreen = nextScreen
      }
      return result
    }
  }

  wrapMethod(app.loopEngine, "startPlayback", app, "loop.startPlayback", (args) => ({ origin: args[0] ?? null }))
  wrapMethod(app.loopEngine, "stopPlayback", app, "loop.stopPlayback")
  wrapMethod(app.loopEngine, "refreshGains", app, "loop.refreshGains")
  wrapMethod(app.stepSeq, "start", app, "seq.start", (args) => ({ origin: args[0] ?? null, options: args[1] ?? null }))
  wrapMethod(app.stepSeq, "stop", app, "seq.stop")
  wrapMethod(app.stepSeq, "resync", app, "seq.resync", (args) => ({ origin: args[0] ?? null }))
  wrapMethod(app.transport, "playAt", app, "transport.playAt", (args) => ({ origin: args[0] ?? null }))
  wrapMethod(app.transport, "stop", app, "transport.stop")
  wrapMethod(app.transport, "setRecording", app, "transport.setRecording", (args) => ({ value: args[0] }))
  wrapMethod(app.engine, "start", app, "engine.start")
  wrapMethod(app.engine, "resume", app, "engine.resume")

  app.engine?.ctx?.addEventListener?.("statechange", () => {
    traceAudio(app, "context.statechange", { state: app.engine.ctx.state })
  })

  probeTimer = setInterval(() => {
    if (app.transport?.playing || app.stepSeq?.running || app.loopEngine?._sources?.size) {
      traceAudio(app, "probe")
    }
  }, 250)
}

export function installGlobalDebugHooks() {
  if (hooksInstalled) return
  hooksInstalled = true

  const previous = loadJson(ACTIVE_RUN_KEY)
  const previousTail = loadJson(TAIL_KEY)
  if (previous?.runId && previous.runId !== runId && !previous.endedAt) {
    trace("lifecycle", "previous_run_interrupted", {
      previous,
      previousTail: previousTail?.runId === previous.runId ? previousTail.events?.slice(-40) : []
    }, "warn")
  }

  saveJson(ACTIVE_RUN_KEY, {
    sessionId: session.id,
    runId,
    startedAt: nowMs(),
    href: location.href,
    userAgent: navigator.userAgent
  })

  window.addEventListener("error", (e) => {
    trace("error", "window.error", {
      message: String(e.message || e.error?.message || e),
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      error: e.error
    }, "error")
    void flushDebug()
  })

  window.addEventListener("unhandledrejection", (e) => {
    trace("error", "window.unhandledrejection", { reason: e.reason }, "error")
    void flushDebug()
  })

  document.addEventListener("visibilitychange", () => {
    trace("lifecycle", "visibilitychange", { state: document.visibilityState })
    if (document.visibilityState === "hidden") void flushDebug({ beacon: true })
  })

  window.addEventListener("pagehide", (e) => {
    trace("lifecycle", "pagehide", { persisted: !!e.persisted })
    const active = loadJson(ACTIVE_RUN_KEY) || {}
    saveJson(ACTIVE_RUN_KEY, { ...active, endedAt: nowMs(), endReason: "pagehide" })
    void flushDebug({ beacon: true })
  })

  window.addEventListener("pageshow", (e) => {
    trace("lifecycle", "pageshow", { persisted: !!e.persisted })
  })

  trace("lifecycle", "run.start", {
    href: location.href,
    userAgent: navigator.userAgent,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: navigator.deviceMemory ?? null,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }
  })
}

export function debugIdentity() {
  return { sessionId: session.id, runId }
}
