function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

/** Name entry using device keyboard (visible field on LCD). */
export function renderNameEntry(state) {
  const val = state.nameDraft ?? state.saveName ?? ""
  return `
    <div class="lcd-screen name-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">NAME SOUND</span>
        <span class="battery" title="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>DEVICE KEYBOARD</span>
        <span></span>
        <span>ENTER DONE</span>
      </div>
      <div class="name-body">
        <div class="muted">TYPE A NAME</div>
        <input
          id="cassio-name-field"
          class="name-field"
          type="text"
          maxlength="18"
          autocomplete="off"
          autocapitalize="characters"
          enterkeyhint="done"
          inputmode="text"
          value="${esc(val)}"
        />
        <div class="muted" style="margin-top:0.45rem">ENTER / DONE TO CONFIRM</div>
        <div class="muted">A CANCEL</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">CANCEL</span></div>
        <div></div>
        <div></div>
        <div><span class="sk">D</span> <span class="green">OK</span></div>
      </div>
    </div>
  `
}
