---
name: grapher-ingest
description: >-
  Ingest a directory into the grapher knowledge graph using Cursor's LLM to
  understand documents and images, then write summaries and links. Use when the
  user asks to graph, ingest, index, or map a folder of files/images into
  grapher, or to enrich pending grapher stubs.
---

# Grapher LLM ingest

You are the vision/reader. `grapher` only stores and retrieves — it does not interpret file contents.

## Workflow

1. Ensure store exists: `grapher init` (safe if already present).
2. Queue work:
   ```bash
   grapher ingest <DIR>
   ```
   Optional filters: `--glob '**/*.{md,png}'`, `--types document,image`.
3. Read the JSON `pending` list.
4. For each pending entry (batch thoughtfully, but finish the queue):
   - **Text/code/docs:** `Read` the `abs_path` or `path`
   - **Images:** `Read` the image path so you see pixels, not just the filename
   - Produce a short grounded summary (purpose, notable details, project relevance)
   - Upsert:
     ```bash
     grapher add --id <node_id> --type <type> --title "<title>" \
       --path <path> --content "<summary>" --tags ingest,<more>
     ```
5. Link related nodes (`depicts`, `references`, `related`, …).
6. Verify: `grapher scan <DIR>` should show `indexed` for processed files; `grapher search` should hit the new summaries.

## Do / Don't

- Do ground summaries in what you actually read/saw
- Do keep `content` concise and embeddable
- Don't paste entire file bodies into `--content`
- Don't mark done while `pending_count` > 0 unless the user asked to stop early — report remaining ids
