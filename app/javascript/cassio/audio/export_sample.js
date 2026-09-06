/** Export trimmed AudioBuffer as WAV / MP3 / M4A downloads. */

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0))

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function mixToMono(buf) {
  const len = buf.length
  const out = new Float32Array(len)
  const n = buf.numberOfChannels
  for (let c = 0; c < n; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < len; i++) out[i] += ch[i] / n
  }
  return out
}

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

function wavHeader(buf) {
  const numCh = buf.numberOfChannels
  const rate = buf.sampleRate
  const len = buf.length
  const bytesPerSample = 2
  const blockAlign = numCh * bytesPerSample
  const dataSize = len * blockAlign
  const ab = new ArrayBuffer(44 + dataSize)
  const view = new DataView(ab)
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numCh, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, dataSize, true)
  return { ab, view, numCh }
}

export function encodeWav(buf) {
  const { ab, view, numCh } = wavHeader(buf)
  let off = 44
  const chans = []
  for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c))
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([ab], { type: "audio/wav" })
}

async function encodeWavCooperative(buf) {
  if (buf.length <= buf.sampleRate * 10) return encodeWav(buf)
  const { ab, view, numCh } = wavHeader(buf)
  let off = 44
  const chans = []
  for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c))
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
    if (i > 0 && i % 16384 === 0) await yieldToBrowser()
  }
  return new Blob([ab], { type: "audio/wav" })
}

async function loadLame() {
  if (globalThis.lamejs?.Mp3Encoder) return globalThis.lamejs
  await new Promise((resolve, reject) => {
    const s = document.createElement("script")
    s.src = "/lame.min.js"
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error("MP3 ENCODER MISSING"))
    document.head.appendChild(s)
  })
  if (!globalThis.lamejs?.Mp3Encoder) throw new Error("MP3 ENCODER MISSING")
  return globalThis.lamejs
}

async function encodeMp3(buf) {
  const lame = await loadLame()
  const channels = buf.numberOfChannels >= 2 ? 2 : 1
  const sampleRate = buf.sampleRate
  const enc = new lame.Mp3Encoder(channels, sampleRate, 128)
  const left = floatTo16BitPCM(buf.getChannelData(0))
  const right = channels === 2
    ? floatTo16BitPCM(buf.getChannelData(1))
    : left
  const block = 1152
  const parts = []
  let encodedBlocks = 0
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block)
    const r = right.subarray(i, i + block)
    const mp3buf = channels === 2 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l)
    if (mp3buf.length) parts.push(mp3buf)
    encodedBlocks++
    if (encodedBlocks % 64 === 0) await yieldToBrowser()
  }
  const end = enc.flush()
  if (end.length) parts.push(end)
  return new Blob(parts, { type: "audio/mpeg" })
}

function pickM4aMime() {
  const types = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4"
  ]
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t
  }
  return null
}

async function encodeM4a(buf) {
  const mime = pickM4aMime()
  if (!mime) throw new Error("M4A NOT SUPPORTED HERE")

  const Ctx = window.AudioContext || window.webkitAudioContext
  const ctx = new Ctx()
  try {
    const dest = ctx.createMediaStreamDestination()
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(dest)
    const rec = new MediaRecorder(dest.stream, { mimeType: mime })
    const chunks = []
    const done = new Promise((resolve, reject) => {
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data) }
      rec.onerror = () => reject(new Error("M4A RECORD FAILED"))
      rec.onstop = () => resolve()
    })
    rec.start()
    src.start()
    await new Promise((r) => { src.onended = r })
    await new Promise((r) => setTimeout(r, 40))
    rec.stop()
    await done
    await ctx.close()
    return new Blob(chunks, { type: "audio/mp4" })
  } catch (e) {
    try { await ctx.close() } catch (_) { /* ignore */ }
    throw e instanceof Error ? e : new Error("M4A FAILED")
  }
}

export async function exportSample(buf, format, basename = "CASSIO_SAMPLE") {
  if (!buf) throw new Error("NO AUDIO")
  const name = String(basename || "CASSIO_SAMPLE").replace(/[^\w\-]+/g, "_")
  const fmt = String(format || "wav").toLowerCase()
  if (fmt === "wav") {
    downloadBlob(await encodeWavCooperative(buf), `${name}.wav`)
    return "wav"
  }
  if (fmt === "mp3") {
    const blob = await encodeMp3(buf)
    downloadBlob(blob, `${name}.mp3`)
    return "mp3"
  }
  if (fmt === "m4a") {
    const blob = await encodeM4a(buf)
    downloadBlob(blob, `${name}.m4a`)
    return "m4a"
  }
  throw new Error("UNKNOWN FORMAT")
}

export { mixToMono, pickM4aMime }
