export function renderSplash() {
  return `
    <div class="lcd-boot splash splash-logo">
      <div class="boot-title splash-title">CASSIO</div>
      <div class="boot-sub splash-sub">studio - 0926</div>
    </div>
  `
}

export function renderBoot(progress = 0, message = "LOADING AUDIO ENGINE...") {
  const filled = Math.round(Math.min(1, Math.max(0, progress)) * 12)
  const blocks = Array.from({ length: 12 }, (_, i) =>
    `<span class="boot-block ${i < filled ? "on" : ""}"></span>`
  ).join("")
  return `
    <div class="lcd-boot">
      <div class="boot-title">CASSIO</div>
      <div class="boot-sub">POCKET SYNTH / SAMPLER</div>
      <div class="boot-bar">${blocks}</div>
      <div class="boot-msg">${message}</div>
    </div>
  `
}

export function renderBootError(msg) {
  return `
    <div class="lcd-boot">
      <div class="boot-title">CASSIO</div>
      <div class="boot-sub">AUDIO ERROR</div>
      <div class="boot-msg">${msg}</div>
      <div class="boot-hint">TAP TO RETRY</div>
    </div>
  `
}
