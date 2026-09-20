function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

export function renderManage(state) {
  const s = state.focusSound || state.sound
  return `
    <div class="lcd-screen manage-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">SOUND MANAGE</span>
        <span class="battery" title="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 —</span>
        <span>M2 —</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="manage-body">
        <div class="sound-name">${esc(s?.name || "—")}</div>
        <div class="muted">USER SOUND</div>
        <div class="green" style="margin-top:0.5rem">A RENAME · B DUPLICATE</div>
        <div class="green">C DELETE · D BACK</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">RENAME</span></div>
        <div><span class="sk">B</span> <span class="green">DUPLICATE</span></div>
        <div><span class="sk">C</span> <span class="green">DELETE</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}
