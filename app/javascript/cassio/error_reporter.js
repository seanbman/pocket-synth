const ENDPOINT = "/error_reports"
const DB_NAME = "cassio-diagnostics-v1"
const DB_VERSION = 1
const STORE_NAME = "outbox"
const FALLBACK_KEY = "cassio.error.outbox.v1"
const MAX_REPORTS = 40
const MAX_REPORT_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_BREADCRUMBS = 24
const MAX_BATCH = 8
const MAX_MESSAGE = 500
const MAX_STACK = 4000
const MAX_DETAIL = 160
const BASE_RETRY_MS = 5000
const MAX_RETRY_MS = 60 * 60 * 1000

let installed = false
let dbPromise = null
let idbDisabled = false
let flushPromise = null
let breadcrumbs = []
let recentFingerprints = new Map()

const nowMs = () => Date.now()

function browserGlobal() {
  return typeof window !== "undefined" ? window : null
}

function navigatorGlobal() {
  return typeof navigator !== "undefined" ? navigator : null
}

function documentGlobal() {
  return typeof document !== "undefined" ? document : null
}

export function sanitizeReportText(value, maxLength = MAX_MESSAGE) {
  let text = String(value ?? "").replace(/\0/g, "").trim()
  text = text.replace(/data:[^\s]+/gi, "<data-url>")
  text = text.replace(/blob:https?:\/\/[^\s)]+/gi, "<blob-url>")
  text = text.replace(/https?:\/\/[^\s)]+/gi, (raw) => {
    try {
      const parsed = new URL(raw)
      return `${parsed.origin}${parsed.pathname}`
    } catch (_) {
      return "<url>"
    }
  })
  text = text.replace(/[A-Za-z0-9+/]{256,}={0,2}/g, "<binary>")
  return text.slice(0, maxLength)
}

function normalizedFingerprintPart(value) {
  return sanitizeReportText(value, 1000)
    .toLowerCase()
    .replace(/\b\d{2,}\b/g, "#")
    .replace(/:\d+:\d+/g, ":#:#")
    .replace(/\s+/g, " ")
}

