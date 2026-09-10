# CASSIO Audio / Loop / Sequence Ownership Audit

**Date:** 2026-09-04  
**Branch:** `dev`  
**Scope:** live pads and keyboard, loop recording/overdub, arrangement playback, Pattern A–D, dropped track patterns, per-track mixing/FX, audio persistence, and track-library save/load.

## Executive finding

The current LOOP implementation presents one logical **track/lane** in the UI, but that lane is implemented through multiple audio/state paths that do not share one ownership boundary.

A lane currently owns its PCM buffer, timeline window, mixer values, and `FxChain`. However, sequenced notes on that same lane are generated later through the global `project.pads` / current drum kit and are routed through global performance voices instead of the lane's track bus. Recording then adds a third path: live performance and, unintentionally, scheduled sequence hits can be connected to the active recording bus.

This split explains the family of symptoms being reported: the current kit can change what an existing track pattern sounds like; sequence audio can disagree with track level/pan/FX/mute behavior; backing sequence events can contaminate a new recording; and variable arrangement lanes can share one of the fixed recording buses.

The correct repair is therefore **track ownership**, not isolated UI patches.

---

## Intended behavior / contract

Current project truth and the V1 operating contract agree on the following relevant behaviors:

- Pads remain performance inputs on PLAY and LOOP; only the sequencer explicitly repurposes pads as lane selectors.
- Keyboard/pad live performance remains audible while recording unless a modal blocks input.
- REC while stopped records the selected loop lane after count-in; REC during playback enters overdub.
- Backing-track monitoring is controlled by the LOOP recording policy (`all`, `monitored`, `off`).
- A project owns its loop tracks, sound assignments, patterns, mixer state, and persisted audio state.
- Current implementation truth additionally defines variable arrangement lanes and a track library, with dropped Pattern A–D content becoming a working copy on an arrangement lane.

Relevant Grapher nodes:

- `checkpoint-current-loop-engine`
- `checkpoint-current-audio-architecture`
- `finding-live-synth-hard-tracks`
- `finding-lane-clip-window-audio`
- `track-library-growing-arrangement-lanes-62804b6f`
- `concept-recording-behavior`
- `concept-screen-21`
- `concept-screen-24`

---

# Confirmed failures

## P0 — A track owns PCM audio, but not generated sequence audio

### PCM path

`LoopEngine.ensureGraph()` creates one `FxChain` per arrangement lane. Recorded PCM playback is routed:

`AudioBufferSourceNode -> lane FxChain -> master`

That path correctly has lane-level level, pan, FX, clip-window gating, mute/solo, and recording-monitor logic.

### Sequence path

`StepSequencer` does not emit into that lane `FxChain`. Instead it converts a sequence hit into a pad number and calls the application-level pad trigger callback. `app.js` then resolves that pad number against **the current `project.pads`** and plays it with the shared Drum/Sample/PadSynth voices.

So the same visible lane can contain:

- PCM governed by the lane bus, and
- generated pattern audio governed by the global performance bus.

### Consequences

- Track M1 level / M2 pan can change PCM without changing the generated sequence heard on the same track.
- Track FX can affect PCM without affecting generated sequence audio.
- Mute/solo/monitor rules are not uniformly enforced across both content types.
- The UI says "track" while the engine is actually mixing two differently-owned graphs.

**Primary code:**

- `app/javascript/cassio/audio/loop_engine.js`
- `app/javascript/cassio/audio/step_sequencer.js`
- `app/javascript/cassio/app.js`

---

## P0 — Dropped/saved track patterns do not own their sound bindings

`LoopEngine.dropPatternOnLane()` snapshots the timing pattern, but not the pad/sound mapping that gave the pattern its sound.

The persisted library/arrangement model stores fields such as:

- `pattern`
- `seq`
- `padSlot`
- `fx`
- `audio`

It does **not** store a frozen sound map for the pattern.

When that pattern is played later, `app.js #padSound(n)` resolves lane numbers against the *current* `project.pads`. Therefore a drum-kit change can re-voice an already dropped/saved arrangement track.

This is the strongest match for the report that the current drum kit and "what is actually being played per track" are overlapping.

### Required behavior

A dropped arrangement pattern must retain the sounds it was created with unless the user explicitly reassigns/re-voices it.

At minimum the track/library asset needs a sound-binding snapshot such as:

```text
soundBindings[1..6] = {
  soundId,
  patch,
  level,
  pan,
  mode
}
```

The global current kit may remain the authoring/live-performance source, but a committed arrangement asset must not silently follow later kit changes.

---

## P0 — Arrangement sequence playback can be recorded into the active lane

The active recording lane is exposed through `#activeRecTrack()` / `#recTrackForPad()`.

`#triggerPad()` automatically assigns that active recording lane as `recTrack` whenever no explicit recording destination is provided.

`StepSequencer` arrangement playback calls the same `#triggerPad()` callback for scheduled backing-pattern hits. It does not explicitly say "this is backing playback; do not capture it."

Result: while a lane is being recorded, scheduled arrangement pad hits can be tapped into the new recording pass.

