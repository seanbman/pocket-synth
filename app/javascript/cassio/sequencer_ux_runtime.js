function textReplace(root, selector, from, to) {
  const el = root?.querySelector?.(selector)
  if (!el) return
  el.textContent = String(el.textContent || "").replace(from, to)
}

function replaceRows(root, screenSelector, replacements) {
  const rows = root?.querySelectorAll?.(`${screenSelector} .lib-row`) || []
  for (const row of rows) {
    let text = String(row.textContent || "")
    for (const [from, to] of replacements) text = text.replace(from, to)
    row.textContent = text
  }
}

function decorateSequencerUi(app) {
  const root = app?.root
  if (!root) return

  if (app.screen === "loop-tracks") {
    const hints = root.querySelectorAll?.(".loop-track-screen .lib-hint") || []
    for (const hint of hints) {
      hint.textContent = String(hint.textContent || "")
        .replace("HOLD B PATTERN", "HOLD B LANE SEQ")
    }
  }

  if (app.screen === "loop-menu") {
    replaceRows(root, ".loop-menu-screen", [
      [/^PATTERN SEQ…$/, "LANE SEQ…"]
    ])
  }

  if (app.screen === "loop-options") {
    replaceRows(root, ".loop-options-screen", [
      [/^PATTERN SEQ \(6 LANES · A–D\)…$/, "PAD PATTERNS (A–D · 6 LANES)…"]
    ])
    textReplace(root, ".loop-options-screen .lcd-soft > div:first-child .green", /^PATTERN$/, "PATTERNS")
  }

  if (app.screen === "sequencer") {
    const status = root.querySelector?.(".sequencer-screen .status-mid")
    if (status) {
      if (app.seqTrackId != null) {
        status.textContent = String(status.textContent || "").replace(/^TRK (\d+) SEQ/, "LANE $1 SEQ")
      } else {
        const letter = app.stepSeq?.seq?.current || "A"
        status.textContent = String(status.textContent || "").replace(/^SEQUENCER/, `PAD PATTERN ${letter}`)
      }
    }
  }
}

/**
 * Makes the two sequencer concepts explicit:
 * - LANE SEQ: per-arrangement-lane sound sequence.
 * - PAD PATTERNS: global six-pad A–D bank.
 *
 * Global PAD PATTERNS open with the pattern header focused so left/right switches
 * A–D immediately; DOWN enters the grid. UP from lane 1 returns to that header.
 */
export function installSequencerUxRuntime(app) {
  if (!app || app._sequencerUxRuntimeInstalled) return
  app._sequencerUxRuntimeInstalled = true

  const seqCtl = app.seqCtl
  if (!seqCtl) return

  const originalOpen = seqCtl.open.bind(seqCtl)
  seqCtl.open = (trackId = null) => {
    const result = originalOpen(trackId)
    if (app.screen !== "sequencer") return result

    if (app.seqTrackId == null) {
      app.seqHeader = true
      app.toast?.(`PAD PATTERN ${app.stepSeq?.seq?.current || "A"} · ◀▶ SWITCH · ▼ GRID`)
      app.render?.()
    } else {
      app.seqHeader = false
      app.toast?.(`LANE ${app.seqTrackId} SEQ`)
      app.render?.()
    }
    return result
  }

  const originalNav = seqCtl.nav.bind(seqCtl)
  seqCtl.nav = (dir) => {
    if (
      app.screen === "sequencer" &&
      app.seqTrackId == null &&
      !app.seqHeader &&
      dir === "up" &&
      (app.seqLane || 0) === 0
    ) {
      app.seqHeader = true
      app.toast?.(`PAD PATTERN ${app.stepSeq?.seq?.current || "A"} · ◀▶ SWITCH`)
      app.render?.()
      return true
    }
    return originalNav(dir)
  }

  const originalRender = app.render?.bind(app)
  if (originalRender) {
    app.render = (...args) => {
      const result = originalRender(...args)
      if (typeof queueMicrotask === "function") queueMicrotask(() => decorateSequencerUi(app))
      else decorateSequencerUi(app)
      return result
    }
  }

  if (typeof queueMicrotask === "function") queueMicrotask(() => decorateSequencerUi(app))
  else decorateSequencerUi(app)
}
