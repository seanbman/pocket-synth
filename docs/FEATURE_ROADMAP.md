# CASSIO Feature Roadmap

This list records product direction beyond the current prototype. Items marked
**planned** are requirements, not claims about the current build.

## Installable offline app — planned

- Install CASSIO to a phone or desktop home screen as a standalone Progressive
  Web App.
- Cache the application shell, interface assets, factory sounds, and other safe
  static resources so the instrument can start without a network connection.
- Keep user-created sounds, kits, tracks, songs, albums, active work, and
  recovery data in durable browser storage for offline use.
- Request persistent browser storage after meaningful use and show storage
  usage and pressure warnings. The app must still handle a denied request or
  browser eviction safely.
- Version caches and stored data independently. App updates must migrate user
  data without erasing creative work.

## Offline error-report delivery — planned

- Sanitize and save reportable errors to a bounded IndexedDB outbox immediately,
  including a report UUID, timestamp, build SHA, fingerprint, trace tail, retry
  count, and next-attempt time.
- Retry delivery on app launch, return to the foreground, restored connectivity,
  and successful network activity. Use service-worker Background Sync as an
  additional delivery path where the browser supports it, not as the only path.
- Send idempotent batches to CASSIO's Rails backend. The server—not the installed
  app—compares fingerprints against GitHub issues and comments on a match or
  creates a new issue.
- Remove a queued report only after the server acknowledges its UUID. Concurrent
  retries must not create duplicate reports or GitHub issues.
- Never include recordings, audio buffers, user sound names, credentials, or
  GitHub tokens. Cap and prune the queue by age, record count, and total bytes.
- Store diagnostics separately from creative work so an error-report migration
  or failure cannot endanger a user's sounds or projects.

## Portable Pocket Synth files — planned

CASSIO will import and export versioned, self-contained Pocket Synth package
files. Import and export must work locally while offline; sharing or cloud sync
is optional and separate.

Package scopes:

- **Sound:** source audio plus non-destructive trim, tuning, envelope, EQ, filter,
  effects, playback mode, root note, and descriptive metadata.
- **Kit:** pad assignments and every non-factory sound dependency needed to play
  the kit correctly.
- **Track:** recorded audio and/or sequence data, sound dependencies, timing,
  automation, processing, level, pan, mute, and solo state.
- **Song:** tempo, key metadata, arrangement, tracks, patterns, instruments,
  mixer state, and all referenced user-created media.
- **Album:** an ordered collection of songs with album metadata, optional artwork,
  and all transitive dependencies required to reproduce those songs.
- **Library backup:** a portable collection of selected or all user-created
  sounds, kits, tracks, songs, and albums.

Package rules:

- Use a documented archive containing a versioned JSON manifest, media files,
  stable internal references, checksums, and optional artwork. The eventual file
  extension and MIME type must be registered as part of the format specification.
- Validate the manifest, paths, checksums, media limits, and schema before
  importing anything. Never execute code contained in a package.
- Show a preview of contents, provenance, conflicts, and required storage before
  import. Do not overwrite local creative work by default.
- Deduplicate identical media by content hash while preserving separate edits and
  names. Remap internal IDs safely when merging with an existing library.
- Preserve enough source material and processing state for lossless project
  continuation. Rendered WAV/MP3 export remains a separate feature for ordinary
  listening and use outside CASSIO.
- Support explicit schema migrations so newer CASSIO versions can open older
  packages. Newer unsupported package versions must fail clearly and leave the
  local library untouched.

## Creative hierarchy — planned direction

The long-term portable model is:

1. Sources become sounds.
2. Sounds can be grouped into kits.
3. Sounds, recordings, and patterns become tracks.
4. Tracks are arranged and mixed into songs.
5. Songs are ordered and packaged as albums.

Each level may reference factory assets by stable built-in ID, but exports must
embed every user-created dependency required to reconstruct the selected item.
