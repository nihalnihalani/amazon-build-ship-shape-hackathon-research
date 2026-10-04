# ADR-0005: TV local storage, retention, migration, resume and deletion

- Status: accepted (revision 1)
- Date: 2026-10-05
- Amended: revision 2 decisions in [AMENDMENTS-REV2.md](AMENDMENTS-REV2.md) override conflicting text below (2026-10-05)

## Decision

- Store: Vega AsyncStorage (`@react-native-async-storage/async-storage` aliased to `@amazon-devices/react-native-async-storage__async-storage@~2.1.0`). It is **unencrypted**; this is disclosed in Settings › About and the README.
- Namespace: every key starts with `atr:v1:`. Deletion removes only `atr:` keys (never a blanket `clear()`).
- Keys:
  - `atr:v1:meta` — `{schema_version, created_at}`
  - `atr:v1:settings` — family mode, cue word, measurement mode, UI preferences
  - `atr:v1:phrases` — phrase bank (1–10 strings)
  - `atr:v1:session:<session_id>` — completed or incomplete session summary (no credentials, no level streams, no raw audio)
  - `atr:v1:index` — ordered list of session ids with local dates
  - `atr:v1:active` — checkpoint of the in-progress session (stage, completed attempts) for crash resume
- Retention: session summaries older than 30 days are pruned on launch. History view shows the last 7 calendar days (TV local date); missing days remain "No session".
- Credentials and pairing codes are memory-only and never persisted.
- Writes are idempotent by `session_id`/`attempt_id`; each attempt's result is persisted after reveal.
- Migration: `schema_version` integer; migrations are pure functions `vN → vN+1` with tests; unknown future versions are not overwritten (app shows "Data from a newer version" and offers delete).
- Crash resume: on launch, if `atr:v1:active` exists, show "Resume session" / "Discard session" (Discard focused second; Resume never invents completion; any window that was open is recorded as `interrupted`, unscored; a fresh pairing and microphone start are required).
- Deletion: Settings › Delete local practice data → confirmation dialog with **Cancel focused by default** → removes all `atr:` keys, verifies by listing keys afterwards (`getAllKeys` contains no `atr:` key), resets in-memory state. Reset calibration clears the current session band only. Unpair revokes the phone via the relay.
- Fixture/demo history is never written into real history; fixture mode uses a separate in-memory store and a persistent "Fixture replay" label.
