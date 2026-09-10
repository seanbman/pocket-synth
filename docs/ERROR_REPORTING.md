# CASSIO Error Reporting

CASSIO uses capability-driven browser compatibility instead of Rails' blanket
`allow_browser versions: :modern` gate. Older browsers are allowed to load the
app; failures are judged by the APIs CASSIO actually uses.

## Client reporting

The lightweight reporter in `app/javascript/cassio/error_reporter.js` is always
on. Deep audio tracing remains opt-in through the existing `?debug=1` path.

Unhandled JavaScript errors, unhandled promise rejections, and CASSIO startup
construction failures are sanitized and written immediately to a separate,
bounded IndexedDB diagnostics outbox. If IndexedDB is unavailable, a small
localStorage fallback is used. Reports retry on launch, foreground return, and
connectivity restoration with exponential backoff.

A report contains a UUID, timestamp, build SHA when available, stable error
fingerprint, exception metadata, route/source path, browser user-agent,
viewport, capability flags, and a short safe lifecycle breadcrumb tail. It does
not serialize projects, tracks, recordings, audio buffers, sounds, credentials,
query strings, or app state.

The queue is capped at 40 reports and seven days. A report is deleted only after
`POST /error_reports` acknowledges its UUID.

## Server ingest

`ErrorReportsController` accepts at most 10 reports and 256 KiB per request,
re-sanitizes all fields, rate-limits by a short-lived salted hash of the remote
IP, and writes a structured `cassio_client_error` record to the Rails log.
Raw IP addresses are not stored in the report.

### GitHub issue delivery — next increment

The ingest endpoint currently writes sanitized structured reports to the Rails
log. Automatic GitHub issue matching/creation remains the next server-side
increment. It should use the existing fingerprint, keep credentials server-only,
and never make GitHub connectivity a requirement for accepting a client report.

## Offline/PWA follow-up

The page outbox already survives offline use and retries on the next foreground
or online event. Service-worker Background Sync remains an optional later path;
it must not become the sole delivery mechanism because browser support varies.