function hash32(input, seed) {
  let hash = seed >>> 0
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

export function fingerprintFor({ kind = "error", name = "Error", message = "", source = "" } = {}) {
  const signature = [kind, name, message, source].map(normalizedFingerprintPart).join("|")
  return `${hash32(signature, 2166136261)}${hash32(signature, 2246822519)}`
}

function randomId() {
  const cryptoApi = typeof crypto !== "undefined" ? crypto : null
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  const random = () => Math.random().toString(36).slice(2, 10)
  return `${nowMs().toString(36)}-${random()}-${random()}`
}

function safeSource(value) {
  const raw = String(value || "")
  if (!raw) return ""
  try {
    const parsed = new URL(raw, browserGlobal()?.location?.origin || "http://localhost")
    return sanitizeReportText(parsed.pathname, 300)
  } catch (_) {
    return sanitizeReportText(raw, 300)
  }
}

function buildSha() {
  const meta = documentGlobal()?.querySelector?.('meta[name="cassio-build"]')
  return sanitizeReportText(meta?.content || "unknown", 80)
}

function capabilitySnapshot() {
  const win = browserGlobal()
  const nav = navigatorGlobal()
  if (!win) return {}
  return {
    secureContext: !!win.isSecureContext,
    webAudio: !!(win.AudioContext || win.webkitAudioContext),
    audioWorklet: !!(win.AudioWorkletNode || win.AudioWorklet),
    indexedDb: !!win.indexedDB,
    serviceWorker: !!nav?.serviceWorker,
    mediaDevices: !!nav?.mediaDevices,
    getUserMedia: !!nav?.mediaDevices?.getUserMedia,
    fileReader: typeof win.FileReader === "function",
    webAssembly: typeof win.WebAssembly === "object"
  }
}

function viewportSnapshot() {
  const win = browserGlobal()
  if (!win) return {}
  return {
    width: Number(win.innerWidth || 0),
    height: Number(win.innerHeight || 0),
    dpr: Number(win.devicePixelRatio || 1)
  }
}

export function errorBreadcrumb(event, detail = "") {
  breadcrumbs.push({
    at: nowMs(),
    event: sanitizeReportText(event, 80),
    detail: sanitizeReportText(detail, MAX_DETAIL)
  })
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs = breadcrumbs.slice(-MAX_BREADCRUMBS)
}

function errorParts(error) {
  if (error instanceof Error) {
    return {
      name: sanitizeReportText(error.name || "Error", 120),
      message: sanitizeReportText(error.message || "", MAX_MESSAGE),
      stack: sanitizeReportText(error.stack || "", MAX_STACK)
    }
  }
  if (error && typeof error === "object") {
    return {
      name: sanitizeReportText(error.name || "Error", 120),
      message: sanitizeReportText(error.message || String(error), MAX_MESSAGE),
      stack: sanitizeReportText(error.stack || "", MAX_STACK)
    }
  }
  return { name: "Error", message: sanitizeReportText(error, MAX_MESSAGE), stack: "" }
}

export function buildErrorReport(error, context = {}) {
  const nav = navigatorGlobal()
  const win = browserGlobal()
  const parts = errorParts(error)
  const kind = sanitizeReportText(context.kind || "runtime", 80)
  const source = safeSource(context.source)
  const fingerprint = fingerprintFor({ kind, name: parts.name, message: parts.message, source })

  return {
    id: randomId(),
    createdAt: nowMs(),
    build: buildSha(),
    fingerprint,
    kind,
    name: parts.name,
    message: parts.message,
    stack: parts.stack,
    source,
    line: Number(context.line || 0) || null,
    column: Number(context.column || 0) || null,
    route: sanitizeReportText(win?.location?.pathname || "", 300),
    userAgent: sanitizeReportText(nav?.userAgent || "", 500),
    language: sanitizeReportText(nav?.language || "", 40),
    viewport: viewportSnapshot(),
    capabilities: capabilitySnapshot(),
    breadcrumbs: breadcrumbs.slice(-MAX_BREADCRUMBS),
    retryCount: 0,
    nextAttemptAt: 0
  }
}

function fallbackRead() {
  try {
    const storage = browserGlobal()?.localStorage
    const parsed = JSON.parse(storage?.getItem(FALLBACK_KEY) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

function fallbackWrite(reports) {
  try {
    browserGlobal()?.localStorage?.setItem(FALLBACK_KEY, JSON.stringify(reports.slice(-MAX_REPORTS)))
    return true
  } catch (_) {
    return false
  }
}

function openDb() {
  if (idbDisabled) return Promise.reject(new Error("IndexedDB unavailable"))
  if (dbPromise) return dbPromise
  const idb = browserGlobal()?.indexedDB
  if (!idb) {
    idbDisabled = true
    return Promise.reject(new Error("IndexedDB unavailable"))
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"))
    request.onblocked = () => reject(new Error("IndexedDB open blocked"))
  }).catch((error) => {
    idbDisabled = true
    dbPromise = null
    throw error
  })
  return dbPromise
}

async function idbAll() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : [])
    request.onerror = () => reject(request.error || new Error("IndexedDB read failed"))
  })
}

async function idbPut(report) {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(report)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error("IndexedDB write failed"))
  })
}

async function idbDelete(ids) {
  if (!ids.length) return
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    ids.forEach((id) => store.delete(id))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"))
  })
}

async function pruneIdb() {
  const reports = (await idbAll()).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
  const cutoff = nowMs() - MAX_REPORT_AGE_MS
  const expired = reports.filter((report) => Number(report.createdAt || 0) < cutoff).map((report) => report.id)
  const remaining = reports.filter((report) => Number(report.createdAt || 0) >= cutoff)
  const overflow = remaining.length > MAX_REPORTS ? remaining.slice(0, remaining.length - MAX_REPORTS).map((report) => report.id) : []
  await idbDelete([...new Set([...expired, ...overflow])])
}

