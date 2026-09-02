---
name: grapher-ingest
description: >-
  Fully ingest a directory into grapher with deep understanding. Cursor is the
  enriching LLM: every document, image, video, and audio file must be consumed
  and deeply understood — never path-only stubs. Use when graphing, ingesting,
  indexing, or mapping a folder of files/media into grapher, or finishing
  pending stubs.
---

# Grapher full-directory ingest (deep media understanding)

**Cursor is the enriching LLM.** `grapher` stores your words; it does not see, watch, or hear. Directory ingest succeeds only when **every** document, **image**, **video**, and **audio** file has been deeply consumed and that understanding is written into the graph.

## Non-negotiables (read twice)

1. **Paths are not knowledge.** Storing `--path` without rich `--content` is a failure — especially for images, video, and sound.
2. **Process the entire pending queue.** No skipping media because it is “hard” or “binary.”
3. **Images — deep visual understanding:** use image `Read`/vision. Graph what is depicted: subjects, layout, text in image, diagrams, UI, style, and project relevance. Filename captions are forbidden.
4. **Videos — deep audiovisual understanding:** inspect frames/playback with available tools. Graph scenes, actions, on-screen text, speech if present, and how the clip informs the project — not “video file at …”.
5. **Audio / sound — deep auditory understanding:** listen or extract speech/music/SFX meaning. Graph a real summary/transcript gist and role in the project — not “audio at …”.
6. **Done only when** `grapher scan <DIR>` shows **pending 0** for the target set and search can hit facts that came from the media itself (not just filenames).

## Workflow

1. `grapher init` if needed; `grapher cursor install` if rules/skills are missing.
2. Queue:
   ```bash
   grapher ingest <DIR>
   ```
   Default covers `document`, `image`, `video`, and `audio`.
3. Take the full `pending` list (`--json` if parsing).
4. For **each** pending item until empty:
   - Open `abs_path` with the right modality (text Read, image vision, video/audio inspection)
   - Write a **deep** grounded summary into `--content` (the knowledge payload)
   - Upsert with the exact pending `path` and `node_id`:
     ```bash
     grapher add --id <node_id> --type <type> --title "<title>" \
       --path <path> --content "<deep understanding>" --tags ingest,<more>
     ```
5. Link (`depicts`, `references`, `related`, …).
6. Verify:
   ```bash
   grapher scan <DIR>
   grapher search "<a detail that only exists inside an image/video/audio you ingested>"
   ```

## Do / Don't

- Do treat image/video/audio as mandatory first-class knowledge sources
- Do put understanding in `content`; path only locates the original
- Do keep `content` dense and embeddable (not whole file dumps)
- Don't leave empty or filename-only media nodes
- Don't stop while `pending_count > 0` unless the user explicitly aborts — then report remaining ids
