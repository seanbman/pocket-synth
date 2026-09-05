# Grok User-Testing Remediation Plan — 2026-09-05

## Purpose

This document triages the exploratory user-testing package in the personal Google Drive folder `grok-user-testing` and converts the useful findings into a staged remediation plan for CASSIO.

The Drive report is treated as **external exploratory evidence**, not as canonical product truth. Where a recommendation conflicts with CASSIO's V1 specification or current Grapher knowledge, the canonical product model wins unless a deliberate product decision supersedes it.

Source package reviewed:

- `grok-user-testing/CASSIO-User-Testing-Report.md`
- supporting screenshots in `grok-user-testing/screenshots/`
- current `main` implementation and open/merged GitHub work
- current CASSIO Grapher knowledge and canonical V1 manual

## Executive assessment

The testing is useful. It found one credible release-blocking interaction failure, several real V1 completeness or viewport gaps, and a set of lower-confidence UX observations worth verifying.

The report should **not** be implemented verbatim. In particular, its suggestion to expose SEQUENCER as a new top-level area conflicts with the canonical six-area CASSIO information architecture. V1 intentionally places the step sequencer inside LOOP. The remediation is therefore to improve discoverability inside LOOP, not to add a seventh top-level mode.

## Finding triage

| Finding | Disposition | Priority | Reason |
| --- | --- | --- | --- |
| LOOP recording can hang/freeeze the client tab after count-in and live input | **Accept as credible blocker; reproduce before assigning root cause** | P0 | The report describes a repeatable client-side freeze while Rails remains responsive. Existing audio diagnostics have also observed pathological note-trigger bursts around loop/sequencer transitions, so transport/scheduler duplication is a plausible family of causes, but it is not yet proven to be this defect. |
| PROJECT is a `COMING SOON` dead end | **Accept as V1 gap** | P1 | PROJECT is part of the canonical V1 six-area model and has defined save/open/new/rename behavior. |
| SETTINGS is a `COMING SOON` dead end | **Accept as V1 gap** | P1 | SETTINGS is canonical V1 scope, including audio, metronome, display, storage, permissions, and about surfaces. |
| Main-menu lower rows clip or overlap the soft-key strip | **Accept** | P1 | Supporting screenshots visibly corroborate the viewport/layout defect. |
| Sequencer is hard to discover | **Accept problem; reject proposed top-level solution** | P1 | Improve LOOP affordances and guidance while preserving the canonical six-area hierarchy. |
| Pad press feedback is weak | **Accept as interaction-polish item** | P1/P2 | Low-risk feedback improvement; verify touch/mouse/keyboard paths behave consistently. |
| Piano/keyboard clips at roughly 390x844 | **Accept pending viewport regression reproduction** | P1/P2 | Mobile portrait is the product target; containment and safe-area behavior require an explicit regression check. |
| TAP/HOLD/BPM feedback is weak | **Verify first** | P2 | Current code already emits transient BPM/TAP feedback, so the problem may be visibility/duration rather than missing behavior. HOLD state likewise needs observation before redesign. |
| Splash/audio unlock copy is confusing | **Verify first** | P2 | Browser audio-unlock behavior is constrained by user-gesture policy; copy should only change after testing the actual first-interaction path. |
| PWA/service-worker path is incomplete | **Accept as planned product gap** | P1 after core stability | Offline installability and durable offline behavior are already documented roadmap requirements. This test confirms that the implementation is not there yet; it does not create a new architecture requirement. |
| Browser smoke runner / Chrome CDP setup is brittle | **Accept as test-infrastructure work** | P1 | Stable reproduction of the LOOP blocker and viewport regressions needs a reliable browser harness. |

## Remediation PR sequence

### PR 1 — P0: Reproduce and eliminate LOOP recording hang

**Goal:** make LOOP record/overdub and live pad/keyboard input bounded, responsive, and regression-tested.

Scope:

1. Build a deterministic browser reproduction around the reported sequence: enter LOOP, arm/select a track, begin recording through count-in, then generate sustained pad and piano activity.
2. Instrument transport and scheduler lifecycle boundaries so a run can prove how many loop, sequencer, and look-ahead schedulers/timers are active.
3. Assert that transitions cannot create duplicate scheduling loops or unbounded immediate note-trigger bursts.
4. Keep the existing persistence coalescing protection intact; do not reintroduce hot-path PCM/session serialization.
5. Fix the smallest proven cause once the reproduction identifies it. Do not use a broad audio-engine rewrite as the first response.
6. Add a regression that exercises record start, live input, overdub exit, stop, and loop/sequencer context transitions.

Acceptance:

- 100+ rapid pad/key triggers during and immediately after count-in do not freeze the tab.
- REC can leave overdub/recording and playback remains controllable.
- STOP returns the transport to a stable stopped state.
- At most one scheduler instance exists for each active play context.
- Scheduled note count remains bounded by the expected pattern/loop work rather than multiplying across transitions.
- No regression to the existing 600 ms persistence coalescing / serialization protections.
- Chromium test passes; WebKit/Safari-class testing is run where available because prior persistence failures were browser-sensitive.

**Relationship to open PR #8:** keep this bug-fix PR separate from the behavior-preserving audio-boundary refactor. Whichever lands first should be rebased into the other; do not hide a behavioral fix inside the refactor.

### PR 2 — P1: Repair mobile menu and LOOP discoverability

**Goal:** make the canonical six areas and nested LOOP tools discoverable and physically reachable in portrait mode.