async function storeReport(report) {
  try {
    await idbPut(report)
    await pruneIdb()
    return true
  } catch (_) {
    const reports = fallbackRead().filter((item) => item?.id !== report.id)
    reports.push(report)
    const cutoff = nowMs() - MAX_REPORT_AGE_MS
    return fallbackWrite(reports.filter((item) => Number(item?.createdAt || 0) >= cutoff).slice(-MAX_REPORTS))
  }
}

async function readReports() {
  try {
    return await idbAll()
  } catch (_) {
    return fallbackRead()
  }
}

async function deleteReports(ids) {
  try {
    await idbDelete(ids)
  } catch (_) {
    const set = new Set(ids)
    fallbackWrite(fallbackRead().filter((report) => !set.has(report?.id)))
  }
}

async function updateRetry(report) {
  const count = Number(report.retryCount || 0) + 1
  const delay = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** Math.min(count - 1, 10)))
  const updated = {
    ...report,
    retryCount: count,
    nextAttemptAt: nowMs() + delay + Math.floor(Math.random() * 1000)
  }
  await storeReport(updated)
}

function recentlySeen(fingerprint) {
  const now = nowMs()
  for (const [key, at] of recentFingerprints) {
    if (now - at > 15000) recentFingerprints.delete(key)
  }
  const previous = recentFingerprints.get(fingerprint)
  recentFingerprints.set(fingerprint, now)
  return previous != null && now - previous < 3000
}

export async function reportError(error, context = {}) {
  try {
    const report = buildErrorReport(error, context)
    if (recentlySeen(report.fingerprint)) return null
    errorBreadcrumb("error.queued", `${report.kind}:${report.name}`)
    await storeReport(report)
    void flushErrorReports()
    return report.id
  } catch (_) {
    return null
  }
}

export async function flushErrorReports() {
  if (flushPromise) return flushPromise
  const nav = navigatorGlobal()
  if (nav?.onLine === false || typeof fetch !== "function") return false

  flushPromise = (async () => {
    const all = await readReports()
    const due = all
      .filter((report) => report?.id && Number(report.nextAttemptAt || 0) <= nowMs())
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
      .slice(0, MAX_BATCH)
    if (!due.length) return true

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reports: due }),
        keepalive: true
      })
      if (!response.ok) throw new Error(`error report ingest ${response.status}`)
      const body = await response.json().catch(() => ({}))
      const accepted = Array.isArray(body.accepted) ? body.accepted.filter((id) => typeof id === "string") : []
      await deleteReports(accepted)
      const acceptedSet = new Set(accepted)
      await Promise.all(due.filter((report) => !acceptedSet.has(report.id)).map(updateRetry))
      return accepted.length > 0
    } catch (_) {
      await Promise.all(due.map(updateRetry))
      return false
    }
  })().finally(() => { flushPromise = null })

  return flushPromise
}

export function installErrorReporter() {
  if (installed || !browserGlobal()) return
  installed = true
  errorBreadcrumb("reporter.install")

  window.addEventListener("error", (event) => {
    void reportError(event.error || event.message || "Window error", {
      kind: "window.error",
      source: event.filename,
      line: event.lineno,
      column: event.colno
    })
  })

  window.addEventListener("unhandledrejection", (event) => {
    void reportError(event.reason || "Unhandled promise rejection", { kind: "unhandledrejection" })
  })

  window.addEventListener("online", () => {
    errorBreadcrumb("network.online")
    void flushErrorReports()
  })

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      errorBreadcrumb("lifecycle.visible")
      void flushErrorReports()
    }
  })

  setTimeout(() => { void flushErrorReports() }, 800)
}
