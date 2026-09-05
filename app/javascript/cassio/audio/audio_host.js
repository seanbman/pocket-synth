const HOSTS = new WeakMap()

function clamp(v, lo, hi, fallback = 0) {
  const n = Number(v)
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : fallback))
}

/**
 * Stable routing boundary around AudioEngine's concrete Web Audio graph.
 * Voices may create their own source/filter/envelope nodes, but they should not
 * need to know which device buses implement dry output, sends, or recording.
 */
export class AudioHost {
  constructor(engine) {
    if (!engine) throw new TypeError("AudioHost requires an AudioEngine")
    this.engine = engine
  }

  get ready() { return !!this.engine.ready }
  context() { return this.engine.ctx }
  now() { return this.engine.now() }
  outputBus() { return this.engine.dry }

  tapRecord(node, trackId) {
    if (!node || !trackId) return
    this.engine.tapRec(node, trackId)
  }

  /**
   * Route one shaped voice/hit to the device output plus optional shared sends.
   * Returns the created routing nodes so live patch changes can target them.
   */
  route(node, { pan = 0, reverb = 0, delay = 0, recTrack = null } = {}) {
    if (!node) return { output: null, panner: null, revSend: null, delaySend: null }
    const ctx = this.context()
    let output = node
    let panner = null

    const panValue = clamp(pan, -1, 1)
    if (ctx?.createStereoPanner) {
      panner = ctx.createStereoPanner()
      panner.pan.value = panValue
      node.connect(panner)
      output = panner
    }

    output.connect(this.outputBus())
    this.tapRecord(output, recTrack)

    let revSend = null
    if (ctx && this.engine.convolver) {
      revSend = ctx.createGain()
      revSend.gain.value = clamp(reverb, 0, 1)
      output.connect(revSend)
      revSend.connect(this.engine.convolver)
    }

    let delaySend = null
    if (ctx && this.engine.delay) {
      delaySend = ctx.createGain()
      delaySend.gain.value = clamp(delay, 0, 1) * 0.55
      output.connect(delaySend)
      delaySend.connect(this.engine.delay)
    }

    return { output, panner, revSend, delaySend }
  }
}

export function audioHostFor(engine) {
  if (!engine || (typeof engine !== "object" && typeof engine !== "function")) {
    throw new TypeError("audioHostFor requires an AudioEngine")
  }
  let host = HOSTS.get(engine)
  if (!host) {
    host = new AudioHost(engine)
    HOSTS.set(engine, host)
  }
  return host
}
