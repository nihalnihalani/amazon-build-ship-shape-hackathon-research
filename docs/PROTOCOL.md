# Across the Room wire protocol v1

Status: frozen for implementation (revision 2, 2026-10-05; revision 2 records the clarifications in §8 without changing any message shape). Owner: research-contracts. Changes require a revision note here, an ADR update when behaviour changes, and the lead's approval. The executable source of truth is `packages/protocol`; this document and that package must agree (a test enforces the message-type list).

Transport: JSON text frames over WSS. Binary frames are rejected (close code 1003). Maximum serialized message size **8192 bytes** (UTF-8). All examples are illustrative.

## 1. Envelope

Every message, in both directions, is one JSON object with exactly these top-level fields (unknown fields → `bad_schema`):

| Field | Type | Rule |
|---|---|---|
| `protocol_version` | integer | must equal `1` |
| `type` | string | one of the types in §3 |
| `message_id` | string | `^m_[A-Za-z0-9_-]{16,32}$`, random per message |
| `room_id` | string or null | `^r_[A-Za-z0-9_-]{16,32}$`; null only for pre-auth types and relay replies before a room exists |
| `session_id` | string or null | `^s_[A-Za-z0-9_-]{8,40}$` |
| `window_id` | string or null | `^w_[A-Za-z0-9_-]{8,40}$` |
| `attempt_id` | string or null | `^a_[A-Za-z0-9_-]{8,40}$` |
| `sender_role` | string | `tv`, `phone` or `relay` |
| `producer_generation` | integer | 0 … 2^31−1; 0 for pre-auth and relay-originated messages; authenticated generations start at 1 |
| `sequence` | integer | 0 … 2^53−1; strictly increasing per (room, role, generation) for authenticated messages |
| `event_timestamp` | integer | ms since Unix epoch on the sender's clock; must be within ±24 h of receiver time (sanity check only; freshness uses receiver time) |
| `payload` | object | exactly the fields listed for the type (unknown fields → `bad_schema`) |

Room binding: `room_id` must be null for `room.create`, `join.request`, `join.pending` and `join.rejected`; it is optional for `auth.resume`, `ping`, `pong` and `error`; it is required for every other type. When a payload repeats `room_id`, a non-null envelope value must equal it.

Identity binding: the per-type table in §3 says which of `session_id`, `window_id`, `attempt_id` are **required** (must be non-null) for that type; all others must be null.

Numbers: all numbers must be finite (`Number.isFinite`). Strings: no control characters are allowed (U+0000–U+001F, U+007F–U+009F rejected); user text is NFC-normalized and trimmed before length checks; lengths are counted in Unicode code points.

## 2. Roles and authentication summary

See ADR-0003. The relay derives the sender's role and room from the authenticated connection; a client's `sender_role` must equal it. The relay stamps nothing into forwarded messages — it forwards the validated message unchanged — except relay-originated messages, which use `sender_role: "relay"`, `producer_generation: 0` and the relay's own monotonically increasing sequence per connection.

## 3. Message catalogue

Direction key: **T→R** TV to relay only; **P→R** phone to relay only; **T→P** TV to phone (forwarded by relay); **P→T** phone to TV (forwarded); **R→T / R→P / R→*** relay originated. Auth: **pre** = allowed before authentication; **auth** = requires authentication.

Identity columns: S = session_id, W = window_id, A = attempt_id; ✓ required, – must be null.

### 3.1 Connection, pairing and lifecycle

