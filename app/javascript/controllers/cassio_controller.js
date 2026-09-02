import { Controller } from "@hotwired/stimulus"
import { CassioApp } from "cassio/app"

const DBG = (location, message, data = {}, hypothesisId = "A") => {
  // #region agent log
  const body = JSON.stringify({
    sessionId: "397b28",
    runId: "crash-1",
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now()
  })
  fetch("http://127.0.0.1:7775/ingest/fa1177f6-1e5b-449a-b03a-5969bd555f1e", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "397b28" },
    body
  }).catch(() => {})
  // Same-origin fallback for phone/LAN (can't reach host 127.0.0.1)
  fetch("/debug_ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true
  }).catch(() => {})
  // #endregion
}

export default class extends Controller {
  connect() {
    // #region agent log
    if (!window.__cassioDbgHooks) {
      window.__cassioDbgHooks = true
      window.addEventListener("error", (e) => {
        DBG("window.error", "uncaught error", {
          message: String(e.message || e.error?.message || e),
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          stack: String(e.error?.stack || "").slice(0, 800)
        }, "A")
      })
      window.addEventListener("unhandledrejection", (e) => {
        const r = e.reason
        DBG("window.unhandledrejection", "unhandled rejection", {
          message: String(r?.message || r),
          stack: String(r?.stack || "").slice(0, 800),
          name: r?.name
        }, "A")
      })
      window.addEventListener("pagehide", (e) => {
        DBG("window.pagehide", "page hiding", { persisted: !!e.persisted }, "E")
      })
      document.addEventListener("visibilitychange", () => {
        DBG("visibilitychange", "visibility", { state: document.visibilityState }, "E")
      })
      DBG("cassio_controller", "hooks installed", {
        href: location.href,
        ua: navigator.userAgent.slice(0, 120),
        mem: performance?.memory ? {
          usedMB: Math.round(performance.memory.usedJSHeapSize / 1e6),
          totalMB: Math.round(performance.memory.totalJSHeapSize / 1e6)
        } : null
      }, "D")
    }
    // #endregion
    try {
      this.app = new CassioApp(this.element)
      window.addEventListener("pagehide", () => this.app?.flushPersist?.())
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.app?.flushPersist?.()
      })
      DBG("cassio_controller.connect", "CassioApp constructed", { ok: true }, "D")
    } catch (err) {
      DBG("cassio_controller.connect", "CassioApp construct FAILED", {
        message: String(err?.message || err),
        stack: String(err?.stack || "").slice(0, 800)
      }, "D")
      throw err
    }
  }
}
