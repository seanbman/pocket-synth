function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

export function renderProjects(state) {
  const rows = (state.projects || []).map((p, i) => {
    const active = p.id === state.activeProjectId ? " ●" : ""
    const stamp = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase() : ""
    return `<div class="lib-row ${i === state.projectIndex ? "selected" : ""}"><span>${esc(p.name)}${active}</span><span class="muted">${esc(stamp)}</span></div>`
  }).join("") || `<div class="lib-row selected"><span>NO SAVED PROJECTS</span></div>`

  return `
    <div class="lcd-screen project-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">PROJECTS</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>LOCAL ${state.projects?.length || 0}</span>
        <span>${state.activeProjectName ? `ACTIVE ${esc(state.activeProjectName)}` : "UNSAVED SESSION"}</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="edit-body">
        <div class="lib-list">${rows}</div>
        <div class="green">▲▼ SELECT · OK/D OPEN</div>
        <div class="muted">◀ IMPORT · ▶ MANAGE · RECOVERY AUTOSAVE ON</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">NEW</span></div>
        <div><span class="sk">B</span> <span class="green">SAVE</span></div>
        <div><span class="sk">C</span> <span class="green">RENAME</span></div>
        <div><span class="sk">D</span> <span class="green">OPEN</span></div>
      </div>
    </div>
  `
}

export function renderProjectManage(state) {
  const rows = ["SAVE AS…", "DUPLICATE", "EXPORT AUDIO", "DELETE"]
  const list = rows.map((label, i) => `<div class="lib-row ${i === state.projectManageIndex ? "selected" : ""}">${label}</div>`).join("")
  return `
    <div class="lcd-screen project-manage-screen">
      <div class="lcd-status"><span class="pink">BPM ${state.bpm}</span><span class="status-mid">PROJECT MANAGE</span><span class="battery"></span></div>
      <div class="lcd-macros"><span>${esc(state.selectedProjectName || "NO PROJECT")}</span><span></span><span>M3 VOLUME</span></div>
      <div class="edit-body">
        <div class="lib-list">${list}</div>
        <div class="muted">▲▼ ROW · OK · C PROJECT FILE · D BACK</div>
      </div>
      <div class="lcd-soft">
        <div></div><div></div><div><span class="sk">C</span> <span class="green">EXPORT .CASSIO</span></div><div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}

export function renderProjectAudioExport(state) {
  const formats = ["WAV", "MP3", "M4A"]
  const list = formats.map((label, i) => `<div class="lib-row ${i === state.projectAudioFormatIndex ? "selected" : ""}><span>${label}</span><span class="muted">${i === 0 ? "LOSSLESS" : i === 1 ? "SHARE" : "AAC"}</span></div>`).join("")
  const status = state.projectExportBusy ? "RENDERING MASTER…" : "FULL SONG · MASTER MIX"
  return `
    <div class="lcd-screen project-audio-export-screen">
      <div class="lcd-status"><span class="pink">BPM ${state.bpm}</span><span class="status-mid">EXPORT SONG</span><span class="battery"></span></div>
      <div class="lcd-macros"><span>${esc(state.selectedProjectName || "NO PROJECT")}</span><span>${status}</span><span>M3 VOLUME</span></div>
      <div class="edit-body">
        <div class="lib-list">${list}</div>
        <div class="green">▲▼ FORMAT · OK EXPORT</div>
        <div class="muted">METRONOME EXCLUDED · ONE FULL ARRANGEMENT</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">WAV</span></div>
        <div><span class="sk">B</span> <span class="green">MP3</span></div>
        <div><span class="sk">C</span> <span class="green">M4A</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}

export function renderProjectName(state) {
  return `
    <div class="lcd-screen name-screen project-name-screen">
      <div class="lcd-status"><span class="pink">BPM ${state.bpm}</span><span class="status-mid">${esc(state.projectNameTitle || "NAME PROJECT")}</span><span class="battery"></span></div>
      <div class="lcd-macros"><span>DEVICE KEYBOARD</span><span></span><span>ENTER DONE</span></div>
      <div class="name-body">
        <div class="muted">TYPE A PROJECT NAME</div>
        <input id="cassio-project-name-field" class="name-field" type="text" maxlength="18" autocomplete="off" autocapitalize="characters" enterkeyhint="done" inputmode="text" value="${esc(state.projectNameDraft || "")}" />
        <div class="muted" style="margin-top:0.45rem">ENTER / D TO CONFIRM</div>
        <div class="muted">A CANCEL</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">CANCEL</span></div><div></div><div></div><div><span class="sk">D</span> <span class="green">OK</span></div>
      </div>
    </div>
  `
}

export function renderProjectSwitchConfirm(state) {
  return `
    <div class="lcd-screen confirm-screen project-confirm-screen">
      <div class="lcd-status"><span class="pink">BPM ${state.bpm}</span><span class="status-mid">SAVE CURRENT?</span><span class="battery"></span></div>
      <div class="lcd-macros"><span>${esc(state.activeProjectName || "CURRENT SESSION")}</span><span></span><span>M3 VOLUME</span></div>
      <div class="confirm-body">
        <div class="sound-name">SWITCH PROJECT</div>
        <div>Save current project before leaving?</div>
        <div class="muted">C DISCARD · D SAVE + CONTINUE</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">CANCEL</span></div><div></div><div><span class="sk">C</span> <span class="green">DISCARD</span></div><div><span class="sk">D</span> <span class="green">SAVE</span></div>
      </div>
    </div>
  `
}
