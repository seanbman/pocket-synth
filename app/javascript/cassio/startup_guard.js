const STARTUP_BG = "#050505"

function errorText(error) {
  const raw = String(error?.message || error || "UNKNOWN STARTUP ERROR").trim()
  return raw.slice(0, 180) || "UNKNOWN STARTUP ERROR"
}

export function showStartupFailure(root, error, { reload = () => window.location.reload() } = {}) {
  document.documentElement.style.background = STARTUP_BG
  if (document.body) document.body.style.background = STARTUP_BG
  root?.setAttribute?.("data-cassio-startup-error", "true")

  let panel = document.getElementById("cassio-bootstrap-error")
  if (!panel) {
    panel = document.createElement("div")
    panel.id = "cassio-bootstrap-error"
    panel.setAttribute("role", "alert")
    Object.assign(panel.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "0.65rem",
      padding: "1.5rem",
      boxSizing: "border-box",
      background: STARTUP_BG,
      color: "#eeeeee",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      textAlign: "center"
    })
    document.body?.appendChild(panel)
  }

  panel.replaceChildren()
  const title = document.createElement("div")
  title.textContent = "CASSIO"
  title.style.fontWeight = "800"
  title.style.fontSize = "2rem"
  title.style.letterSpacing = "0.14em"

  const status = document.createElement("div")
  status.textContent = "STARTUP ERROR"
  status.style.color = "#ff2e7e"
  status.style.fontWeight = "700"
  status.style.letterSpacing = "0.12em"

  const detail = document.createElement("div")
  detail.textContent = errorText(error).toUpperCase()
  detail.style.maxWidth = "34rem"
  detail.style.color = "#9c9c9c"
  detail.style.fontSize = "0.78rem"

  const retry = document.createElement("button")
  retry.type = "button"
  retry.textContent = "RELOAD CASSIO"
  retry.style.padding = "0.55rem 0.8rem"
  retry.style.border = "1px solid #39ff14"
  retry.style.background = "#0b0b0b"
  retry.style.color = "#39ff14"
  retry.style.font = "inherit"
  retry.style.fontWeight = "700"
  retry.addEventListener("click", () => reload(), { once: true })

  panel.append(title, status, detail, retry)
  return panel
}