| type | dir | auth | S W A | payload |
|---|---|---|---|---|
| `room.create` | T→R | pre | – – – | `{ client: { app_version: string(1..32), platform: "vega" \| "web_preview" \| "test" } }` |
| `room.created` | R→T | — | – – – | `{ room_id, pairing_code: string(6), code_expires_at: int, tv_credential: string(43), credential_expires_at: int, generation: int }` (`room_id` also in envelope) |
| `pairing.refresh` | T→R | auth | – – – | `{}` → relay replies `pairing.code` |
| `pairing.code` | R→T | — | – – – | `{ pairing_code: string(6), code_expires_at: int }` |
| `join.request` | P→R | pre | – – – | `{ pairing_code: string(6), device_label: string(1..24) }` |
| `join.pending` | R→P | — | – – – | `{ join_id: string(^j_…), confirm_digits: string(2 digits), expires_at: int }` |
| `join.requested` | R→T | — | – – – | `{ join_id, device_label, confirm_digits, expires_at }` |
| `join.confirm` | T→R | auth | – – – | `{ join_id, decision: "accept" \| "reject" }` |
| `join.accepted` | R→P | — | – – – | `{ room_id, phone_credential: string(43), credential_expires_at: int, generation: int }` |
| `join.rejected` | R→P | — | – – – | `{ reason: "rejected" \| "expired" \| "room_full" \| "busy" }` |
| `join.expired` | R→T | — | – – – | `{ join_id }` |
| `auth.resume` | T→R, P→R | pre | – – – | `{ room_id, role: "tv" \| "phone", credential: string(43) }` |
| `auth.ok` | R→T, R→P | — | – – – | `{ role, generation: int, peer_connected: boolean, phone_paired: boolean }` |
| `peer.state` | R→T, R→P | — | – – – | `{ role: "tv" \| "phone", connected: boolean, generation: int }` |
| `unpair` | T→R | auth | – – – | `{}` → relay revokes phone; phone receives `unpaired` |
| `unpaired` | R→P | — | – – – | `{ reason: "tv_unpaired" \| "room_closed" \| "expired" }` |
| `room.close` | T→R | auth | – – – | `{}` |
| `ping` | any→R | pre/auth | – – – | `{}` |
| `pong` | R→* | — | – – – | `{ server_time: int }` |
| `error` | R→* | — | – – – | `{ code: ErrorCode, ref_message_id: string \| null, detail: string(0..64) }` |

### 3.2 Session commands (TV → phone)

| type | dir | auth | S W A | payload |
|---|---|---|---|---|
| `session.begin` | T→P | auth | ✓ – – | `{ family_mode: boolean, phrase_count: int(0..10), cues_max: 3 }` |
| `session.state` | T→P | auth | ✓ – – | `{ stage: TvStage, phrase_position: int(0..10), cues_used: int(0..3), listener_open_attempt: string(^a_) \| null }` |
| `precheck.start` | T→P | auth | ✓ ✓ ✓ | `{ purpose: "quiet_check" \| "pre_window", duration_ms: 2000 \| 5000 }` (quiet_check ⇒ 5000, pre_window ⇒ 2000) |
| `window.start` | T→P | auth | ✓ ✓ ✓ | `{ kind: "calibration" \| "vowel" \| "phrase", phrase_position: int(1..10) \| null, max_duration_ms: int, vad_floor_dbfs: number(-140..0) }` (calibration ⇒ 6000; vowel ⇒ ≤ 30000; phrase ⇒ 8000; phrase_position non-null only for phrase) |
| `window.stop` | T→P | auth | ✓ ✓ ✓ | `{ reason: "complete" \| "early_stop" }` |
| `window.cancel` | T→P | auth | ✓ ✓ ✓ | `{ reason: "user_cancel" \| "interrupted" \| "link_lost" \| "timeout" \| "session_end" }` |
| `listener.open` | T→P | auth | ✓ ✓ ✓ | `{ timeout_ms: int(5000..60000) }` |
| `attempt.reveal` | T→P | auth | ✓ ✓ ✓ | `{}` (locks listener input for this attempt; carries no verdict) |
| `session.end` | T→P | auth | ✓ – – | `{ reason: "completed" \| "user_exit" \| "discarded" \| "error" }` |

### 3.3 Phone observations (phone → TV)

