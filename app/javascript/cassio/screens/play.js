export function renderPlay(state) {
  const sound = state.sound?.name || "GLASS POLY"
  const m1 = state.sound?.macros?.m1?.label || "TONE"
  const m2 = state.sound?.macros?.m2?.label || "FX"
  const hold = state.hold ? "ON" : "OFF"
  const holdClass = state.hold ? "hold-state on" : "hold-state muted"
  const metroOn = !!state.metroOn
  const metro = metroOn ? "ON" : "OFF"
  const metroLvl = Math.round((state.metroLevel ?? 0.7) * 100)
  const focusMetro = state.playNavFocus === "metro"
  const transport = state.recording
    ? "● REC"
    : state.countingIn
      ? "COUNT"
      : state.playing
        ? "▶ PLAY"
        : ""
  const root = state.root || state.sound?.root || "C3"
  const voice = (state.sound?.voice || "poly").toUpperCase()
  const keyPc = String(root).replace(/-?\d+$/, "") || "C"
  const midBits = [transport]
  if (metroOn) midBits.push("METRO")
  if (focusMetro) midBits.push("EDIT LVL")
  const mid = midBits.filter(Boolean).join(" · ")
  return `
    <div class="lcd-screen play-screen">
      <div class="lcd-status">
        <span class="pink bpm-readout">BPM ${state.bpm}</span>
        <span class="status-mid">${mid || "PLAY"}</span>
        <span class="battery" title="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 ${m1}</span>
        <span>M2 ${m2}</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="play-body">
        <div class="muted">SOUND</div>
        <div class="sound-name">${sound}</div>
        <div class="play-meta"><span class="green">OCT ${state.octave}</span> <span class="green">VOICE ${voice}</span></div>
        <canvas class="viz-wave" data-viz-wave width="256" height="48" aria-hidden="true"></canvas>
        <div class="play-meta"><span class="green">KEY ${keyPc}</span> <span class="${focusMetro ? "muted" : "green"}">ROOT ${root}</span> <span class="${holdClass}">HOLD ${hold}</span></div>
        <div class="play-meta"><span class="${focusMetro ? "green" : "muted"}">METRO ${metro} ${metroLvl}%</span></div>
        <div class="play-meta muted">${focusMetro
          ? "OK · ROOT  ·  ▲▼ LEVEL  ·  ◀▶ ON/OFF  ·  HOLD TAP · TOGGLE"
          : "OK · METRO  ·  ▲▼ ROOT OCT  ·  HOLD TAP · METRO"}</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">OCT -</span></div>
        <div><span class="sk">B</span> <span class="green">OCT +</span></div>
        <div><span class="sk">C</span> <span class="${state.hold ? "pink" : "green"}">${state.hold ? "HOLD ON" : "HOLD"}</span></div>
        <div><span class="sk">D</span> <span class="green">SOUND</span></div>
      </div>
    </div>
  `
}
