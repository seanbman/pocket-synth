# Grapher publication plan — Grok user testing 2026-09-05

This file defines the Grapher mutations that should accompany the remediation-plan PR.

## Why these are commands instead of hand-edited shared JSON

Grapher's Git transport contract makes the local graph the canonical working state and `grapher publish` the boundary that creates `.grapher/shared/*`. Do **not** hand-edit `.grapher/shared/knowledge.json`, its hash manifest, or publication history to force these records into Git.

Run this in a clean checkout of the planning branch with the workspace's normal Grapher installation. `grapher sync` should be allowed to refuse if unpublished local work exists; resolve that state rather than forcing over it.

## Semantic records

```bash
# Hydrate the local canonical graph from the branch's published shared state.
grapher sync

# Source observation: preserve what the external exploratory run actually reported.
grapher add \
  --id observation-grok-user-testing-20260905 \
  --type observation \
  --title "Grok exploratory user test 2026-09-05" \
  --status current \
  --verification partially_verified \
  --stage maintaining \
  --content '{"observation":"Exploratory testing reported a repeatable client-tab freeze during LOOP recording after count-in plus live pad/piano input; PROJECT and SETTINGS dead ends; portrait menu clipping; low sequencer discoverability; weak interaction feedback; and an unimplemented service-worker runtime. Supporting screenshots visibly corroborate the menu/dead-end layout issue. The run did not fully exercise mic/import, long-session stability, real offline persistence, or a green cross-browser smoke suite.","source":"Personal Google Drive grok-user-testing/CASSIO-User-Testing-Report.md and supporting screenshots, reviewed 2026-09-05"}' \
  --evidence '{"type":"document","ref":"gdrive:grok-user-testing/CASSIO-User-Testing-Report.md","summary":"External exploratory user-testing report dated 2026-09-05"}'

# P0 user-impact problem. This records the symptom, not an invented root cause.
grapher add \
  --id problem-loop-record-client-hang-20260905 \
  --type problem \
  --title "LOOP recording can hang the client" \
  --status current \
  --verification partially_verified \
  --workflow-state active \
  --stage developing \
  --content '{"problem":"A reported LOOP recording path can freeze the browser tab after count-in when live pad or piano input is generated.","impact":"The instrument becomes unresponsive during a core recording workflow, making this a release-blocking stability defect until reproduced and eliminated."}' \
  --evidence '{"type":"document","ref":"gdrive:grok-user-testing/CASSIO-User-Testing-Report.md#B1","summary":"Tester reports repeatable client freeze while Rails backend remains responsive"}'
grapher link problem-loop-record-client-hang-20260905 observation-grok-user-testing-20260905 --rel derived_from

# Explicit hypothesis; do not promote it to a finding until validation succeeds.
grapher add \
  --id hypothesis-loop-hang-scheduler-multiplication-20260905 \
  --type hypothesis \
  --title "LOOP hang may involve duplicate scheduler lifecycle" \
  --status proposed \
  --verification unverified \
  --workflow-state active \
  --stage developing \
  --content '{"hypothesis":"The LOOP recording freeze may be caused by duplicate or re-entrant transport/scheduler lifecycle work that multiplies immediate note triggers during recording or LOOP/sequencer context transitions.","basis":"The external run reports a client-only freeze during recording, while prior repository diagnostics observed pathological bursts of repeated drum noteOn events around loop-to-sequencer transitions. This is correlation, not proof.","validation_condition":"A deterministic reproduction must show more than one active scheduler/timer for one play context or an unbounded trigger burst caused by a specific transition; otherwise this hypothesis is rejected and investigation continues."}'
grapher link hypothesis-loop-hang-scheduler-multiplication-20260905 problem-loop-record-client-hang-20260905 --rel derived_from

# Canonical V1 completeness gaps.
grapher add \
  --id problem-project-v1-dead-end-20260905 \
  --type problem \
  --title "PROJECT area is a V1 dead end" \
  --status current \
  --verification partially_verified \
  --workflow-state not_started \
  --stage developing \
  --content '{"problem":"The PROJECT top-level area is reported as a COMING SOON dead end instead of exposing the canonical V1 project workflow.","impact":"Users cannot complete the specified new/save/save-as/open/rename project lifecycle from the instrument UI."}'
grapher link problem-project-v1-dead-end-20260905 observation-grok-user-testing-20260905 --rel derived_from


grapher add \
  --id problem-settings-v1-dead-end-20260905 \
  --type problem \
  --title "SETTINGS area is a V1 dead end" \
  --status current \
  --verification partially_verified \
  --workflow-state not_started \
  --stage developing \
  --content '{"problem":"The SETTINGS top-level area is reported as a COMING SOON dead end instead of exposing the canonical V1 settings surfaces.","impact":"Users cannot reach the specified audio, metronome, display, storage, permission, or about controls from the instrument UI."}'
grapher link problem-settings-v1-dead-end-20260905 observation-grok-user-testing-20260905 --rel derived_from

# Screenshot-corroborated viewport problem.
grapher add \
  --id problem-main-menu-portrait-clipping-20260905 \
  --type problem \
  --title "Main menu clips lower rows in portrait" \
  --status current \
  --verification partially_verified \
  --workflow-state not_started \
  --stage developing \
  --content '{"problem":"On a phone-class portrait viewport the lower main-menu rows can collide with or render under the soft-key strip.","impact":"Canonical top-level areas become visually ambiguous or difficult to select on the product target orientation."}' \
  --evidence '{"type":"image","ref":"gdrive:grok-user-testing/screenshots/03-menu.webp","summary":"Menu screenshot visibly shows lower-row/soft-strip collision"}'
grapher link problem-main-menu-portrait-clipping-20260905 observation-grok-user-testing-20260905 --rel derived_from

# UX problem is retained, but the tester's suggested seventh top-level area is not adopted.
grapher add \
  --id problem-sequencer-discoverability-20260905 \
  --type problem \
  --title "Nested sequencer discoverability is weak" \
  --status proposed \
  --verification unverified \
  --workflow-state not_started \
  --stage developing \
  --content '{"problem":"An exploratory tester had difficulty discovering the step sequencer from the current LOOP workflow.","impact":"A specified V1 capability may be underused or appear absent to first-time users even though the canonical architecture intentionally nests it under LOOP."}'
grapher link problem-sequencer-discoverability-20260905 observation-grok-user-testing-20260905 --rel derived_from
grapher link problem-sequencer-discoverability-20260905 concept-area-loop --rel related

# PWA implementation observation links to the already-existing roadmap requirement instead of duplicating it.
grapher add \
  --id observation-pwa-runtime-gap-20260905 \
  --type observation \
  --title "PWA manifest exists but offline runtime is incomplete" \
  --status current \
  --verification partially_verified \
  --stage developing \
  --content '{"observation":"The exploratory run found manifest/icons available but no functional registered service-worker runtime for offline startup; the report observed a comment-only service-worker path and no working sw.js endpoint.","source":"Personal Google Drive grok-user-testing/CASSIO-User-Testing-Report.md section N5"}'
grapher link observation-pwa-runtime-gap-20260905 requirement-offline-installable-pwa-report-outbox --rel related

# Staged remediation proposal.
grapher add \
  --id proposal-grok-user-test-remediation-sequence-20260905 \
  --type proposal \
  --title "Stage Grok user-test remediation across focused PRs" \
  --status proposed \
  --verification not_applicable \
  --workflow-state active \
  --stage planning \
  --content '{"proposal":"Remediate in focused pull requests: first reproduce/fix the LOOP hang; then repair portrait menu and LOOP discoverability; implement PROJECT V1; implement SETTINGS V1; verify and improve input feedback/mobile polish; then implement the already-approved offline PWA foundation while expanding browser regression coverage throughout.","rationale":"This keeps the release blocker isolated, preserves the canonical six-area architecture, avoids mixing behavior changes into the open architecture-only audio refactor, and turns each external observation into independently verifiable work."}'

# Work items.
grapher add \
  --id task-remediate-loop-record-hang-20260905 \
  --type task \
  --title "Reproduce and eliminate LOOP record hang" \
  --status proposed \
  --verification unverified \
  --workflow-state not_started \
  --stage developing \
  --content '{"action":"Build a deterministic browser reproduction of LOOP count-in plus live input, instrument scheduler/transport lifecycle, identify the proven cause, apply the smallest fix, and add regression coverage for record/overdub/stop and LOOP-sequencer transitions.","expected_outcome":"Rapid pad/key input during LOOP recording remains responsive, transport exits recording cleanly, scheduler instances remain bounded, and the browser regression no longer reproduces the freeze."}'
grapher link task-remediate-loop-record-hang-20260905 problem-loop-record-client-hang-20260905 --rel related

grapher add \
  --id task-repair-portrait-menu-loop-discovery-20260905 \
  --type task \
  --title "Repair portrait menu and LOOP discovery" \
  --status proposed \
  --verification unverified \
  --workflow-state not_started \
  --stage developing \
  --content '{"action":"Fix the short-viewport main-menu layout, keep all six canonical areas reachable, add clearer sequencer affordances inside LOOP, and add a 390x844 regression check including keyboard containment.","expected_outcome":"All six top-level areas remain readable/selectable in portrait and a first-time user can reach the sequencer through LOOP without changing the canonical information architecture."}'
grapher link task-repair-portrait-menu-loop-discovery-20260905 problem-main-menu-portrait-clipping-20260905 --rel related
grapher link task-repair-portrait-menu-loop-discovery-20260905 problem-sequencer-discoverability-20260905 --rel related

grapher add \
  --id task-implement-project-v1-core-20260905 \
  --type task \
  --title "Implement PROJECT V1 core" \
  --status proposed \
  --verification unverified \
  --workflow-state not_started \
  --stage developing \
  --content '{"action":"Implement the canonical project list, new, save, save-as, rename, open, and recovery/dirty-state behavior on the existing persistence model.","expected_outcome":"A user can create, save, reload, reopen, and rename a project while preserving specified project state and referenced user audio safely."}'
grapher link task-implement-project-v1-core-20260905 problem-project-v1-dead-end-20260905 --rel related

grapher add \
  --id task-implement-settings-v1-core-20260905 \
  --type task \
  --title "Implement SETTINGS V1 core" \
  --status proposed \
  --verification unverified \
  --workflow-state not_started \
  --stage developing \
  --content '{"action":"Implement the V1 settings home and functional audio/master EQ, metronome, display, storage, microphone-permission, and about/diagnostic surfaces, splitting implementation PRs further if reviewability requires it.","expected_outcome":"Every canonical SETTINGS row opens a functional surface, persistent settings survive reload, and permission/storage failures are represented explicitly."}'
grapher link task-implement-settings-v1-core-20260905 problem-settings-v1-dead-end-20260905 --rel related

grapher add \
  --id task-verify-input-feedback-mobile-polish-20260905 \
  --type task \
  --title "Verify and improve input feedback" \
  --status proposed \
  --verification unverified \
  --workflow-state not_started \
  --stage developing \
  --content '{"action":"Observe current pad, HOLD, TAP/BPM, and portrait keyboard behavior across pointer, touch, and mapped-key paths, then improve only the feedback defects that reproduce.","expected_outcome":"Control activation is visibly acknowledged without stuck states, BPM changes are observable, and portrait controls remain contained without unnecessary interaction redesign."}'
grapher link task-verify-input-feedback-mobile-polish-20260905 observation-grok-user-testing-20260905 --rel related

grapher add \
  --id task-implement-offline-pwa-foundation-20260905 \
  --type task \
  --title "Implement offline PWA foundation" \
  --status proposed \
  --verification unverified \
  --workflow-state not_started \
  --stage developing \
  --content '{"action":"Register and version a production service worker, cache the safe application shell/static assets, demonstrate offline startup, keep creative data in durable browser storage, and add offline/upgrade smoke coverage while preserving the documented diagnostic-outbox design.","expected_outcome":"A previously loaded CASSIO installation can start offline without app-shell upgrades erasing creative data, and reconnect behavior remains safe for queued diagnostic reports."}'
grapher link task-implement-offline-pwa-foundation-20260905 requirement-offline-installable-pwa-report-outbox --rel satisfies

# Tie the proposal to its tasks.
grapher link proposal-grok-user-test-remediation-sequence-20260905 task-remediate-loop-record-hang-20260905 --rel related
grapher link proposal-grok-user-test-remediation-sequence-20260905 task-repair-portrait-menu-loop-discovery-20260905 --rel related
grapher link proposal-grok-user-test-remediation-sequence-20260905 task-implement-project-v1-core-20260905 --rel related
grapher link proposal-grok-user-test-remediation-sequence-20260905 task-implement-settings-v1-core-20260905 --rel related
grapher link proposal-grok-user-test-remediation-sequence-20260905 task-verify-input-feedback-mobile-polish-20260905 --rel related
grapher link proposal-grok-user-test-remediation-sequence-20260905 task-implement-offline-pwa-foundation-20260905 --rel related

# Current-state checkpoint for this remediation campaign.
grapher checkpoint create \
  --title "Grok user-test remediation 2026-09-05" \
  --nodes observation-grok-user-testing-20260905,problem-loop-record-client-hang-20260905,hypothesis-loop-hang-scheduler-multiplication-20260905,problem-project-v1-dead-end-20260905,problem-settings-v1-dead-end-20260905,problem-main-menu-portrait-clipping-20260905,problem-sequencer-discoverability-20260905,observation-pwa-runtime-gap-20260905,proposal-grok-user-test-remediation-sequence-20260905,task-remediate-loop-record-hang-20260905,task-repair-portrait-menu-loop-discovery-20260905,task-implement-project-v1-core-20260905,task-implement-settings-v1-core-20260905,task-verify-input-feedback-mobile-polish-20260905,task-implement-offline-pwa-foundation-20260905,concept-area-loop,requirement-offline-installable-pwa-report-outbox

# Required publication boundary.
grapher validate
grapher audit
grapher publish
```

After `grapher publish`, commit the generated `.grapher/shared/knowledge.json`, `.grapher/shared/manifest.json`, and immutable `.grapher/shared/history/<publication-id>.json` to this planning branch. Do not commit the local canonical graph, local vectors, local history journal, config-specific runtime state, or sync state.

## Curation rules for the eventual remediation PRs

- The LOOP scheduler item remains a **hypothesis** until the reproduction satisfies its validation condition. If false, mark it rejected/historical rather than rewriting it into a different explanation.
- When a task is implemented, add implementation/test/result evidence and then update workflow state; do not mark work complete merely because code was written.
- Preserve the existing canonical navigation nodes. The sequencer discoverability problem does not supersede the six-area navigation model.
- Link offline PWA implementation to the existing offline requirement rather than creating a duplicate requirement.
