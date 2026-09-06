import { knobParamsAt, renderMacroLabels, renderSettingsRows } from "cassio/screens/settings_list"
import { QUANTIZE_LABELS } from "cassio/store"

export const LOOP_BAR_WIDTH_PX = 52

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

function renderBarGrid(timelineBars, timelineW, beatsPerBar = 4) {
  let html = ""
  for (let bar = 0; bar < timelineBars; bar++) {
    const barLeft = (bar / timelineBars) * timelineW
    html += `<div class="loop-bar-mark downbeat" style="left:${barLeft}px"></div>`
    for (let beat = 1; beat < beatsPerBar; beat++) {
      const beatLeft = barLeft + (beat / beatsPerBar / timelineBars) * timelineW
      html += `<div class="loop-bar-mark beat" style="left:${beatLeft}px"></div>`
    }
  }
  return html
}

function renderBarRuler(timelineBars, timelineW) {
  return Array.from({ length: timelineBars }, (_, i) => {
    const left = ((i + 0.5) / timelineBars) * timelineW
    return `<span class="loop-bar-label" style="left:${left}px">${i + 1}</span>`
  }).join("")
}

export function renderLoopTrackView(state) {
  const loop = state.loop || {}
  const tracks = loop.tracks || []
  const sel = loop.selected || 1
  const transport = state.recording ? "● REC" : state.countingIn ? "COUNT" : state.playing ? "▶ PLAY" : "LOOP"
  const metro = state.metroOn ? "METRO" : ""
  const defaultBars = loop.lengthBars || 4
  const timelineBars = loop.timelineBars || defaultBars
  const beatsPerBar = loop.beatsPerBar || 4
  const timelineSec = loop.timelineSec || timelineBars * 2
  const timelineW = timelineBars * LOOP_BAR_WIDTH_PX
  const playheadSec = loop.playheadSec ?? 0
  const playheadPx = timelineSec > 0 ? (playheadSec / timelineSec) * timelineW : 0
  const q = QUANTIZE_LABELS[loop.quantize] || loop.quantize || "1/16"
  const pdr = loop.playDuringRec || "all"
  const monLabel = pdr === "all" ? "ALL" : pdr === "monitored" ? "MON" : "OFF"
  const selTrack = tracks.find((t) => t.id === sel) || {}
  const selOff = Math.round(selTrack.offsetSec ?? 0)
  const barGrid = renderBarGrid(timelineBars, timelineW, beatsPerBar)
  const barMeta = timelineBars > defaultBars
    ? `${defaultBars}+${timelineBars - defaultBars}B`
    : `${timelineBars}B`

  const clipTone = (id) => (id % 2 === 1 ? "a" : "b")
  const rows = tracks.map((t) => {
    const assigned = t.assigned !== false && t.assigned !== undefined
      ? !!t.assigned
      : true
    const empty = t.empty || !assigned
    const off = t.offsetSec ?? 0
    const offPx = timelineSec > 0 ? (off / timelineSec) * timelineW : 0
    const trackBars = t.lengthBars || timelineBars
    const clipW = Math.max(8, (trackBars / timelineBars) * timelineW - 2)
    const hasClip = !empty && (t.hasClip || t.buffer || t.hasSeq)
    const flags = [
      t.dirty ? "●" : "",
      t.mute ? "M" : t.solo ? "S" : "",
      t.armed ? "A" : "",
      empty ? "○" : ""
    ].filter(Boolean).join("")
    const label = empty
      ? "EMPTY"
      : esc(String(t.name || `TRACK ${t.id}`).slice(0, 12))
    const clip = hasClip
      ? `<div class="loop-clip tone-${clipTone(t.id)}${t.hasSeq && !t.buffer ? " seq" : ""}" data-track-id="${t.id}" style="left:${offPx}px;width:${clipW}px"></div>`
      : ""
    return `
      <div class="loop-trow ${t.id === sel ? "sel" : ""} ${empty ? "empty" : ""}" data-track-id="${t.id}">
        <div class="loop-tlabel">${t.id} ${label}${flags ? ` <span class="muted">${flags}</span>` : ""}</div>
        <div class="loop-lane" style="width:${timelineW}px">
          ${barGrid}
          ${clip}
          <div class="loop-ph" style="left:${playheadPx}px"></div>
        </div>
      </div>`
  }).join("")

  const selEmpty = !!(selTrack.empty || selTrack.assigned === false)
  const hintOk = selEmpty ? "OK→TRACK LIST" : "OK→TRK MENU"
  const softD = selEmpty ? "LIST" : (selTrack.dirty ? "SAVE" : "UNDO")

  return `
    <div class="lcd-screen loop-track-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">LOOP${transport !== "LOOP" ? ` · ${transport}` : ""}${metro ? ` · ${metro}` : ""}</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span class="green">M1 TRACK ${selEmpty ? "—" : `${Math.round((selTrack.level ?? 1) * 100)}%`}</span>
        <span class="green">M2 PAN ${selEmpty ? "—" : Math.round((selTrack.pan ?? 0) * 100)}</span>
        <span class="green">M3 MASTER</span>
      </div>
      <div class="loop-timeline-body">
        <div class="pink loop-tmeta">${barMeta}/${beatsPerBar} · Q ${q} · MON ${monLabel} · ${esc(state.playhead || "1:1")}</div>
        <div class="loop-timeline-scroll" data-loop-scroll style="--loop-timeline-w:${timelineW}px">
          <div class="loop-ruler-row">
            <div class="loop-tlabel loop-tlabel-spacer"></div>
            <div class="loop-ruler" style="width:${timelineW}px">
              ${renderBarRuler(timelineBars, timelineW)}
              ${barGrid}
            </div>
          </div>
          <div class="loop-tgrid">${rows}</div>
        </div>
        <div class="green loop-thint">PATTERN SEQUENCER · HOLD B</div>
        <div class="muted loop-thint">TAP ROW · ▲▼ LANE · ◀▶ ±1s · L${sel}${selEmpty ? "" : ` @ ${selOff}s`}</div>
        <div class="lib-hint">${hintOk} · HOLD C OPTIONS</div>
        <div class="lib-hint muted">REC · PIANO → TRACK · A +LANE · HOLD A −LANE · ${selEmpty ? "D LIST" : "D SAVE/UNDO"} · B MUTE · C SOLO</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">+LANE</span></div>
        <div><span class="sk">B</span> <span class="green">MUTE/SEQ${selTrack.mute ? " ●" : ""}</span></div>
        <div><span class="sk">C</span> <span class="green">SOLO${selTrack.solo ? " ●" : ""}</span></div>
        <div><span class="sk">D</span> <span class="green">${softD}</span></div>
      </div>
    </div>
  `
}

