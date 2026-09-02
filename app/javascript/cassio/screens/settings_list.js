import { FX_GROUPS, fmtFx, fxKnob01 } from "cassio/audio/fx_params"

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

/**
 * Collapsible settings list shared by SAMPLE EDIT and TRACK FX.
 * rows: [{kind:"group", id, label, params, open}] + [{kind:"param", p, group}]
 * Knobs follow the cursor: on a group header → first 3 params of the group;
 * on a param → that param and the next two in the same group (actions skipped).
 */
export function buildSettingsRows(scope, expanded = new Set()) {
  const flag = scope === "track" ? "t" : "s"
  const rows = []
  for (const g of FX_GROUPS) {
    const params = g.params.filter((p) => p.scope.includes(flag))
    if (!params.length) continue
    const open = expanded.has(g.id)
    rows.push({ kind: "group", id: g.id, label: g.label, params, open })
    if (open) for (const p of params) rows.push({ kind: "param", p, group: g.id })
  }
  return rows
}

export function knobParamsAt(rows, idx) {
  const row = rows[idx]
  if (!row) return []
  const knobbable = (p) => p.type !== "action"
  if (row.kind === "group") return row.params.filter(knobbable).slice(0, 3)
  const out = []
  for (let i = idx; i < rows.length && out.length < 3; i++) {
    const r = rows[i]
    if (r.kind !== "param" || r.group !== row.group) break
    if (knobbable(r.p)) out.push(r.p)
  }
  return out
}

export function renderMacroLabels(knobs, values) {
  const cells = [0, 1, 2].map((i) => {
    const p = knobs[i]
    if (!p) return `<span>M${i + 1} —</span>`
    return `<span class="green">M${i + 1} ${esc(p.label)} ${esc(fmtFx(p, values[p.key] ?? p.def))}</span>`
  })
  return cells.join("")
}

export function renderSettingsRows(rows, idx, values, { visible = 6 } = {}) {
  const n = rows.length
  let from = Math.max(0, Math.min(idx - Math.floor(visible / 2), n - visible))
  if (from < 0) from = 0
  const to = Math.min(n, from + visible)
  const out = []
  for (let i = from; i < to; i++) {
    const r = rows[i]
    const sel = i === idx ? "selected" : ""
    if (r.kind === "group") {
      out.push(`<div class="lib-row settings-group ${sel}">${r.open ? "▼" : "▶"} ${esc(r.label)}</div>`)
    } else {
      const p = r.p
      const v = values[p.key] ?? p.def
      const pos = Math.round(fxKnob01(p, v) * 100)
      const bar = p.type === "num" ? `<span class="settings-bar"><span style="width:${pos}%"></span></span>` : ""
      out.push(`<div class="lib-row settings-param ${sel}"><span class="settings-label">${esc(p.label)}</span>${bar}<span class="settings-val">${esc(fmtFx(p, v))}</span></div>`)
    }
  }
  if (from > 0) out.unshift(`<div class="muted settings-more">▲ ${from} MORE</div>`)
  if (to < n) out.push(`<div class="muted settings-more">▼ ${n - to} MORE</div>`)
  return out.join("")
}
