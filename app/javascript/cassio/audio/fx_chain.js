import { resolveFx, syncSeconds, fxDefaults } from "cassio/audio/fx_params"

/**
 * Per-source processing chain (sample voice or loop track).
 *
 * input → pre gain → (noise/hum/crackle inject) → filter → filter drive → saturation
 *       → grit (bits / downsample / dropout / skip) → EQ (bass/mid/treble) → tilt
 *       → device → chorus/flanger → phaser → tremolo → auto-pan → compressor → limiter
 *       → width (M/S) → level → pan → out (dry bus)  +  reverb send  +  delay send
 *
 * Pitch-domain FX (wow, flutter, vibrato) are exposed as rate modulators that callers
 * attach to each buffer source's playbackRate.
 */
export class FxChain {
  constructor(engine, { scope = "sample", destination = null, bpmSource = null } = {}) {
    this.engine = engine
    this.scope = scope
    this.dest = destination
    this.bpmSource = bpmSource
    this.params = fxDefaults(scope)
    this.effective = this.params
    this._bpm = 120
    this._built = false
    this._active = 0
    this._impulseKey = ""
    this._swap = false
  }

  get input() {
    this.ensure()
    return this.inGain
  }

  ensure() {
    if (this._built || !this.engine?.ready) return
    const ctx = this.engine.ctx
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n }
    const bq = (type, f, q = 0.7, gain = 0) => {
      const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; n.gain.value = gain; return n
    }
    const lfo = (f, type = "sine") => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o }

    this.inGain = g(1)
    this.preGain = g(1)
    this.noiseBus = g(0) // hiss/static/dust/crackle/hum summed here, gated by activity
    this.noiseGate = g(0)
    this.filter = bq("lowpass", 22000, 0.0001)
    this.fdrive = ctx.createWaveShaper(); this.fdrive.oversample = "2x"
    this.sat = ctx.createWaveShaper(); this.sat.oversample = "2x"
    // Grit (ScriptProcessor) is created lazily — main-thread callbacks are not free on phones
    this.gritIn = g(1); this.gritOut = g(1)
    this.grit = null
    this.bass = bq("lowshelf", 120)
    this.mid = bq("peaking", 1000, 0.9)
    this.treble = bq("highshelf", 6000)
    this.tiltLo = bq("lowshelf", 800)
    this.tiltHi = bq("highshelf", 800)
    // Device: bandpass + shaper on a wet path, mixed with dry
    this.devDry = g(1); this.devWet = g(0)
    this.devBp = bq("bandpass", 1500, 1)
    this.devHp = bq("highpass", 300, 0.7)
    this.devShaper = ctx.createWaveShaper()
    this.devOut = g(1)
    // Chorus / flanger: modulated delay
    this.modIn = g(1)
    this.modDry = g(1); this.modWet = g(0)
    this.modDelay = ctx.createDelay(0.1); this.modDelay.delayTime.value = 0.012
    this.modFb = g(0)
    this.chorusLfo = lfo(0.8); this.chorusLfoGain = g(0)
    this.flangLfo = lfo(0.3); this.flangLfoGain = g(0)
    this.modOut = g(1)
    // Phaser: 4 allpass stages
    this.phDry = g(1); this.phWet = g(0)
    this.phStages = [bq("allpass", 400, 0.7), bq("allpass", 800, 0.7), bq("allpass", 1600, 0.7), bq("allpass", 3200, 0.7)]
    this.phLfo = lfo(0.4); this.phLfoGain = g(0)
    this.phOut = g(1)
    // Tremolo / auto-pan
    this.trem = g(1)
    this.tremLfo = lfo(5); this.tremLfoGain = g(0)
    this.apan = ctx.createStereoPanner()
    this.apanLfo = lfo(0.5); this.apanLfoGain = g(0)
    // Dynamics
    this.comp = ctx.createDynamicsCompressor()
    this.comp.threshold.value = 0; this.comp.ratio.value = 1; this.comp.knee.value = 10
    this.compMakeup = g(1)
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = 0; this.limiter.ratio.value = 1; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.08
    // Width (mid/side)
    this.split = ctx.createChannelSplitter(2)
    this.merge = ctx.createChannelMerger(2)
    this.midN = g(0.5)          // 0.5(L+R)
    this.sideSum = g(1)         // L - R
    this.sideNegIn = g(-1)
    this.side = g(0.5)          // × width
    this.sideNeg = g(-1)
    this.outL = g(1); this.outR = g(1)
    this.wmLfo = lfo(0.3); this.wmLfoGain = g(0)
    // Output
    this.level = g(1)
    this.pan = ctx.createStereoPanner()
    this.out = g(1)
    // Reverb send
    this.revSend = g(0)
    this.revTone = bq("lowpass", 12000, 0.5)
    this.convolver = ctx.createConvolver()
    this.revOut = g(1)
    // Delay send (stereo ping-pong capable)
    this.delSend = g(0)
    this.delL = ctx.createDelay(2.5); this.delR = ctx.createDelay(2.5)
    this.delFbL = g(0.35); this.delFbR = g(0)
    this.delFilt = bq("lowpass", 18000, 0.5)
    this.delShaper = ctx.createWaveShaper()
    this.delMerge = ctx.createChannelMerger(2)
    this.tapLL = g(1); this.tapLR = g(1); this.tapRR = g(0)
    this.delLfo = lfo(0.6); this.delLfoGain = g(0)
    this.delOut = g(1)
    // Pitch modulators (attached per-source to playbackRate)
    this.wowLfo = lfo(0.35); this.flutterLfo = lfo(6.3, "triangle"); this.vibLfo = lfo(5)
    this.wowDepth = g(0); this.flutterDepth = g(0); this.vibDepth = g(0)
    this.wowLfo.connect(this.wowDepth); this.flutterLfo.connect(this.flutterDepth); this.vibLfo.connect(this.vibDepth)

    // ---- wiring ----
    this.inGain.connect(this.preGain)
    this.preGain.connect(this.filter)
    this.noiseBus.connect(this.noiseGate)
    this.noiseGate.connect(this.filter)
    this.filter.connect(this.fdrive)
    this.fdrive.connect(this.sat)
    this.sat.connect(this.gritIn)
    this.gritIn.connect(this.gritOut)
    this.gritOut.connect(this.bass)
    this.bass.connect(this.mid)
    this.mid.connect(this.treble)
    this.treble.connect(this.tiltLo)
    this.tiltLo.connect(this.tiltHi)
    this.tiltHi.connect(this.devDry)
    this.tiltHi.connect(this.devHp)
    this.devHp.connect(this.devBp)
    this.devBp.connect(this.devShaper)
    this.devShaper.connect(this.devWet)
    this.devDry.connect(this.devOut)
    this.devWet.connect(this.devOut)
    this.devOut.connect(this.modIn)
    this.modIn.connect(this.modDry)
    this.modIn.connect(this.modDelay)
    this.modDelay.connect(this.modWet)
    this.modDelay.connect(this.modFb)
    this.modFb.connect(this.modDelay)
    this.chorusLfo.connect(this.chorusLfoGain); this.chorusLfoGain.connect(this.modDelay.delayTime)
    this.flangLfo.connect(this.flangLfoGain); this.flangLfoGain.connect(this.modDelay.delayTime)
    this.modDry.connect(this.modOut)
    this.modWet.connect(this.modOut)
    this.modOut.connect(this.phDry)
    let ph = this.modOut
    for (const s of this.phStages) { ph.connect(s); ph = s; this.phLfoGain.connect(s.frequency) }
    this.phLfo.connect(this.phLfoGain)
    ph.connect(this.phWet)
    this.phDry.connect(this.phOut)
    this.phWet.connect(this.phOut)
    this.phOut.connect(this.trem)
    this.tremLfo.connect(this.tremLfoGain); this.tremLfoGain.connect(this.trem.gain)
    this.trem.connect(this.apan)
    this.apanLfo.connect(this.apanLfoGain); this.apanLfoGain.connect(this.apan.pan)
    this.apan.connect(this.comp)
    this.comp.connect(this.compMakeup)
    this.compMakeup.connect(this.limiter)
    this.limiter.connect(this.split)
    // M/S width: L' = mid + side, R' = mid - side
    this.split.connect(this.midN, 0); this.split.connect(this.midN, 1)
    this.split.connect(this.sideSum, 0); this.split.connect(this.sideNegIn, 1); this.sideNegIn.connect(this.sideSum)
    this.sideSum.connect(this.side)
    this.midN.connect(this.outL); this.side.connect(this.outL)
    this.midN.connect(this.outR); this.side.connect(this.sideNeg); this.sideNeg.connect(this.outR)
    this.wmLfo.connect(this.wmLfoGain); this.wmLfoGain.connect(this.side.gain)
    this.#wireMerge(false)
    this.merge.connect(this.level)
    this.level.connect(this.pan)
    this.pan.connect(this.out)
    // sends (post-level, pre-pan so pan stays intuitive)
    this.level.connect(this.revSend)
    this.revSend.connect(this.convolver)
    this.convolver.connect(this.revTone)
    this.revTone.connect(this.revOut)
    // Delay: send → delL → filt → shaper (= L tap). Mono: tap→delL feedback, tap to both ears.
    // Ping-pong: tap → delR (R tap) → fb → delL; L tap left ear, R tap right ear.
    this.level.connect(this.delSend)
    this.delSend.connect(this.delL)
    this.delL.connect(this.delFilt)
    this.delFilt.connect(this.delShaper)
    this.delShaper.connect(this.delFbL)      // → delL or delR, rewired in apply()
    this.delFbL.connect(this.delL)
    this.delR.connect(this.delFbR); this.delFbR.connect(this.delL)
    this.delLfo.connect(this.delLfoGain); this.delLfoGain.connect(this.delL.delayTime); this.delLfoGain.connect(this.delR.delayTime)
    this.delShaper.connect(this.tapLL); this.tapLL.connect(this.delMerge, 0, 0)
    this.delShaper.connect(this.tapLR); this.tapLR.connect(this.delMerge, 0, 1)
    this.delR.connect(this.tapRR); this.tapRR.connect(this.delMerge, 0, 1)
    this.delMerge.connect(this.delOut)

    const dest = this.dest || this.engine.dry
    this.out.connect(dest)
    this.revOut.connect(dest)
    this.delOut.connect(dest)

    this._noiseBuilt = false
    this._grit = { bits: 16, down: 1, alias: true, dropout: 0, skip: 0 }
    this._built = true
    this.apply(this.params)
  }

  #wireMerge(swap) {
    try { this.outL.disconnect(); this.outR.disconnect() } catch (_) { /* ignore */ }
    this.outL.connect(this.merge, 0, swap ? 1 : 0)
    this.outR.connect(this.merge, 0, swap ? 0 : 1)
    this._swap = swap
  }

  #buildNoise() {
    if (this._noiseBuilt) return
    this._noiseBuilt = true
    const ctx = this.engine.ctx
    const sr = ctx.sampleRate
    const mk = (fn, seconds = 2) => {
      const b = ctx.createBuffer(2, Math.floor(sr * seconds), sr)
      for (let c = 0; c < 2; c++) fn(b.getChannelData(c))
      const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.start(); return s
    }
    const white = (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1 }
    const pink = (d) => {
      let b0 = 0, b1 = 0, b2 = 0
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25
      }
    }
    const sparse = (density, decay) => (d) => {
      for (let i = 0; i < d.length; i++) {
        if (Math.random() < density) {
          const a = (Math.random() * 2 - 1)
          const n = Math.floor(decay * (0.5 + Math.random()))
          for (let k = 0; k < n && i + k < d.length; k++) d[i + k] += a * (1 - k / n)
        }
      }
    }
    const g = (v = 0) => { const n = this.engine.ctx.createGain(); n.gain.value = v; return n }
    this.whiteSrc = mk(white); this.pinkSrc = mk(pink)
    this.hissG = g(0); this.staticG = g(0); this.dustG = g(0); this.crackleG = g(0); this.humG = g(0)
    this.hissFilt = this.engine.ctx.createBiquadFilter(); this.hissFilt.type = "highpass"; this.hissFilt.frequency.value = 1500
    this.staticFilt = this.engine.ctx.createBiquadFilter(); this.staticFilt.type = "bandpass"; this.staticFilt.frequency.value = 2500; this.staticFilt.Q.value = 0.5
    this.staticAm = g(1); this.staticLfo = this.engine.ctx.createOscillator(); this.staticLfo.type = "square"; this.staticLfo.frequency.value = 7; this.staticLfoG = g(0.5)
    this.staticLfo.connect(this.staticLfoG); this.staticLfoG.connect(this.staticAm.gain); this.staticLfo.start()
    this.pinkSrc.connect(this.hissFilt); this.hissFilt.connect(this.hissG); this.hissG.connect(this.noiseBus)
    this.whiteSrc.connect(this.staticFilt); this.staticFilt.connect(this.staticAm); this.staticAm.connect(this.staticG); this.staticG.connect(this.noiseBus)
    this.dustSrc = mk(sparse(0.00008, 400), 3); this.dustFilt = this.engine.ctx.createBiquadFilter(); this.dustFilt.type = "lowpass"; this.dustFilt.frequency.value = 3000
    this.dustSrc.connect(this.dustFilt); this.dustFilt.connect(this.dustG); this.dustG.connect(this.noiseBus)
    this.crackleSrc = mk(sparse(0.0012, 30), 3)
    this.crackleSrc.connect(this.crackleG); this.crackleG.connect(this.noiseBus)
    this.hum = this.engine.ctx.createOscillator(); this.hum.frequency.value = 60; this.hum.type = "sawtooth"
    this.humFilt = this.engine.ctx.createBiquadFilter(); this.humFilt.type = "lowpass"; this.humFilt.frequency.value = 400
    this.hum.connect(this.humFilt); this.humFilt.connect(this.humG); this.humG.connect(this.noiseBus); this.hum.start()
  }

  /** Route through / around the grit processor; build it on first use. */
  #setGritActive(on) {
    if (on && !this.grit) {
      this.grit = this.engine.ctx.createScriptProcessor(1024, 2, 2)
      this.#gritProcessor()
    }
    if (on === this._gritOn) return
    this._gritOn = on
    try { this.gritIn.disconnect() } catch (_) { /* ignore */ }
    if (on) { this.gritIn.connect(this.grit); this.grit.connect(this.gritOut) }
    else { this.gritIn.connect(this.gritOut); try { this.grit?.disconnect() } catch (_) { /* ignore */ } }
  }

  /** Bit reduction, sample-rate reduction, dropout and skip in one processor. */
  #gritProcessor() {
    let hold = [0, 0], phase = 0, dropGain = 1, dropTimer = 0, skipTimer = 0
    const st = this._grit
    this.grit.onaudioprocess = (ev) => {
      const inL = ev.inputBuffer.getChannelData(0)
      const inR = ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : inL
      const outL = ev.outputBuffer.getChannelData(0)
      const outR = ev.outputBuffer.getChannelData(1)
      const bypass = st.bits >= 16 && st.down <= 1 && st.dropout <= 0 && st.skip <= 0
      if (bypass) { outL.set(inL); outR.set(inR); return }
      const levels = Math.pow(2, st.bits - 1)
      const n = inL.length
      for (let i = 0; i < n; i++) {
        phase += 1
        if (phase >= st.down) {
          phase = 0
          hold[0] = inL[i]; hold[1] = inR[i]
        } else if (!st.alias) {
          hold[0] = hold[0] * 0.7 + inL[i] * 0.3; hold[1] = hold[1] * 0.7 + inR[i] * 0.3
        }
        let l = hold[0], r = hold[1]
        if (st.bits < 16) { l = Math.round(l * levels) / levels; r = Math.round(r * levels) / levels }
        if (st.dropout > 0) {
          if (dropTimer <= 0) {
            const drop = Math.random() < st.dropout * 0.6
            dropGain = drop ? 0.05 + Math.random() * 0.3 : 1
            dropTimer = Math.floor((drop ? 1500 : 6000) * (0.4 + Math.random() * 1.2) / Math.max(0.2, st.dropout))
          }
          dropTimer--
          l *= dropGain; r *= dropGain
        }
        if (st.skip > 0) {
          if (skipTimer <= 0) {
            const z = Math.random() < st.skip * 0.35
            skipTimer = z ? -Math.floor(200 + Math.random() * 1800) : Math.floor(3000 + Math.random() * 8000 * (1 - st.skip))
          }
          if (skipTimer < 0) { skipTimer++; l = 0; r = 0 } else skipTimer--
        }
        outL[i] = l; outR[i] = r
      }
    }
  }

  static #curve(type, drive) {
    const n = 2048
    const c = new Float32Array(n)
    const k = 1 + drive * (type === "fuzz" ? 60 : type === "distort" ? 25 : type === "hardclip" ? 8 : type === "overdrive" ? 10 : 4)
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1
      let y
      switch (type) {
        case "saturate": y = Math.tanh(x * k) / Math.tanh(k); break
        case "tape": y = Math.tanh(x * k * 0.8 + 0.08 * x * x * x) / Math.tanh(k * 0.8); break
        case "softclip": y = x - (x * x * x) / 3 * Math.min(1, k / 4); y = Math.max(-1, Math.min(1, y * (1 + drive))); break
        case "overdrive": y = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x)); y = Math.max(-1, Math.min(1, y)); break
        case "distort": y = Math.sign(x) * (1 - Math.exp(-Math.abs(x) * k)); break
        case "hardclip": y = Math.max(-1 / (1 + drive * 2), Math.min(1 / (1 + drive * 2), x * (1 + drive * 3))) * (1 + drive * 2); break
        case "fuzz": y = Math.sign(x) * Math.pow(Math.min(1, Math.abs(x) * k), 0.3); break
        default: y = x
      }
      c[i] = Number.isFinite(y) ? y : 0
    }
    return c
  }

  static #linear() {
    const c = new Float32Array(3); c[0] = -1; c[1] = 0; c[2] = 1; return c
  }

  #impulse(type, size, decay, tone) {
    const key = `${type}|${size.toFixed(2)}|${decay.toFixed(2)}`
    if (key === this._impulseKey) return
    this._impulseKey = key
    const ctx = this.engine.ctx
    const base = { room: 0.7, hall: 2.6, plate: 1.8, spring: 1.1, tiny: 0.18, huge: 5.5 }[type] || 1
    const seconds = Math.min(8, Math.max(0.05, base * size))
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    const exp = { room: 2.4, hall: 1.6, plate: 1.3, spring: 2.0, tiny: 3.5, huge: 1.2 }[type] || 2
    const curve = exp / Math.max(0.2, decay)
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      let lp = 0
      for (let i = 0; i < len; i++) {
        const t = i / len
        let v = (Math.random() * 2 - 1) * Math.pow(1 - t, curve)
        if (type === "plate") { lp = lp * 0.2 + v * 0.8; v = lp * 1.4 }
        if (type === "spring") {
          const per = Math.floor(ctx.sampleRate * 0.034)
          if (i % per < 40) v += (Math.random() * 2 - 1) * Math.pow(1 - t, curve) * 1.5
          lp = lp * 0.6 + v * 0.4; v = lp
        }
        if (type === "hall" || type === "huge") { lp = lp * 0.5 + v * 0.5; v = lp * 1.2 }
        d[i] = v
      }
      // pre-delay-ish: soften first ms
      for (let i = 0; i < Math.min(len, 200); i++) d[i] *= i / 200
    }
    this.convolver.buffer = buf
  }

  get bpm() {
    const v = this.bpmSource ? Number(this.bpmSource()) : this._bpm
    return Number.isFinite(v) && v > 0 ? v : 120
  }

  setBpm(bpm) {
    this._bpm = Number(bpm) || 120
    if (this._built) this.#applyDelayTime(this.effective)
  }

  #applyDelayTime(p) {
    const t = Math.min(2.4, syncSeconds(p.delMode, this.bpm, p.delTime))
    const now = this.engine.ctx.currentTime
    this.delL.delayTime.setTargetAtTime(t, now, 0.05)
    this.delR.delayTime.setTargetAtTime(t, now, 0.05)
  }

  /** Activity gating for generated noise (only audible while something plays). */
  setActive(n) {
    this._active = Math.max(0, n)
    if (!this._built) return
    this.noiseGate.gain.setTargetAtTime(this._active > 0 ? 1 : 0, this.engine.ctx.currentTime, 0.03)
  }

  /**
   * Attach pitch modulators (wow/flutter/vibrato) to a buffer source's playbackRate.
   * Returns a detach fn.
   */
  attachRateMod(param, baseRate = 1) {
    if (!this._built) return () => {}
    const ctx = this.engine.ctx
    const scale = ctx.createGain()
    scale.gain.value = Math.max(0.05, baseRate)
    this.wowDepth.connect(scale); this.flutterDepth.connect(scale); this.vibDepth.connect(scale)
    scale.connect(param)
    return () => { try { scale.disconnect() } catch (_) { /* ignore */ } }
  }

  /** Apply a flat params object (character overlay resolved here). */
  apply(params, { bpm } = {}) {
    this.params = { ...this.params, ...(params || {}) }
    if (bpm) this._bpm = bpm
    if (!this._built) return
    const p = this.effective = resolveFx(this.params)
    const ctx = this.engine.ctx
    const now = ctx.currentTime
    const set = (ap, v, tc = 0.03) => ap.setTargetAtTime(v, now, tc)

    // MIX
    set(this.preGain.gain, Math.max(0, Number(p.gain ?? 1.5)))
    set(this.level.gain, Math.max(0, Number(p.level ?? 1)))
    set(this.pan.pan, Math.min(1, Math.max(-1, Number(p.pan ?? 0))))

    // EQ / tilt / temp
    const temp = Number(p.temp || 0)
    set(this.bass.gain, Number(p.bassDb || 0) + temp * 2)
    set(this.mid.gain, Number(p.midDb || 0))
    set(this.mid.frequency, Number(p.midFreq || 1000))
    set(this.treble.gain, Number(p.trebleDb || 0) - temp * 4 - Number(p.age || 0) * 9)
    const tilt = Number(p.tilt || 0) * 6
    set(this.tiltLo.gain, -tilt)
    set(this.tiltHi.gain, tilt)

    // FILTER
    const ft = p.filterType
    if (ft === "off") {
      this.filter.type = "lowpass"; set(this.filter.frequency, 22000); set(this.filter.Q, 0.0001)
    } else {
      this.filter.type = ft === "lp" ? "lowpass" : ft === "hp" ? "highpass" : "bandpass"
      let cutoff = Number(p.cutoff || 8000)
      if (p.soften > 0) cutoff = Math.min(cutoff, 12000 - p.soften * 8000)
      set(this.filter.frequency, cutoff)
      set(this.filter.Q, 0.5 + Number(p.resonance || 0) * 14)
    }
    if (ft === "off" && (p.soften > 0 || p.age > 0)) {
      set(this.filter.frequency, 16000 - Math.max(p.soften || 0, (p.age || 0) * 0.8) * 12000)
    }
    this.fdrive.curve = p.filterDrive > 0.01 ? FxChain.#curve("saturate", p.filterDrive) : FxChain.#linear()

    // SATURATION
    const sType = p.satType === "off" && p.age > 0.3 ? "tape" : p.satType
    this.sat.curve = sType && sType !== "off" ? FxChain.#curve(sType, Number(p.drive ?? 0.3)) : FxChain.#linear()

    // LO-FI
    let bits = Number(p.bits ?? 16), down = Number(p.downsample ?? 1)
    if (p.lofiPreset === "8bit") { bits = 8; down = 6 }
    else if (p.lofiPreset === "12bit") { bits = 12; down = 2 }
    else if (p.lofiPreset === "crunch") { bits = 10; down = 4 }
    Object.assign(this._grit, { bits, down: Math.max(1, Math.round(down)), alias: !!p.alias, dropout: Number(p.dropout || 0) + Number(p.age || 0) * 0.3, skip: Number(p.skip || 0) })
    this.#setGritActive(this._grit.bits < 16 || this._grit.down > 1 || this._grit.dropout > 0 || this._grit.skip > 0)

    // TAPE pitch mods (rate deltas, scaled per source by base rate)
    set(this.wowDepth.gain, Number(p.wow || 0) * 0.012 + Number(p.age || 0) * 0.004)
    set(this.flutterDepth.gain, Number(p.flutter || 0) * 0.004)
    this.vibLfo.frequency.setTargetAtTime(Number(p.vibRate || 5), now, 0.05)
    set(this.vibDepth.gain, Number(p.vibDepth || 0) * 0.03)

    // NOISE (generators built on first use)
    const wantNoise = (p.hiss > 0 || p.age > 0 || p.staticNoise > 0 || p.dust > 0 || p.crackle > 0 || p.hum > 0)
    if (wantNoise) this.#buildNoise()
    if (this._noiseBuilt) {
      const nc = p.noiseColor === "white"
      try { this.pinkSrc.disconnect(this.hissFilt) } catch (_) { /* ignore */ }
      try { this.whiteSrc.disconnect(this.hissFilt) } catch (_) { /* ignore */ }
      ;(nc ? this.whiteSrc : this.pinkSrc).connect(this.hissFilt)
      set(this.hissG.gain, (Number(p.hiss || 0) + Number(p.age || 0) * 0.35) * 0.12)
      set(this.staticG.gain, Number(p.staticNoise || 0) * 0.15)
      set(this.dustG.gain, Number(p.dust || 0) * 0.9)
      set(this.crackleG.gain, Number(p.crackle || 0) * 0.7)
      set(this.humG.gain, Number(p.hum || 0) * 0.05)
    }

    // DEVICE
    const dev = p.device || "off"
    const dAmt = dev === "off" ? 0 : Number(p.deviceAmt ?? 0.7)
    set(this.devDry.gain, 1 - dAmt)
    set(this.devWet.gain, dAmt * 1.6)
    if (dev !== "off") {
      const cfg = {
        radio: [1600, 0.9, 250, "overdrive", 0.4],
        telephone: [1400, 2.2, 400, "softclip", 0.3],
        tiny: [3000, 0.7, 500, "softclip", 0.2],
        broken: [900, 3, 200, "distort", 0.7],
        megaphone: [1800, 1.6, 350, "distort", 0.5]
      }[dev]
      set(this.devBp.frequency, cfg[0]); set(this.devBp.Q, cfg[1]); set(this.devHp.frequency, cfg[2])
      this.devShaper.curve = FxChain.#curve(cfg[3], cfg[4])
    }

    // CHORUS / FLANGER
    const ch = Number(p.chorusDepth || 0), fl = Number(p.flangDepth || 0)
    this.chorusLfo.frequency.setTargetAtTime(Number(p.chorusRate || 0.8), now, 0.05)
    this.flangLfo.frequency.setTargetAtTime(Number(p.flangRate || 0.3), now, 0.05)
    set(this.modDelay.delayTime, fl > 0 ? 0.003 : 0.014)
    set(this.chorusLfoGain.gain, ch * 0.004)
    set(this.flangLfoGain.gain, fl * 0.0025)
    set(this.modFb.gain, fl > 0 ? Number(p.flangFb || 0) * fl : 0)
    const wet = Math.min(1, ch + fl)
    set(this.modWet.gain, wet * 0.8)
    set(this.modDry.gain, 1 - wet * 0.3)

    // PHASER
    const phd = Number(p.phaserDepth || 0)
    this.phLfo.frequency.setTargetAtTime(Number(p.phaserRate || 0.4), now, 0.05)
    set(this.phLfoGain.gain, phd * 900)
    set(this.phWet.gain, phd > 0 ? 0.8 : 0)
    set(this.phDry.gain, phd > 0 ? 0.8 : 1)

    // TREMOLO / AUTO-PAN
    const tr = Number(p.tremDepth || 0)
    this.tremLfo.frequency.setTargetAtTime(Number(p.tremRate || 5), now, 0.05)
    set(this.trem.gain, 1 - tr * 0.5)
    set(this.tremLfoGain.gain, tr * 0.5)
    const ap = Number(p.apanDepth || 0)
    this.apanLfo.frequency.setTargetAtTime(Number(p.apanRate || 0.5), now, 0.05)
    set(this.apanLfoGain.gain, ap)

    // DYNAMICS
    const comp = Math.max(Number(p.comp || 0), Number(p.squash || 0) * 1.2, Number(p.punch || 0) * 0.5)
    if (comp > 0.01) {
      set(this.comp.threshold, -6 - comp * 30)
      set(this.comp.ratio, 2 + comp * 12)
      set(this.comp.attack, p.punch > 0 ? 0.02 + p.punch * 0.04 : p.squash > 0 ? 0.001 : 0.006)
      set(this.comp.release, p.squash > 0 ? 0.06 : 0.18)
      set(this.compMakeup.gain, 1 + comp * 1.4)
    } else {
      set(this.comp.threshold, 0); set(this.comp.ratio, 1); set(this.compMakeup.gain, 1)
    }
    if (p.limiter) { set(this.limiter.threshold, -1); set(this.limiter.ratio, 20); set(this.limiter.knee, 0) }
    else { set(this.limiter.threshold, 0); set(this.limiter.ratio, 1) }

    // STEREO
    const w = p.mono ? 0 : Math.max(0, Number(p.width ?? 1))
    set(this.side.gain, 0.5 * w)
    set(this.wmLfoGain.gain, Number(p.widthMod || 0) * 0.5 * Math.max(0.5, w))
    if (!!p.swap !== this._swap) this.#wireMerge(!!p.swap)

    // REVERB
    this.#impulse(p.revType || "room", Number(p.revSize ?? 1), Number(p.revDecay ?? 1), Number(p.revTone || 0))
    set(this.revSend.gain, Number(p.reverb || 0) * 0.9, 0.05)
    set(this.revTone.frequency, 3000 * Math.pow(6, (Number(p.revTone || 0) + 1) / 2))

    // DELAY
    const dm = Number(p.delay || 0)
    set(this.delSend.gain, dm * 0.6, 0.05)
    this.#applyDelayTime(p)
    const fb = Number(p.delFeedback ?? 0.35)
    const pp = !!p.delPingPong
    // Ping-pong: L tap feeds R, R feeds back to L; mono: L feeds itself.
    if (pp !== this._pp) {
      try { this.delFbL.disconnect() } catch (_) { /* ignore */ }
      this.delFbL.connect(pp ? this.delR : this.delL)
      this._pp = pp
    }
    set(this.delFbL.gain, pp ? 1 : fb)
    set(this.delFbR.gain, pp ? fb : 0)
    set(this.tapLL.gain, 1)
    set(this.tapLR.gain, pp ? 0 : 1)
    set(this.tapRR.gain, pp ? 1 : 0)
    const flavor = p.delFlavor || "clean"
    set(this.delFilt.frequency, flavor === "clean" ? 18000 : flavor === "lofi" ? 2200 : 3800)
    this.delShaper.curve = flavor === "clean" ? FxChain.#linear() : FxChain.#curve(flavor === "tape" ? "tape" : "softclip", 0.35)
    set(this.delLfoGain.gain, flavor === "tape" ? 0.0015 : 0)
  }

  dispose() {
    if (!this._built) return
    try { this.out.disconnect(); this.revOut.disconnect(); this.delOut.disconnect() } catch (_) { /* ignore */ }
    for (const o of [this.chorusLfo, this.flangLfo, this.phLfo, this.tremLfo, this.apanLfo, this.wmLfo, this.wowLfo, this.flutterLfo, this.vibLfo, this.delLfo, this.hum, this.staticLfo, this.whiteSrc, this.pinkSrc, this.dustSrc, this.crackleSrc]) {
      try { o?.stop() } catch (_) { /* ignore */ }
    }
    try { if (this.grit) { this.grit.disconnect(); this.grit.onaudioprocess = null } } catch (_) { /* ignore */ }
    this._built = false
  }
}
