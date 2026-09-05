#!/usr/bin/env node
import assert from "node:assert/strict"
import { audioHostFor } from "../../app/javascript/cassio/audio/audio_host.js"

function node(name) {
  return {
    name,
    connections: [],
    connect(target) { this.connections.push(target) }
  }
}

const dry = node("dry")
const convolver = node("convolver")
const delay = node("delay")
const record = node("record")
const created = []
const ctx = {
  createGain() {
    const n = node("gain")
    n.gain = { value: 0 }
    created.push(n)
    return n
  },
  createStereoPanner() {
    const n = node("panner")
    n.pan = { value: 0 }
    created.push(n)
    return n
  }
}
const engine = {
  ready: true,
  ctx,
  dry,
  convolver,
  delay,
  now() { return 12.5 },
  tapRec(source, trackId) { record.connections.push({ source, trackId }) }
}

const host = audioHostFor(engine)
assert.equal(audioHostFor(engine), host, "one host is reused per engine")
assert.equal(host.context(), ctx)
assert.equal(host.now(), 12.5)
assert.equal(host.outputBus(), dry)

const source = node("source")
const routed = host.route(source, { pan: 0.25, reverb: 0.4, delay: 0.6, recTrack: 3 })
assert.equal(routed.panner.pan.value, 0.25)
assert.equal(source.connections[0], routed.panner)
assert.ok(routed.panner.connections.includes(dry))
assert.equal(routed.revSend.gain.value, 0.4)
assert.equal(routed.delaySend.gain.value, 0.6 * 0.55)
assert.ok(routed.revSend.connections.includes(convolver))
assert.ok(routed.delaySend.connections.includes(delay))
assert.equal(record.connections[0].trackId, 3)
assert.equal(record.connections[0].source, routed.panner)

console.log("PASS: audio host owns device routing and record taps")