This is different from the earlier PCM-bleed problem. PCM loop playback is master-only and the existing smoke test proves that PCM does not enter `recTap`. Generated sequence audio is a different path and is not covered by that test.

### Consequences

- New overdubs can accumulate drums/pads that were only meant to be monitored.
- Repeated passes can sound like compounding/overlap even though the PCM loop bus itself does not feed back.
- `PLAY DURING REC OFF` can mute PCM backing while generated sequence backing still exists on another path.

### Immediate rule

Only **live performance input** should automatically connect to the armed recording lane.

Scheduled backing playback must never acquire `recTrack` implicitly. A future explicit bounce/freeze operation can intentionally render sequence audio to PCM, but ordinary playback must not.

---

## P0 — Variable arrangement lanes share a fixed six-bus recorder

Current arrangement lanes are variable and can be added beyond lane 6.

`AudioEngine`, however, creates exactly six record taps:

```text
recTaps = [1, 2, 3, 4, 5, 6]
```

`recTapForTrack(trackId)` clamps every ID above 6 to bus 6.

Therefore lane 7, lane 8, etc. alias onto lane 6's capture bus.

This is a direct cross-track ownership violation.

### Required repair

Recording taps must be dynamically allocated by a stable lane/capture identifier, for example a `Map<laneId, GainNode>`, or the recorder should create a temporary destination specifically for the one armed lane rather than indexing physical pad numbers.

Lane ID and physical pad number are different domains and must not be conflated.

---

## P0 — Current recording smoke test bypasses the real UI input path

`test/smoke/loop_record.mjs` verifies low-level synth capture by calling the synth directly with an explicit `recTrack`.

That proves that the low-level record tap works. It does **not** prove that:

1. the REC button correctly arms through the application flow,
2. a physical/virtual piano key reaches the correct LOOP input handler,
3. the handler uses the PLAY sound,
4. the correct lane receives the sound,
5. backing sequence content stays out of the take, or
6. the resulting lane/library asset survives persistence and reload.

The reported "synth piano no longer records" therefore remains entirely possible despite the current green smoke test.

A new integration test must exercise the same DOM/hardware path as the user.

---

# Confirmed shared-state leaks outside the lane engine

## P1 — Synth patches mutate master/global processing

`GlassPolyVoice.applyPatch()` changes voice-local oscillator/filter/envelope values, but also calls global `AudioEngine` setters for reverb, delay, bass EQ, and treble EQ.

The application has both `synth` and `padSynth`, but both share the same `AudioEngine`.

Therefore previewing or playing one synth/pad patch can change processing underneath other current audio, including loop playback.

This contradicts the conceptual separation between per-sound shaping and master EQ.

### Required repair

Synth instances need their own output/effect bus, or a reusable per-voice/per-sound `FxChain`. Master EQ/limiting must remain a distinct post-mixer stage.

---

## P1 — Sample playback shares one mutable SampleVoice FX chain

The app owns one global `SampleVoice`, and that voice owns one `FxChain`.

Each sample trigger can load/apply another sample's patch onto that same chain. If multiple samples overlap, the most recent patch can change processing for already-active sample voices.

This is another case where sound identity and audio graph ownership are not aligned.

### Required repair

Either create independent sample voice/bus instances per concurrently sounding source, or route each trigger through a stable sound/track-owned chain whose parameters cannot be replaced by another pad hit.

---

# Important secondary defects / debt

## P1 — Sequence mute/solo/record-monitor semantics are incomplete

`LoopEngine` correctly computes track gain with:

- mute
- any-solo / solo
- `playDuringRec`
- monitor flags
- clip-window gating

But generated sequence hits bypass that lane gain and `StepSequencer` primarily checks the individual track's `mute` flag.

Sequence-only lanes can therefore disagree with PCM lanes under solo, monitoring, and recording policies.

All lane content must ultimately pass through the same lane audibility decision.

---

## P1 — Key release remembers MIDI, but not the engine that created the note

LOOP keyboard `#keyDownTrack()` can play DrumVoice, SampleVoice, or Synth based on the PLAY sound. `heldKeys`, however, stores only the MIDI number. `#keyUpTrack()` decides which engine to release using the *current* global sound type.

If sound state changes while a note is held, release can target the wrong voice engine and leave a note/source alive.

`heldPads` already stores an engine discriminator; keyboard held state should do the same.

---

## P1/P2 — Loop persistence has both canonical and legacy representations

`LoopEngine.serialize()` currently writes:

- `trackLibrary`
- `arrangement.lanes`
- legacy `tracks`

This is understandable during migration, but it means the same conceptual loop exists in multiple serialized forms. It raises recovery-size, stale-state, migration, and future debugging risk.

Once compatibility migration is proven, recovery should persist one canonical representation and migrate old records at load time.

---

# Physical pad silence on LOOP timeline

The reported symptom is real and must receive a regression test, but the static handler does **not** intentionally suppress pads on `loop-tracks`.

`#padDown()` explicitly repurposes pads on:

- sequencer screens (lane select),
- mixer screens (track select),
- pad-assignment/edit contexts.

It otherwise continues into normal pad sound resolution, including on LOOP track view.

