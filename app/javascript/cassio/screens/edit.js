import { meterPct, dbLabel } from "cassio/patch"

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

function meter(label, pctText, fill01) {
  const w = Math.round(Math.min(1, Math.max(0, fill01)) * 100)
  return `
    <div class="edit-meter">
      <div class="pink">${esc(label)}</div>
      <div class="meter-track"><div class="meter-fill" style="width:${w}%"></div></div>
      <div class="meter-val">${esc(pctText)}</div>
    </div>`
}

const PAGES = {
  "edit-shape": {
    title: "SHAPE",
    m1: "CUTOFF",
    m2: "RESONANCE",
    soft: "SHAPE",
    body(p) {
      return meter("CUTOFF", meterPct(p.brightness), p.brightness)
        + meter("RESONANCE", meterPct(p.resonance), p.resonance)
        + `<div class="muted edit-hint">ARROWS: VOICE MODE / DRIVE<br>BACK: SAVE OR DISCARD</div>`
    }
  },
  "edit-env": {
    title: "ENV",
    m1: "ATTACK",
    m2: "RELEASE",
    soft: "ENV",
    body(p) {
      const a = Math.min(1, p.attack / 1.2)
      const r = Math.min(1, p.release / 2.5)
      return meter("ATTACK", meterPct(a), a)
        + meter("RELEASE", meterPct(r), r)
        + `<div class="muted edit-hint">BACK: SAVE OR DISCARD</div>`
    }
  },
  "edit-eq": {
    title: "EQ",
    m1: "BASS",
    m2: "TREBLE",
    soft: "EQ",
    body(p) {
      const b = (p.bassDb + 12) / 24
      const t = (p.trebleDb + 12) / 24
      return meter("BASS", dbLabel(p.bassDb), b)
        + meter("TREBLE", dbLabel(p.trebleDb), t)
        + `<div class="muted edit-hint">OK: RESET SELECTED BAND<br>BACK: SAVE OR DISCARD</div>`
    }
  },
  "edit-fx": {
    title: "FX",
    m1: "REVERB",
    m2: "DELAY",
    soft: "FX",
    body(p) {
      return meter("REVERB", meterPct(p.reverb), p.reverb)
        + meter("DELAY", meterPct(p.delay), p.delay)
        + `<div class="muted edit-hint">BACK: SAVE OR DISCARD</div>`
    }
  }
}

export function renderEdit(state) {
  const page = PAGES[state.screen] || PAGES["edit-shape"]
  const p = state.editPatch || {}
  const name = state.focusSound?.name || state.sound?.name || "SOUND"
  const softs = [
    ["edit-shape", "A", "SHAPE"],
    ["edit-env", "B", "ENV"],
    ["edit-eq", "C", "EQ"],
    ["edit-fx", "D", "FX"]
  ].map(([id, sk, label]) =>
    `<div class="${state.screen === id ? "soft-active" : ""}"><span class="sk">${sk}</span> <span class="green">${label}</span></div>`
  ).join("")

  return `
    <div class="lcd-screen edit-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">SOUND EDIT</span>
        <span class="battery" title="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 ${page.m1}</span>
        <span>M2 ${page.m2}</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="edit-body">
        <div class="sound-name">${esc(name)} / ${page.title}</div>
        ${page.body(p)}
      </div>
      <div class="lcd-soft">${softs}</div>
    </div>
  `
}
