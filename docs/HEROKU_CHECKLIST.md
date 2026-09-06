# Heroku checklist

- Connect `seanbman/pocket-synth` in the Heroku dashboard.
- Deploy `main` with the Ruby buildpack.
- Keep one web dyno for the current prototype.
- Confirm `/up` returns HTTP 200.
- Confirm `/` loads CASSIO and audio unlocks after user interaction.
- Do not treat `/tmp/cassio-production.sqlite3` as durable storage.
