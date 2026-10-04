# @atr/protocol

Wire protocol v1 for "Across the Room: the far-side check": envelope, 37 message types, validators, builders, limits and replay helpers. **Package revision 4** (PROTOCOL.md revision 4).

- Executable source of truth for [`docs/PROTOCOL.md`](../../docs/PROTOCOL.md) (revision 4). A test parses that document and fails if the message types, direction and auth columns, S/W/A identity columns, error codes, stage names or documented limits drift from this package.
- **Zero runtime dependencies.** TypeScript 5.8.3, ESM (NodeNext, relative imports end in `.js`). The build emits ES2019 so that Hermes does not need syntax transforms for classes, `?.` or `??`.
- Portable: no `Buffer`, no `crypto` module, no `TextEncoder`, no regex look-behind, no DOM. A test scans `src/` for these. It is designed for Node 22+, browsers and React Native (Hermes); the test suite was run on Node only (versions recorded in the handoff), never in a browser or on Hermes (see Limitations).
- It validates what a single message says. It does not know who sent it: direction, authentication, generation and sequence checks need connection context and use the helpers below.

```sh
npm run build -w @atr/protocol       # tsc -> dist/
npm run typecheck -w @atr/protocol
npm test -w @atr/protocol            # vitest
```

## Revision 4: what consumers must adopt

Breaking changes (a consumer that does not change fails loudly, either at compile time or on the first message):