| type | dir | auth | S W A | payload |
|---|---|---|---|---|
| `mic.state` | P→T | auth | – – – (S optional: may be set) | `MicStatePayload` below |
| `precheck.result` | P→T | auth | ✓ ✓ ✓ | `PrecheckResultPayload` below |
| `level` | P→T | auth | ✓ ✓ ✓ | `{ frame_index: int(0..700), t_audio_ms: number(0..35000), dbfs: number(-140..20), active: boolean, clipped: boolean }` |
| `window.result` | P→T | auth | ✓ ✓ ✓ | `WindowResultPayload` below |
| `listener.response` | P→T | auth | ✓ ✓ ✓ | `{ response: "heard" \| "not_heard" }` |
| `cue` | P→T | auth | ✓ – – | `{ text: string(1..12) }` |
| `phrases.update` | P→T | auth | – – – | `{ phrases: string(1..60)[1..10] }` |
| `ack` | T→P, P→T | auth | as acked | `{ acked_message_id: string, outcome: "applied" \| "ignored_stale" \| "rejected", detail: string(0..64) }` |

`mic.state` is the one exception to the null rule: `session_id` may be null or set.

#### MicStatePayload

```
{
  state: "off" | "permission_pending" | "permission_denied" | "no_input" | "input_busy"
       | "constraints_unsupported" | "open_idle" | "measuring" | "error",
  settings: {
    auto_gain_control: boolean | null, echo_cancellation: boolean | null,
    noise_suppression: boolean | null, sample_rate: number | null, channel_count: number | null
  },
  supported: { auto_gain_control: boolean, echo_cancellation: boolean, noise_suppression: boolean },
  wake_lock: "held" | "released" | "unsupported" | "rejected" | "not_requested",
  visibility: "visible" | "hidden",
  mode: "physical_phone" | "same_host" | "fixture_replay"
}
```

`mode` is self-reported context for labelling; it is not proof of device class.

#### PrecheckResultPayload

```
{
  purpose: "quiet_check" | "pre_window",
  valid: boolean,
  invalid_reason: null | "low_coverage" | "clipped" | "unstable_floor" | "burst_noise" | "too_loud" | "nonfinite" | "interrupted",
  floor_dbfs: number | null, p20_dbfs: number | null, p80_dbfs: number | null, p95_dbfs: number | null,
  frame_count: int, expected_frames: int, coverage: number(0..1),
  clipped_frames: int, nonfinite_frames: int, duration_ms: number
}
```

#### WindowResultPayload

```
{
  kind: "calibration" | "vowel" | "phrase",
  valid: boolean,
  invalid_reason: null | "no_voice" | "clipped" | "low_coverage" | "continuous_sound" | "nonfinite" | "interrupted",
  frame_count: int, expected_frames: int, coverage: number(0..1),
  active_ms: number, longest_active_ms: number, segments: int, onset_ms: number | null,
  p50_active_dbfs: number | null, p95_active_dbfs: number | null, peak_dbfs: number | null,
  clipped_frames: int, nonfinite_frames: int, duration_ms: number
}
```

### 3.4 Error codes

`bad_schema`, `unknown_type`, `unauthenticated`, `unauthorized`, `forbidden_direction`, `expired`, `revoked`, `rate_limited`, `room_full`, `join_busy`, `not_found`, `stale`, `replay`, `superseded`, `payload_too_large`, `binary_rejected`, `audio_rejected`, `cue_limit`, `origin_rejected`, `internal`.

## 4. Validation order (relay and receivers)

