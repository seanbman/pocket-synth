export function renderPlay(state) {
  const sound = state.sound?.name || "GLASS POLY"
  const m1 = state.sound?.macros?.m1?.label || "TONE"
  const m2 = state.sound?.macros?.m2?.label || "FX"
  const hold = state.hold ? "ON" : "OFF"
  const transport = state.playing ? "PLAY" : state.recording ? "REC" : ""
  const root = state.root || state.sound?.root || "C3"
  const voice = (state.sound?.voice || "poly").toUpperCase()
  const keyPc = String(root).replace(/-?\d+$/, "") || "C"
  return `
    <div class="lcd-screen play-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">${transport}</span>
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
        <div class="play-meta"><span class="green">KEY ${keyPc}</span> <span class="green">ROOT ${root}</span> <span class="muted">HOLD ${hold}</span></div>
        <div class="play-meta muted">◀▶ KEY &nbsp; ▲▼ ROOT OCT &nbsp; ${state.padBank || "PADS"}</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">OCT -</span></div>
        <div><span class="sk">B</span> <span class="green">OCT +</span></div>
        <div><span class="sk">C</span> <span class="green">HOLD</span></div>
        <div><span class="sk">D</span> <span class="green">LIBRARY</span></div>
      </div>
    </div>
  `
}
