function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

export function renderConfirm(state) {
  const title = state.confirmTitle || "CONFIRM"
  const lines = state.confirmLines || []
  return `
    <div class="lcd-screen confirm-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">CONFIRM</span>
        <span class="battery" title="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 —</span>
        <span>M2 —</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="confirm-body">
        <div class="sound-name pink">${esc(title)}</div>
        ${lines.map((l) => `<div class="${l.tone || "muted"}">${esc(l.text)}</div>`).join("")}
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">${esc(state.confirmAction === "discard-sample" ? "KEEP" : "CANCEL")}</span></div>
        <div></div>
        <div></div>
        <div><span class="sk">D</span> <span class="green">${esc(state.confirmOkLabel || "DELETE")}</span></div>
      </div>
    </div>
  `
}