1. **`SequenceTracker.accept(expectedGeneration, generation, sequence)`** replaces `accept(generation, sequence)`. Pass the generation the relay assigned to that producer (never the message's own value); any other generation is `stale`. The old two-argument call throws a `TypeError`. `PerRoleSequenceTracker.accept(role, expectedGeneration, generation, sequence)` likewise. New: `check(...)` (no state change) and `commit(expectedGeneration, sequence)` for relays that run rate limits after the sequence check.
2. **Message-id dedupe is scoped and recorded after acceptance.** Use one `MessageIdDedupe` per (room, role): `DedupeScopes.scope(roomId, role)`. In the relay: `has(id)` early, `record(id)` only after the message was accepted (`forget(id)` undoes a record). `seen(id)` still works (check and record in one step) and is fine for a receiver that applies the message immediately (the TV).
3. **`auth.ok.payload.next_credential`** is required (43 base64url characters): the credential to present on the next `auth.resume`. `room.created.tv_credential` and `join.accepted.phone_credential` are unchanged. `CREDENTIAL_TTL_MS` is now 2 h.
4. **`window.start.vad_floor_dbfs`** must be -110 .. -30 (was -140 .. 0).
5. **`precheck.result.invalid_reason`** gains `silent_input`; `unstable_floor` and `too_loud` are rejected for `pre_window` (constants `PRE_WINDOW_INVALID_REASONS`, `QUIET_CHECK_INVALID_REASONS`).
6. **Quantisation.** Round before sending: `quantizeDb(x)` for every dB field (`level.dbfs`, `window.start.vad_floor_dbfs`, `floor_dbfs`, `p20_dbfs`, `p80_dbfs`, `p95_dbfs`, `p50_active_dbfs`, `p95_active_dbfs`, `peak_dbfs`) and `quantizeCoverage(x)` for `coverage`; `t_audio_ms`, `duration_ms`, `active_ms`, `longest_active_ms`, `onset_ms` must be integers (`Math.round`). `MessageFactory.next` throws on anything else.
7. **Cross-field invariants** on `window.result`, `precheck.result` and `level` (see below): a phone that builds results from honest DSP output passes them; hand-written or fixture results must be consistent.
8. **Display-safe text**: phrases, `cue.text`, `device_label` and `app_version` are rejected when they contain bidi controls, separators, invisible operators, tag characters or noncharacters, are blank to the eye, or stack more than four combining marks. Use `prepareUserText` (normalises, then validates) and show the rejection reason; `displaySafe(s)` returns `'ok' | 'forbidden_char' | 'no_visible_content' | 'combining_run'`.
9. **The returned message is the validated snapshot**, not a re-read of your object, and `-0` is `0` in it; quantised numbers in it are canonical. A relay must forward `JSON.stringify(result.message)`, never the raw frame.
10. **Receivers call `parseWireMessage` on the raw text frame.** `validateMessageObject` is for already-bounded objects (it now refuses more than 8192 values, 16 levels and sparse arrays without iterating them).

Behaviour that did not change: `seen()`, the message catalogue, the audio guard order, `parseWireMessage` and `validateMessageObject` signatures, id helpers, `MessageFactory` signatures.

## Modules

| Module | Purpose |
|---|---|
| `constants.ts` | `PROTOCOL_VERSION`, `MAX_MESSAGE_BYTES` (8192), every limit of PROTOCOL.md section 7, `PAIRING_ALPHABET`, `ERROR_CODES`, id regexes, enum lists (`TV_STAGES`, `MIC_STATES`, ...). |
| `types.ts` | `Role`, `ErrorCode`, `TvStage` (16 values, equal to `@atr/session-core`), `MicState`, `TransportState`, `AttemptState`, `Envelope`, one payload interface per type, `PayloadMap`, `WireMessage` (discriminated by `type`), `MessageType`, `MESSAGE_TYPES`. |
| `catalogue.ts` | `specFor(type)`, `isAllowedSender(type, role)`, `forwardTarget(type, sender?)`, `CATALOGUE`. Per type: senders, directions, `forwardTo`, `auth`, S/W/A identity rules, room rule, generation rule. |
| `text.ts` | `normalizeUserText`, `codePointLength`, `containsControlChars`, `hasLoneSurrogate`, `utf8ByteLength`, `displaySafe` (revision 4), `validatePhrase`, `validateCue`, `validateDeviceLabel`, `prepareUserText`. |
| `quantize.ts` | `quantizeDb`, `quantizeCoverage` (sender helpers), `isDbQuantized`, `isCoverageQuantized` (revision 4). |
| `snapshot.ts` | `takeSnapshot(input)`: the bounded single copy the validators validate and return (revision 4). |
| `validate.ts` | `parseWireMessage(raw, opts?)`, `validateMessageObject(obj, opts?)`. Never throw. |
| `ids.ts` | `createIdFactory(randomBytes?)`, `base64UrlEncode`. |
| `build.ts` | `MessageFactory`: fills the envelope, numbers messages, validates, serializes. |
| `sequence.ts` | `SequenceTracker` (`accept(expectedGeneration, generation, sequence)`, `check`, `commit`), `PerRoleSequenceTracker`, `MessageIdDedupe` (`has`, `record`, `forget`, `seen`), `DedupeScopes` (one dedupe per room and role). |
| `session-events.ts` | TV-local event types (PROTOCOL.md section 5), types only. |

## Validation (`validate.ts`)

```ts
import { parseWireMessage } from '@atr/protocol';

const result = parseWireMessage(frame);            // frame must be a string (text frame)
if (!result.ok) {
  // result.code is an ErrorCode, result.detail a static string of at most 64 characters
  // (never contains input content), result.ref_message_id the offending message_id only if well formed
} else {
  result.message;                                  // WireMessage: the validated snapshot (a clean copy; -0 is 0, quantised numbers canonical)
}
```

Order (PROTOCOL.md section 4): size, JSON, snapshot, envelope exact keys, protocol version, known type, audio guard, envelope formats and identity binding, payload schema (quantisation, text rules, cross-field invariants).

| Check | Code |
|---|---|
| Not a string (ArrayBuffer, typed array, Blob-like, number, object, ...) | `binary_rejected` |
| More than 8192 UTF-8 bytes (bytes, not characters; the cap can be lowered with `opts.maxBytes`, never raised) | `payload_too_large` |
| Invalid JSON, not an object, missing or unknown envelope field, `protocol_version !== 1`, non-string `type` | `bad_schema` |
| Unknown `type` string | `unknown_type` |
| Payload has a key named audio, pcm, samples, waveform, blob, buffer or data (any case, any depth), a string over 256 code points, an array over 16 elements, or binary data | `audio_rejected` |
| Envelope formats, identity binding, room and generation rules, `event_timestamp` outside +/-24 h of `opts.now` (default `Date.now()`), any payload schema violation, non-finite number | `bad_schema` |
| Impossible internal fault | `internal` |

`validateMessageObject(obj, opts)` is the same pipeline for an already-parsed value. It copies the input **once** into plain data (`takeSnapshot`: at most 8192 values and 16 levels; an array whose length exceeds the budget is refused without iterating; accessors, symbol keys, non-enumerable properties, holes and non-plain objects are refused; binary containers become an `audio_rejected` finding), applies the size limit to the snapshot's JSON, validates the snapshot and returns the snapshot, so a stateful Proxy cannot smuggle unvalidated data into the result. `NaN`, `Infinity` and `-Infinity` are rejected; `parseWireMessage` rejects `1e999` because it parses to `Infinity`.

Payload schemas are exact: every field required, unknown fields rejected, integers distinct from numbers, enum values, ranges, nullability, and the conditional rules:

- `precheck.start`: `quiet_check` requires `duration_ms: 5000`, `pre_window` requires `2000`.
- `window.start`: `calibration` requires `max_duration_ms: 6000`, `vowel` 1000..30000, `phrase` 8000; `phrase_position` (1..10) is non-null if and only if `kind` is `phrase`.
- `precheck.result` and `window.result`: `valid` is true if and only if `invalid_reason` is null.
- `precheck.result` (revision 4): reasons per purpose (`quiet_check` all eight including `silent_input`; `pre_window` only `interrupted`, `nonfinite`, `low_coverage`, `silent_input`, `clipped`, `burst_noise`); `duration_ms` within 50 ms of 5000 or 2000; `p20 <= floor <= p80 <= p95` over the non-null values; `valid` implies a non-null floor, `clipped_frames = 0` and `coverage >= 0.90`.
- `window.result` (revision 4): `frame_count <= expected_frames + 1`; `nonfinite_frames` and `clipped_frames <= frame_count`; `coverage` equals `min(1, (frame_count - nonfinite_frames) / expected_frames)` within 0.001 (0 when `expected_frames` is 0); `expected_frames` equals `floor(duration_ms / 50)` within 1; `longest_active_ms <= active_ms <= duration_ms`; `segments = 0` iff `active_ms = 0` iff `onset_ms = null`; `onset_ms <= duration_ms`; `valid` implies `coverage >= 0.90`, non-null `p50 <= p95 <= peak`.
- `level`: `frame_index` 0..700, `t_audio_ms` integer 0..35000 and `>= 50 * frame_index - 1`, `dbfs` -140..20.
- `window.start`: `vad_floor_dbfs` -110..-30.
- Quantisation: dB fields are multiples of 0.1 and `coverage` a multiple of 0.001, accepted when `|x * 10 - round(x * 10)| < 1e-6` (resp. `x * 1000`); the returned copy carries the canonical grid value, so a relay that forwards `JSON.stringify(result.message)` never forwards sub-grid precision. `quantizeDb(-23.14) === -23.1`; `quantizeCoverage(0.9996) === 1`; neither returns `-0`.
- `pairing_code`: exactly 6 characters from `ACDEFHJKMNPRTUVWXY3479`; credentials: exactly 43 base64url characters; `confirm_digits`: two ASCII digits; `join_id`: `j_` plus 8..40 base64url characters.

### Identity, room and generation (catalogue)

- `session_id`, `window_id`, `attempt_id` follow the S, W and A columns of PROTOCOL.md section 3: required means non-null, a dash means must be null. Exceptions in the document: `mic.state` may carry a `session_id`; `ack` identity is "as acked", treated as optional for all three.
- **Room rule (this package's reading, not tabulated in the document):** `room.create`, `join.request`, `join.pending` and `join.rejected` must have `room_id: null` (the phone is not a member yet and learns the room only from `join.accepted`); `auth.resume`, `ping`, `pong` and `error` may have either; every other type requires a room. `room.created`, `join.accepted` and `auth.resume` repeat `room_id` in the payload, and a non-null envelope `room_id` must equal it.
- **Generation rule:** relay-originated messages and the pre-auth types (`room.create`, `join.request`, `auth.resume`) carry `producer_generation: 0`; other types may carry any value in `0..2^31-1`.

### Direction, authentication, sequence

```ts
import { isAllowedSender, forwardTarget, specFor, SequenceTracker, MessageIdDedupe } from '@atr/protocol';

// relay, per frame, after parseWireMessage succeeded and the connection is authenticated:
const m = result.message;
if (m.sender_role !== connection.role || !isAllowedSender(m.type, m.sender_role)) { /* forbidden_direction */ }
if (specFor(m.type).auth === 'relay_origin') { /* clients may not send it */ }
const dedupe = scopes.scope(connection.roomId, m.sender_role);          // DedupeScopes: one per (room, role)
if (dedupe.has(m.message_id)) { /* duplicate: drop silently */ }
const verdict = tracker.check(room.generationOf(m.sender_role), m.producer_generation, m.sequence); // 'ok' | 'stale' | 'replay'
// ... rate limits, then, once the message is accepted:
tracker.commit(room.generationOf(m.sender_role), m.sequence);
dedupe.record(m.message_id);
const to = forwardTarget(m.type, m.sender_role);   // 'tv' | 'phone' | null (relay consumes it)
send(to, JSON.stringify(result.message));          // canonical re-serialisation, never the raw frame
```

`SequenceTracker.accept(expectedGeneration, generation, sequence)`: `expectedGeneration` is the authoritative current generation (assigned by the relay on authentication, never read from the message); a message with any other generation is `stale`; in the expected generation the sequence must be strictly greater than the last accepted, otherwise `replay`; a higher `expectedGeneration` starts a new sequence space and a lower one throws `RangeError`. `accept` records on `ok`; `check` + `commit` separate the two. `MessageIdDedupe` is a bounded LRU (default 1024): `has(id)` is a non-mutating test, `record(id)` remembers an accepted id (refreshing recency), `forget(id)` undoes it, `seen(id)` is the compatibility check-and-record. Scope one instance per (room, role) (`DedupeScopes`), otherwise one role can suppress the other's message that reuses an id, and record only after acceptance, otherwise a message dropped by a later step (rate limit) cannot be retransmitted with the same id.

## Text rules (`text.ts`)

User text (`phrase` 1..60, `cue` 1..12, `device_label` 1..24 code points) is NFC-normalized and trimmed by the **sender** with `normalizeUserText(s)`. The validators are **strict**: they reject text that is not already equal to `normalizeUserText(text)`, so validation is deterministic across runtimes and receivers never "repair" text. Order of rejection reasons: `not_string`, `lone_surrogate`, `control_chars` (U+0000-U+001F and U+007F-U+009F, which includes tab and newline), `not_normalized`, then `too_short` / `too_long` (counted in code points, so one emoji counts once).

```ts
const prepared = prepareUserText(input, 1, 60);    // normalizes, then validates
if (prepared.ok) send(prepared.text);              // otherwise show an inline error
```

Display safety (revision 4, `displaySafe(s)`, reference `docs/security/probes/text_policy_sketch.mjs`): after the checks above, phrases, cues and device labels (and `app_version`, which is not required to be NFC) are rejected when they contain U+202A-202E or U+2066-2069 (bidi embeddings, overrides, isolates), U+2028/2029, U+2060-2064, U+FEFF, U+FFF9-FFFF, U+FDD0-FDEF, tag characters U+E0000-E007F or the plane-end noncharacters (`forbidden_char`); consist only of whitespace and invisible fillers (`no_visible_content`: U+200B-200F, U+00AD, U+034F, U+061C, U+115F/1160, U+17B4/17B5, U+180B-180E, U+2800, U+3164, U+FE00-FE0F, U+FFA0); or stack more than four consecutive combining marks (`combining_run`). NFC text, ZWJ, ZWNJ, LRM, RLM, ALM, soft hyphen inside words, emoji sequences and variation selectors stay legal. The rule uses plain `[...]` classes built from escaped strings: no `\p{}`, no `u` flag, no look-behind, so it runs on Hermes. Rejection order: `not_string`, `lone_surrogate`, `control_chars`, `not_normalized`, `too_short`/`too_long`, then the display reasons.

Lengths are code points, not graphemes (nine family emoji are 63 code points and are rejected): say so in the phone's character counter. The TV should still render each user string in its own bidi-isolated, clipped text element (ADR review). Other string fields (`detail`, ids, codes) must not contain control characters or lone surrogates but are not normalized. Phrases are literal text: render them as text, never as HTML.

## Identifiers (`ids.ts`)

```ts
import { createIdFactory } from '@atr/protocol';
const ids = createIdFactory();            // uses crypto.getRandomValues when present
ids.message();                            // m_ + 22 base64url characters (16 random bytes)
ids.cryptographic;                        // false only when the Math.random + time + counter fallback is in use
```

Pass `createIdFactory(randomBytes)` to supply your own source (the Vega app should pass a platform CSPRNG if `globalThis.crypto` is missing; the fallback is NOT cryptographic and is acceptable only because these ids are identifiers, not secrets). Credentials and pairing codes are generated only by the relay.

## Building messages (`build.ts`)

```ts
import { MessageFactory, createIdFactory } from '@atr/protocol';

const tv = new MessageFactory({ role: 'tv', idFactory: createIdFactory(), clock: () => Date.now() });
// fresh connection, not authenticated yet: generation 0, no room
const create = tv.next('room.create', { client: { app_version: '0.1.0', platform: 'vega' } });
socket.send(tv.serialize(create));

// after room.created / auth.ok:
tv.setRoom(roomId);
tv.setGeneration(generation);             // sequence restarts at 0 for a new generation
const begin = tv.next('session.begin', { family_mode: true, phrase_count: 6, cues_max: 3 }, { session_id: ids.session() });
```

- `next(type, payload, ids?)` fills the envelope, increments the sequence, validates with `validateMessageObject` and **throws a descriptive Error** if the message is invalid or the role may not send the type (the sequence number is then not consumed). Error text carries only the validator's static detail, never payload content. `ids` may also set `room_id` for one message (a relay factory serving several rooms).
- Pre-auth types and the relay role always use generation 0 whatever the factory generation.
- `setRoom` to a different room and `setGeneration` to a different generation restart the sequence at 0. On a new connection call `setGeneration(0)` before sending `auth.resume`.
- `serialize(message)` re-validates the JSON text as a receiver would and enforces the 8192-byte limit.

## Errors and logging

`result.detail` and builder errors never contain input content; they are safe for `error.detail` and logs. Do not log message bodies anyway (ADR-0002).

## Interpretation choices (PROTOCOL.md rev 2 to 4 adopted the earlier ones)

Decisions taken while implementing revision 4, listed in the handoff for review:

1. `window.result.coverage` is compared with `min(1, (frame_count - nonfinite_frames) / expected_frames)`, because a window may carry one frame more than expected while `coverage` is capped at 1 (the DSP package computes the same capped value).
2. Quantisation is accepted with the specified tolerance (1e-6 on the scaled value) and the returned copy is canonicalised, so the tolerance cannot be used as a side channel on forwarded bytes (inside the tolerance a double still has about 24 free bits per field on the phone-to-relay hop; the relay's canonical re-serialisation removes them).
3. The cross-field invariants are exactly the review's list. Not covered (still accepted): `window.result` with `valid: true` and every frame clipped (probe P08), `no_voice` with `active_ms > 0` (P16), a calibration window with `duration_ms` 100 (P09), `level.dbfs` above full scale with `active: true` (P15), repeated `frame_index` (P14, needs per-window state in the TV) and `silent_input` with a floor above -110 dBFS.
4. `app_version` is display safe but not required to be NFC (it is not user text).
5. `SequenceTracker.check`/`accept` throw `RangeError` if `expectedGeneration` decreases and `TypeError` when called with the revision 3 argument list; malformed message numbers are `stale`.

## Limitations

- A passing test run proves schema and arithmetic behaviour of this package on the Node version that ran it. It does not prove behaviour on Hermes or on a Vega device. In particular `String.prototype.normalize` availability and correctness on Hermes/Vega is **not verified**; if it is missing the package falls back to a no-op, so on such a runtime `normalizeUserText` cannot compose text and the strict validator cannot detect decomposed input (it would accept it). Verify on the real Vega runtime before relying on NFC enforcement there.
- No MessageFactory or validator use under the Vega SDK has been attempted on this host.
