# ADR-0002: Privacy, transmitted data categories and relay logging

- Status: accepted (revision 1)
- Date: 2026-10-05
- Amended: revision 2 decisions in [AMENDMENTS-REV2.md](AMENDMENTS-REV2.md) override conflicting text below (2026-10-05)

## Decision

### What leaves the phone

| Category | When | Destination |
|---|---|---|
| Relative level frames (one number per 50 ms frame plus `active` and `clipped` flags) | Only during an active measurement window that the TV started | Relay → TV |
| Precheck aggregate (floor, percentiles, coverage, clipping counts) | Once per commanded quiet check or pre-window check | Relay → TV |
| Window summary (percentiles, durations, counts, validity) | Once per window | Relay → TV |
| Typed household phrases (1–10 × 1–60 characters) | When the household saves them on the phone | Relay → TV (stored on the TV) |
| Listener response (Heard / Not heard) and cue word (1–12 characters) | Between measurement windows | Relay → TV |
| Microphone state, browser-reported track settings, wake-lock and visibility state | On change | Relay → TV |
| Connection metadata (room, role, credential, generation, sequence, timestamps) | Always | Relay |

Raw audio, PCM, waveforms, audio blobs and recordings never leave the phone and are never stored. There is no MediaRecorder, speech recognition, LLM scoring or recording analytics.

### Phone UI wording (exact)

> Audio stays on this phone and is never saved or uploaded. Only levels, typed phrases, listener responses, and connection details are sent to the relay and TV.

Forbidden claims: "end-to-end encrypted", "no data leaves the household", "only numbers", "relay never inspects payloads".

### Relay behaviour

- The relay validates every message against the shared schema (type, direction, identifiers, bounds) and forwards it. It does **not** interpret phrase meaning, log message bodies, log credentials or persist payloads. Primary-mode wording: "validates without content logging or persistence".
- Relay storage (AWS: DynamoDB; local: memory) holds room and connection records only: room id, pairing-code hash, credential hashes, role slots, generations, last sequence numbers, expiry times. No phrases, levels or responses.
- Operational logs contain: event name, error code, message type, byte length, role, room id hash prefix (8 hex characters of SHA-256), latency. Never bodies, phrases, cue text, credentials, pairing codes, IP addresses beyond what the platform records by default.

### TV storage

See ADR-0005. Phrases and practice summaries are treated as potentially sensitive health-adjacent data, minimized and deletable.

## Consequences

- The privacy copy matches the transmitted categories. Any new category requires amending this ADR and the copy in the same change.
- A redaction test suite asserts that the relay's logger output contains no body fields, credentials, codes or phrase text for every message type (T16).
