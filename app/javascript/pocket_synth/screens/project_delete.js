function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

export function renderProjectDeleteConfirm(state) {
  return `
    <div class="lcd-screen confirm-screen project-delete-screen">
      <div class="lcd-status"><span class="pink">BPM ${state.bpm}</span><span class="status-mid">DELETE PROJECT</span><span class="battery"></span></div>
      <div class="lcd-macros"><span>${esc(state.selectedProjectName || "PROJECT")}</span><span></span><span>M3 VOLUME</span></div>
      <div class="confirm-body">
        <div class="sound-name">DELETE SAVED PROJECT?</div>
        <div>This removes the saved copy only.</div>
        <div class="muted">A CANCEL · D DELETE</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">CANCEL</span></div><div></div><div></div><div><span class="sk">D</span> <span class="green">DELETE</span></div>
      </div>
    </div>
  `
}