Scope:

- Ensure PLAY, LOOP, SOUND, MIX, PROJECT, and SETTINGS can all be read and selected without colliding with the soft-key strip.
- Keep the selected menu row in view on short viewports.
- Add/strengthen LOOP affordances for SEQ/PATTERN without adding a seventh top-level area.
- Add a 390x844 portrait regression check.
- Include keyboard/piano containment in the same viewport pass if the reproduction confirms clipping.

Acceptance:

- All six top-level areas are visible/reachable at the supported portrait minimum.
- No menu text or selected row renders under the soft-key strip.
- A first-time tester can reach the step sequencer from LOOP without external documentation.
- No core control requires horizontal scrolling.

### PR 3 — P1: Implement PROJECT V1 core

**Goal:** replace the dead end with the minimum canonical project workflow.

Scope:

- Project list.
- New project.
- Save and Save As.
- Rename.
- Open.
- Recovery/dirty-state behavior consistent with current persistence design.
- Preserve references to user audio instead of needlessly duplicating source media.

Acceptance:

- A user can create, name, save, reopen, and rename a project entirely through CASSIO.
- Tempo, sound assignments, tracks/pattern state, and mixer state survive reload according to the V1 persistence contract.
- Missing or referenced user audio fails safely and does not silently corrupt the project.

### PR 4 — P1: Implement SETTINGS V1 core

**Goal:** replace the second dead end with the defined V1 system controls.

Scope should be split into reviewable slices if necessary, but the V1 target remains:

- Audio/master EQ and limiter preference.
- Metronome settings.
- Display settings.
- Storage usage/persistence status.
- Microphone permissions/test path.
- About/diagnostics surface.

Acceptance:

- Every SETTINGS row opens a functional V1 surface rather than a placeholder.
- Settings that are specified as persistent survive reload.
- Permission/storage failures are represented explicitly rather than silently ignored.

### PR 5 — P1/P2: Input-state feedback and mobile polish

**Goal:** make physical-style controls visibly acknowledge user action without changing the established interaction model.

Scope after verification:

- Pad active/pressed feedback with a short, deterministic visual/LED-style state.
- HOLD state visibility.
- TAP/BPM feedback duration/prominence if testing shows the current toast is too easy to miss.
- Any remaining portrait keyboard containment fixes not appropriate for PR 2.

Acceptance:

- Pointer, touch, and mapped-key activation produce consistent feedback.
- Feedback does not remain stuck after pointer cancel, blur, panic/STOP, or note-off.
- BPM change is observable without requiring the user to infer it from sound alone.

### PR 6 — P1: Installable offline PWA foundation

**Goal:** implement the already-approved offline roadmap foundation after transport and V1 navigation are stable.

Scope:

- Register a production service worker.
- Cache/version the application shell and safe static/factory assets.
- Support offline startup of the installed app shell.
- Keep user-created audio/state in durable browser storage rather than the static cache.
- Add offline/upgrade smoke coverage.
- Preserve the separately documented offline error-report outbox design; Background Sync remains an optional additional delivery path, not the sole retry mechanism.

Acceptance:

- Installable PWA criteria are met on supported Chromium browsers.
- A previously loaded installation can start without network access.
- App-shell upgrades do not erase user creative data.
- Offline/reconnect behavior does not duplicate queued diagnostic reports.

## Test-harness work is not a final cleanup step

The browser smoke runner should be repaired incrementally starting in PR 1, then extended by each remediation PR. Do not postpone all automation until the end; the primary value of the harness is preventing each fixed regression from returning.

Minimum matrix by the end of this sequence:

- LOOP record/count-in/live-input/overdub/stop.
- LOOP ↔ sequencer play-context transitions.
- 390x844 menu and keyboard viewport.
- PROJECT create/save/reload/open.
- SETTINGS persistence and failure states.
- Pad/HOLD/TAP feedback.
- Online first load, installed/offline startup, reconnect.

## Explicit non-goals

- Do **not** add SEQUENCER as a seventh top-level menu area without a new product decision that supersedes the canonical V1 navigation model.
- Do **not** permanently hide PROJECT or SETTINGS to make the prototype appear more complete; they are specified V1 capabilities.
- Do **not** claim the LOOP freeze root cause is duplicate scheduling, persistence, Web Audio, or any other subsystem until the reproduction demonstrates it.
- Do **not** fold the P0 behavior fix into the architecture-only PR #8 without making the behavioral delta independently reviewable.
- Do **not** treat subjective Grok comments as requirements when current behavior has not been observed and compared against the spec.

## Evidence / confidence rules

For follow-up work, record observations separately from hypotheses:

- **Observation:** what the tester, browser, trace, screenshot, or source inspection actually showed.
- **Problem:** the user/product impact demonstrated by that observation.
- **Hypothesis:** a proposed technical cause with an explicit validation condition.
- **Task:** the bounded remediation action and expected outcome.
- **Test/result:** evidence that confirms or falsifies the hypothesis and verifies the task outcome.

Do not promote a hypothesis to a finding merely because it explains the symptoms plausibly.

## Exit criteria for the remediation series

The series is complete when the original critical journey can be rerun without the P0 freeze or V1 dead ends, all canonical top-level areas remain accessible in portrait mode, the nested sequencer is discoverable, and every fixed defect has repeatable browser evidence. The PWA portion is complete only when offline startup is actually demonstrated; manifest/icons alone are not sufficient.
