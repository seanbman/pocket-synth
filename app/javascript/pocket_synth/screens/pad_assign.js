function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

export function renderPadAssign(state) {
  const pads = state.pads || []
  const sel = state.padSelect || 1
  const kitEdit = state.kitEditMode
  const assignName = kitEdit
    ? (state.kitFocus?.name || state.focusSound?.name || state.padBank || "KIT")
    : (state.focusSound?.name || state.sound?.name || "SOUND")
  const nameFor = (id) => {
    if (!id) return "EMPTY"
    const f = state.factorySounds?.find((s) => s.id === id)
    if (f) return f.name
    const u = state.userSounds?.find((s) => s.id === id)
    return u?.name || id.toUpperCase()
  }

  const cells = [1, 2, 3, 4, 5, 6].map((n) => {
    const p = pads.find((x) => x.pad === n) || { soundId: null }
    const label = nameFor(p.soundId)
    return `<div class="pad-cell ${n === sel ? "selected" : ""}">
      <div class="pad-cell-num">PAD ${n}</div>
      <div class="pad-cell-name">${esc(label)}</div>
    </div>`
  }).join("")

  const softs = kitEdit
    ? `<div><span class="sk">A</span> <span class="green">CLEAR</span></div>
        <div><span class="sk">B</span> <span class="green">SOUND</span></div>
        <div><span class="sk">C</span> <span class="green">EDIT</span></div>
        <div><span class="sk">D</span> <span class="green">DONE</span></div>`
    : `<div><span class="sk">A</span> <span class="green">CLEAR</span></div>
        <div><span class="sk">B</span> <span class="green">MODE</span></div>
        <div><span class="sk">C</span> <span class="green">PREVIEW</span></div>
        <div><span class="sk">D</span> <span class="green">DONE</span></div>`

  return `
    <div class="lcd-screen pad-assign-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">${kitEdit ? "KIT EDIT" : "PAD ASSIGN"}</span>
        <span class="battery" title="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 PAD LEVEL</span>
        <span>M2 PAD PAN</span>
        <span>${kitEdit ? "M3 KIT VOL" : "M3 PAD VOL"}</span>
      </div>
      <div class="pad-assign-body">
        <div class="sound-name">${kitEdit ? "EDIT:" : "ASSIGN:"} ${esc(assignName)}</div>
        <div class="pad-grid">${cells}</div>
        <div class="muted">${kitEdit
          ? (state.kitDirty
            ? `DIRTY · KIT ${Math.round((state.kitVolume ?? 1) * 100)}% · D SAVES`
            : "B REPLACE · OK/C EDIT · M1 LVL M2 PAN M3 KIT")
          : "M1 LEVEL · M2 PAN · M3 PAD VOL"}</div>
      </div>
      <div class="lcd-soft">${softs}</div>
    </div>
  `
}
