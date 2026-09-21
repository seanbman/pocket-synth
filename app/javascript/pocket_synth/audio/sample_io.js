/** Decode uploaded audio files (wav/mp3/ogg/m4a) into AudioBuffer. */

export async function decodeAudioFile(ctx, file) {
  if (!file) throw new Error("NO FILE")
  const ab = await file.arrayBuffer()
  try {
    return await ctx.decodeAudioData(ab.slice(0))
  } catch (e) {
    throw new Error(`CAN'T DECODE ${file.name || "FILE"}`)
  }
}

/** Serialize AudioBuffer for IndexedDB. */
export function bufferToStored(buf) {
  if (!buf) return null
  const channels = []
  for (let c = 0; c < buf.numberOfChannels; c++) {
    channels.push(buf.getChannelData(c).slice(0))
  }
  return {
    sampleRate: buf.sampleRate,
    length: buf.length,
    numberOfChannels: buf.numberOfChannels,
    channels
  }
}

/** Restore AudioBuffer from stored form. */
export function storedToBuffer(ctx, stored) {
  if (!stored?.channels?.length || !ctx) return null
  const buf = ctx.createBuffer(
    stored.numberOfChannels || stored.channels.length,
    stored.length || stored.channels[0].length,
    stored.sampleRate || ctx.sampleRate
  )
  for (let c = 0; c < stored.channels.length; c++) {
    const src = stored.channels[c]
    const data = src instanceof Float32Array ? src : new Float32Array(src)
    buf.copyToChannel(data, c)
  }
  return buf
}

/** In-place peak normalize toward targetPeak (maxBoost caps quiet-take amplification). */
export function peakNormalizeBuffer(buf, targetPeak = 0.9, maxBoost = 8) {
  if (!buf) return buf
  let peak = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i])
      if (v > peak) peak = v
    }
  }
  if (peak < 1e-6) return buf
  const scale = Math.min(maxBoost, targetPeak / peak)
  if (Math.abs(scale - 1) < 0.02) return buf
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < data.length; i++) data[i] *= scale
  }
  return buf
}

/** Slice trim region (0..1) into a new AudioBuffer. */
export function sliceBuffer(ctx, buf, trimStart = 0, trimEnd = 1) {
  if (!buf) return null
  const start = Math.floor(Math.min(0.99, Math.max(0, trimStart)) * buf.length)
  const end = Math.floor(Math.min(1, Math.max(trimStart + 0.005, trimEnd)) * buf.length)
  const len = Math.max(1, end - start)
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c).subarray(start, start + len)
    out.copyToChannel(src, c)
  }
  return out
}

export function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  const m = Math.floor(s / 60)
  const rem = s - m * 60
  const whole = Math.floor(rem)
  const frac = Math.floor((rem - whole) * 100)
  return `${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(frac).padStart(2, "0")}`
}
