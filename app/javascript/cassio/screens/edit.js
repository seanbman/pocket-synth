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

const SYNTH_PAGES = {
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

const DRUM_PAGES = {
  "edit-drum-tone": {
    title: "TONE",
    m1: "TONE",
    m2: "TUNE",
    soft: "TONE",
    body(p) {
      return meter("TONE", meterPct(p.tone ?? 0.5), p.tone ?? 0.5)
        + meter("TUNE", meterPct(p.tuning ?? 0.5), p.tuning ?? 0.5)
        + `<div class="muted edit-hint">M1 COLOR / PITCH CHARACTER<br>M2 TUNING (±OCT) · HIT PAD</div>`
    }
  },
  "edit-drum-decay": {
    title: "DECAY",
    m1: "DECAY",
    m2: "NOISE",
    soft: "DECAY",
    body(p) {
      return meter("DECAY", meterPct(p.decay ?? 0.4), p.decay ?? 0.4)
        + meter("NOISE", meterPct(p.noise ?? 0.5), p.noise ?? 0.5)
        + `<div class="muted edit-hint">M1 LENGTH · M2 NOISE / AIR<br>HIT PAD TO AUDITION</div>`
    }
  },
  "edit-drum-snap": {
    title: "SNAP",
    m1: "SNAP",
    m2: "DRIVE",
    soft: "SNAP",
    body(p) {
      return meter("SNAP", meterPct(p.snap ?? 0.55), p.snap ?? 0.55)
        + meter("DRIVE", meterPct(p.drive ?? 0.1), p.drive ?? 0.1)
        + `<div class="muted edit-hint">M1 CLICK / CRACK · M2 DRIVE<br>WORKS ON ALL DRUM TYPES</div>`
    }
  },
  "edit-drum-fx": {
    title: "FX",
    m1: "ROOM",
    m2: "DELAY",
    soft: "FX",
    body(p) {
      return meter("ROOM", meterPct(p.reverb ?? 0), p.reverb ?? 0)
        + meter("DELAY", meterPct(p.delay ?? 0), p.delay ?? 0)
        + `<div class="muted edit-hint">M1 PER-HIT REVERB · M2 PER-HIT DELAY<br>DRIVE LIVES ON SNAP</div>`
    }
  }
}

export function renderEdit(state) {
  const drum = state.focusSound?.voice === "drum" || state.sound?.voice === "drum"
  const pages = drum ? DRUM_PAGES : SYNTH_PAGES
  const page = pages[state.screen] || (drum ? DRUM_PAGES["edit-drum-tone"] : SYNTH_PAGES["edit-shape"])
  const p = state.editPatch || {}
  const name = state.focusSound?.name || state.sound?.name || "SOUND"
  const softs = drum
    ? [
        ["edit-drum-tone", "A", "TONE"],
        ["edit-drum-decay", "B", "DECAY"],
        ["edit-drum-snap", "C", "SNAP"],
        ["edit-drum-fx", "D", "FX"]
      ]
    : [
        ["edit-shape", "A", "SHAPE"],
        ["edit-env", "B", "ENV"],
        ["edit-eq", "C", "EQ"],
        ["edit-fx", "D", "FX"]
      ]
  const softHtml = softs.map(([id, sk, label]) =>
    `<div class="${state.screen === id ? "soft-active" : ""}"><span class="sk">${sk}</span> <span class="green">${label}</span></div>`
  ).join("")

  return `
    <div class="lcd-screen edit-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">${drum ? "DRUM EDIT" : "SOUND EDIT"}</span>
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
      <div class="lcd-soft">${softHtml}</div>
    </div>
  `
}