export function renderLoopTrackMenu(state) {
  const t = (state.loop?.tracks || []).find((x) => x.id === (state.loop?.selected || 1)) || {}
  const empty = !!(t.empty || t.assigned === false)
  const row = state.loopMenuIndex || 0
  const letter = state.seqCurrent || "A"
  const rows = empty
    ? [
      "PICK TRACK…",
      `DROP PATTERN ${letter}…`,
      "PATTERN SEQUENCER…",
      "+ LANE",
      "DELETE LANE",
      "TRACK LIST…",
      "LOOP OPTIONS…"
    ]
    : [
      "PATTERN SEQUENCER…",
      `DROP PATTERN ${letter}…`,
      "FX / SETTINGS…",
      `LENGTH ${t.lengthBars || state.loop?.lengthBars || 4} BARS`,
      `RECORD ${t.mode === "replace" ? "REPLACE" : "OVERDUB"}`,
      `MONITOR ${t.monitor ? "ON" : "OFF"}`,
      `MUTE ${t.mute ? "ON" : "OFF"}`,
      `SOLO ${t.solo ? "ON" : "OFF"}`,
      "SAVE TO LIBRARY…",
      "REPLACE FROM LIST…",
      "MIXER…",
      "LOOP OPTIONS…",
      "+ LANE",
      "DELETE LANE",
      "CLEAR AUDIO…",
      "UNASSIGN LANE…"
    ]
  const list = rows.map((label, i) =>
    `<div class="lib-row ${i === row ? "selected" : ""}">${esc(label)}</div>`
  ).join("")

  return `
    <div class="lcd-screen loop-menu-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">LANE ${t.id || 1} MENU${t.dirty ? " · ●" : ""}</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span class="green">M1 TRACK LVL</span>
        <span class="green">M2 TRACK PAN</span>
        <span class="green">M3 MASTER</span>
      </div>
      <div class="edit-body">
        <div class="sound-name">${esc(empty ? "EMPTY LANE" : (t.name || "TRACK"))}</div>
        <div class="lib-list">${list}</div>
        <div class="muted">▲▼ ROW · OK · D BACK</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">${empty ? "PICK" : "MODE"}</span></div>
        <div><span class="sk">B</span> <span class="green">${empty ? "—" : "MONITOR"}</span></div>
        <div><span class="sk">C</span> <span class="green">${empty ? "—" : "CLEAR"}</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}

const OPTION_ROWS = ["patternSeq", "length", "quantize", "countIn", "playDuringRec", "metroOn", "metroLevel", "metroAccent", "tempo"]
const PLAY_DURING_LABELS = { all: "ALL", monitored: "MONITORED", off: "OFF" }
const PLAY_DURING_HINT = "ALL / MONITORED / OFF CONTROLS BACKING TRACKS"

export function renderLoopOptions(state) {
  const loop = state.loop || {}
  const row = state.loopOptIndex || 0
  const key = OPTION_ROWS[row] || "length"
  const pdr = loop.playDuringRec || "all"
  const labels = {
    patternSeq: "PATTERN SEQUENCER (6 LANES · A–D)…",
    length: `SONG LENGTH ${loop.lengthBars || 4} BARS`,
    quantize: `QUANTIZE ${QUANTIZE_LABELS[loop.quantize] || loop.quantize || "1/16"}`,
    countIn: `COUNT-IN ${loop.countInBars ?? 1} BAR`,
    playDuringRec: `PLAY DURING REC ${PLAY_DURING_LABELS[pdr] || "ALL"}`,
    metroOn: `METRO ${state.metroOn ? "ON" : "OFF"}`,
    metroLevel: `METRO LVL ${Math.round((state.metroLevel ?? 0.7) * 100)}%`,
    metroAccent: `ACCENT BEAT1 ${state.metroAccent !== false ? "ON" : "OFF"}`,
    tempo: `TEMPO ${state.bpm} BPM`
  }
  const list = OPTION_ROWS.map((k, i) =>
    `<div class="lib-row ${i === row ? "selected" : ""}">${esc(labels[k])}</div>`
  ).join("")

  return `
    <div class="lcd-screen loop-options-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">LOOP OPTIONS</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span class="green">${key === "metroLevel" ? "M1 LEVEL" : key === "tempo" ? "M1 TEMPO" : "M1 —"}</span>
        <span>M2 —</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="edit-body">
        <div class="sound-name">OPTIONS</div>
        <div class="lib-list">${list}</div>
        <div class="green">${key === "playDuringRec" ? PLAY_DURING_HINT : key === "patternSeq" ? "OK OPEN · PAD SOUNDS · SONG-LEVEL PATTERNS" : "▲▼ SELECT · ◀▶ CHANGE"}</div>
        <div class="muted">${key === "playDuringRec" ? "" : "METRO ALSO: HOLD TAP ON PLAY"}</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">SEQ</span></div>
        <div><span class="sk">B</span> <span class="green">LENGTH</span></div>
        <div><span class="sk">C</span> <span class="green">MONITOR</span></div>
        <div><span class="sk">D</span> <span class="green">DONE</span></div>
      </div>
    </div>
  `
}

export function renderLoopFx(state) {
  const loop = state.loop || {}
  const t = (loop.tracks || []).find((x) => x.id === (loop.selected || 1)) || {}
  const rows = state.loopFxRows || []
  const idx = state.loopFxIndex || 0
  const cur = rows[idx]
  const values = { ...(t.fx || {}), level: t.level ?? 1, pan: t.pan ?? 0 }
  const groupLabel = cur ? (cur.kind === "group" ? cur.label : (rows.find((r) => r.kind === "group" && r.id === cur.group)?.label || "")) : ""
  const knobs = knobParamsAt(rows, idx)
  return `
    <div class="lcd-screen loop-fx-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">TRK ${t.id || 1} · ${esc(groupLabel)}</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        ${renderMacroLabels(knobs, values)}
      </div>
      <div class="edit-body settings-body">
        <div class="sound-name">${esc(t.name || "TRACK")} <span class="muted">${t.buffer ? "●" : "○"} ${t.lengthBars || 4}B</span></div>
        <div class="lib-list settings-list">${renderSettingsRows(rows, idx, values, { visible: 7 })}</div>
        <div class="muted">▲▼ ROW · OK OPEN/CLOSE · ◀▶ CHANGE · KNOBS FOLLOW</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">TRK +</span></div>
        <div><span class="sk">B</span> <span class="green">TRK −</span></div>
        <div><span class="sk">C</span> <span class="green">RESET</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}

export { OPTION_ROWS }