1. Frame is text and ≤ 8192 bytes → else `payload_too_large` / `binary_rejected`.
2. JSON parse; top-level object; exactly the envelope fields; `protocol_version === 1`.
3. `type` known → else `unknown_type`.
4. Audio guard: reject (`audio_rejected`) any payload containing keys named `audio`, `pcm`, `samples`, `waveform`, `blob`, `buffer`, `data` (case-insensitive) or any string value longer than 256 code points (phrases ≤ 60, so legitimate payloads never exceed this) or any array longer than 16 elements. Schema validation would also reject these; this guard produces a distinct code for monitoring.
5. Envelope field formats and identity-binding rules.
6. Payload schema (exact keys, types, ranges, enum values, finite numbers, text normalization and lengths).
7. Direction and auth (§3 tables; ADR-0003 §9).
8. message_id dedupe first: a `message_id` already seen in the room's recent window (last 1024) is dropped silently (not forwarded, no error, metric `duplicate_dropped`); then generation and sequence: wrong generation → `stale`, non-increasing sequence with a new `message_id` → `replay`.
9. Rate limits.
10. Forward (relay) or apply (receiver). Receivers additionally check state: e.g. TV ignores `level`/`window.result` for a window or attempt that is not the currently open one (`ack ignored_stale`), and the phone ignores commands for an ended session.

## 5. Session-local (TV) events

These are not sent over the wire; they are typed inputs to the TV session reducer and are defined in `packages/protocol/src/session-events.ts`: `remote.ok`, `remote.back`, `remote.up/down/left/right`, `speaker.rating { rating: "felt_loud" | "felt_normal" | "skipped" }`, `ui.confirm_skip_listener`, `timer.listener_timeout`, `timer.window_max`, `transport.state`, and the wire messages above after validation.

## 6. State machines (normative names)

TV session stages (`TvStage`): `idle`, `pairing`, `permission_pending`, `quiet_check`, `calibration`, `vowel_ready`, `vowel_active`, `vowel_result`, `phrase_ready`, `phrase_active`, `response_pending`, `reveal`, `summary`, `history`, `paused_or_invalid`, `resume_or_discard`.

Phone microphone states: as `MicStatePayload.state`.

Transport states (both clients): `disconnected`, `connecting`, `authenticating`, `connected`, `reconnecting`, `failed`.

Per-attempt states: `capturing` → `capture_closed` → (`response_pending` → ) `revealed`; or `capturing` → `cancelled` / `invalid` (revealed as not scored).

## 7. Limits summary

| Limit | Value |
|---|---|
| Max message | 8192 bytes |
| Phrases | 1–10, each 1–60 code points after NFC + trim |
| Cue | 1–12 code points; max 3 per session |
| device_label | 1–24 code points |
| Level frames per window | ≤ 700 (30 s / 50 ms = 600 plus slack) |
| Phone message rate | 40/s sustained, burst 60 |
| TV message rate | 20/s sustained, burst 40 |
| Pre-auth messages | ≤ 5 per connection; auth deadline 5 s (65 s while a join is pending) |
| Pairing code | 6 chars, alphabet `ACDEFHJKMNPRTUVWXY3479`, 10 min, one use |
| Join request | 60 s |
| Credentials | 32 random bytes base64url (43 chars), 12 h |
| Room | 12 h absolute; closed after 30 min with no connections |
| Heartbeat | `ping` every 10 s; peer unknown after 25 s |

## 8. Revision 2 clarifications (2026-10-05)

Recorded after the protocol package review; the package already implements these readings.

1. Room binding rule added to §1 (there is no room column in the §3 tables).
2. Authenticated `producer_generation` values start at 1; 0 is reserved for pre-auth and relay-originated messages.
3. Duplicates are dropped silently by the relay (no `ack` from the relay; `ack` remains a TV↔phone message). ADR-0003 §10 is amended to match.
4. `acked_message_id` and `ref_message_id` must match the `message_id` pattern; an unparsable offending id is reported as `null`.
5. Ranges not stated in revision 1: result dBFS fields −140…20; frame counts 0…700; durations 0…35000 ms; `valid` is true exactly when `invalid_reason` is null; `sample_rate` 1…384000; `channel_count` integer 1…64; vowel `max_duration_ms` 1000…30000.
6. §1 wording fix for control characters.
