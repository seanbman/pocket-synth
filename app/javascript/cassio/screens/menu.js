const AREAS = ["PLAY", "LOOP", "SOUND", "MIX", "PROJECT", "SETTINGS"]

export function renderMenu(state) {
  const idx = state.menuIndex ?? 2
  const items = AREAS.map(
    (name, i) => `<div class="menu-item ${i === idx ? "selected" : ""}">${name}</div>`
  ).join("")
  return `
    <div class="lcd-screen menu-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">MENU</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1</span>
        <span>M2</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="menu-body">
        <div class="menu-list">${items}</div>
        <div class="menu-hint muted">
          HOLD BACK/MENU<br>FROM ANY SCREEN<br>TRANSPORT KEEPS RUNNING<br>WHILE MENU IS OPEN.
        </div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">OPEN</span></div>
        <div><span class="sk">B</span> <span class="green">UP</span></div>
        <div><span class="sk">C</span> <span class="green">DOWN</span></div>
        <div><span class="sk">D</span> <span class="green">CLOSE</span></div>
      </div>
    </div>
  `
}

export { AREAS }