Therefore a patch such as "remove LOOP from a blocked-screen condition" would be fabricated and unsafe.

Likely runtime categories to test are:

1. current `project.pads` assignments are absent/stale after a kit/library transition,
2. audio context/voice routing changes after entering LOOP,
3. DOM pointer path/rerender behavior prevents the live pad trigger from completing,
4. shared voice/FX state leaves the pad voice inaudible,
5. recovery state contains an invalid/migrated pad mapping.

This should be reproduced through the physical DOM action and instrumented before changing behavior.

---

# Target ownership model

A logical arrangement track should have **one domain object and one audible bus**.

```text
Project
  ├─ Live performance state
  │    ├─ keyboardSound
  │    └─ currentPadKit
  │
  └─ Arrangement
       └─ Track N
            ├─ identity / libraryTrackId
            ├─ timeline { offset, length }
            ├─ PCM clip(s)
            ├─ sequence pattern
            ├─ soundBindings snapshot
            ├─ mixer { level, pan, mute, solo, monitor }
            ├─ FX
            ├─ TrackBus / FxChain
            └─ CaptureTarget (only while armed)
```

Audible routing should be:

```text
Track PCM --------------------┐
                             ├─> TrackBus/FxChain -> mixer/master
Track sequence-generated ----┘

Live keyboard/pads -----------------------------> performance/master
             └── only while REC armed ----------> selected Track CaptureTarget

Other track playback ---------------------------> its own TrackBus only
             X── never implicit ----------------> selected Track CaptureTarget
```

The key rule is that **source identity, timing identity, mixer identity, and audio-bus identity all belong to the same track**.

---

# Recommended remediation order

## Slice 1 — Stop capture contamination and add UI-path tests

1. Add an explicit playback/input origin to trigger calls (`live`, `sequence`, `preview`, etc.).
2. Only `live` triggers inherit the active `recTrack` automatically.
3. Arrangement/global sequence triggers explicitly use no capture target.
4. Add end-to-end smoke coverage through actual pad/key/REC DOM actions.

This is the smallest high-value safety fix because it prevents new recordings from being contaminated while deeper ownership work proceeds.

## Slice 2 — Make recording buses dynamic

Replace the fixed six `recTaps` with dynamic capture buses keyed by stable lane ID (or one temporary recorder destination for the armed lane).

Regression: lanes 6, 7, and 8 must record distinct signals with no cross-energy.

## Slice 3 — Snapshot pattern sound bindings when dropped/saved

When Pattern A–D is dropped onto an arrangement lane, copy both:

- timing/event graph, and
- sound bindings used by the six pattern lanes.

Loading another drum kit must not change an existing arrangement track.

Provide an explicit future command for "revoice from current kit" rather than doing it implicitly.

## Slice 4 — Route generated track sequence audio through the track bus

The sequencer must be able to target a track-owned destination rather than only the global performance output.

All PCM and generated content for Track N must then share:

- level
- pan
- FX
- mute
- solo
- monitor
- clip window

## Slice 5 — Separate performance-voice FX from master FX

Remove `GlassPolyVoice.applyPatch()` master mutations. Give synth/pad voices stable local effect/output buses. Resolve the equivalent shared-chain problem in `SampleVoice`.

## Slice 6 — Normalize persistence

Version recovery data, migrate legacy `loop.tracks`, and persist one canonical arrangement/library representation.

---

# Required regression matrix

The next implementation slices should not be considered verified until these cases pass through the application input path:

| Case | Expected result |
|---|---|
| Tap Pad 1 on PLAY | assigned Pad 1 sound audible |
| Tap Pad 1 on LOOP timeline | same live Pad 1 sound audible |
| Tap Pad 1 while REC on lane N | live sound audible and present only in lane N capture |
| Existing sequence plays while REC on another lane | sequence remains audible according to monitor policy but is absent from capture |
| `PLAY DURING REC OFF` | no backing PCM or backing sequence audible; live input remains audible/captured |
| `PLAY DURING REC MONITORED` | only monitored backing tracks audible; live input captured |
| Piano key on LOOP timeline | current PLAY sound audible |
| Piano key while REC | current PLAY sound captured into selected lane |
| Save/reload recorded piano lane | PCM persists and replays identically |
| Drop Pattern A with Kit X; then load Kit Y | dropped track still plays Kit X bindings |
| Change lane level/pan/FX | affects both its PCM and generated sequence |
| Mute lane | silences both PCM and generated sequence |
| Solo lane | suppresses both PCM and generated sequence of non-solo lanes |
| Record lane 7 while lane 6/8 active | lane 7 capture contains only intended live input |
| Save/reload arrangement | one canonical state reproduces sound/timing/mix identity |

---

# Verification status

This audit is based on static inspection of the current `dev` source, current Grapher checkpoints/findings, recent commit history, and existing smoke-test source.

No runtime test suite was executed from this audit environment, so runtime-specific pad silence has intentionally **not** been assigned a fabricated root cause. The confirmed architectural defects above are directly supported by the current source paths and should be addressed before treating isolated UI symptoms as independent bugs.
