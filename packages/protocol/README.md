# @atr/protocol

Wire protocol v1 for "Across the Room: the far-side check": envelope, 37 message types, validators, builders, limits and replay helpers.

- Executable source of truth for [`docs/PROTOCOL.md`](../../docs/PROTOCOL.md) (revision 1). A test parses that document and fails if the message types, direction and auth columns, S/W/A identity columns, error codes, stage names or documented limits drift from this package.
- **Zero runtime dependencies.** TypeScript 5.8.3, ESM (NodeNext, relative imports end in `.js`). The build emits ES2019 so that Hermes does not need syntax transforms for classes, `?.` or `??`.
- Portable: no `Buffer`, no `crypto` module, no `TextEncoder`, no regex look-behind, no DOM. A test scans `src/` for these. It is designed for Node 22+, browsers and React Native (Hermes); the test suite was run on Node only (versions recorded in the handoff), never in a browser or on Hermes (see Limitations).
- It validates what a single message says. It does not know who sent it: direction, authentication, generation and sequence checks need connection context and use the helpers below.

```sh
npm run build -w @atr/protocol       # tsc -> dist/
npm run typecheck -w @atr/protocol
npm test -w @atr/protocol            # vitest
```

## Modules

| Module | Purpose |
|---|---|
| `constants.ts` | `PROTOCOL_VERSION`, `MAX_MESSAGE_BYTES` (8192), every limit of PROTOCOL.md section 7, `PAIRING_ALPHABET`, `ERROR_CODES`, id regexes, enum lists (`TV_STAGES`, `MIC_STATES`, ...). |
| `types.ts` | `Role`, `ErrorCode`, `TvStage` (16 values, equal to `@atr/session-core`), `MicState`, `TransportState`, `AttemptState`, `Envelope`, one payload interface per type, `PayloadMap`, `WireMessage` (discriminated by `type`), `MessageType`, `MESSAGE_TYPES`. |
| `catalogue.ts` | `specFor(type)`, `isAllowedSender(type, role)`, `forwardTarget(type, sender?)`, `CATALOGUE`. Per type: senders, directions, `forwardTo`, `auth`, S/W/A identity rules, room rule, generation rule. |
| `text.ts` | `normalizeUserText`, `codePointLength`, `containsControlChars`, `hasLoneSurrogate`, `utf8ByteLength`, `validatePhrase`, `validateCue`, `validateDeviceLabel`, `prepareUserText`. |
| `validate.ts` | `parseWireMessage(raw, opts?)`, `validateMessageObject(obj, opts?)`. Never throw. |
| `ids.ts` | `createIdFactory(randomBytes?)`, `base64UrlEncode`. |
| `build.ts` | `MessageFactory`: fills the envelope, numbers messages, validates, serializes. |
| `sequence.ts` | `SequenceTracker`, `PerRoleSequenceTracker`, `MessageIdDedupe`. |
| `session-events.ts` | TV-local event types (PROTOCOL.md section 5), types only. |

## Validation (`validate.ts`)

```ts
import { parseWireMessage } from '@atr/protocol';

const result = parseWireMessage(frame);            // frame must be a string (text frame)
if (!result.ok) {
  // result.code is an ErrorCode, result.detail a static string of at most 64 characters
  // (never contains input content), result.ref_message_id the offending message_id only if well formed
} else {
  result.message;                                  // WireMessage, a clean copy of the input
}
```

Order (PROTOCOL.md section 4): size, JSON, envelope exact keys, protocol version, known type, audio guard, envelope formats and identity binding, payload schema.

| Check | Code |
|---|---|
| Not a string (ArrayBuffer, typed array, Blob-like, number, object, ...) | `binary_rejected` |
| More than 8192 UTF-8 bytes (bytes, not characters; the cap can be lowered with `opts.maxBytes`, never raised) | `payload_too_large` |
| Invalid JSON, not an object, missing or unknown envelope field, `protocol_version !== 1`, non-string `type` | `bad_schema` |
| Unknown `type` string | `unknown_type` |
| Payload has a key named audio, pcm, samples, waveform, blob, buffer or data (any case, any depth), a string over 256 code points, an array over 16 elements, or binary data | `audio_rejected` |
| Envelope formats, identity binding, room and generation rules, `event_timestamp` outside +/-24 h of `opts.now` (default `Date.now()`), any payload schema violation, non-finite number | `bad_schema` |
| Impossible internal fault | `internal` |

`validateMessageObject(obj, opts)` is the same pipeline for an already-parsed value (it also applies the size limit to `JSON.stringify(obj)` and rejects accessors, symbol keys, non-plain objects and unserializable values). `NaN`, `Infinity` and `-Infinity` are rejected; `parseWireMessage` rejects `1e999` because it parses to `Infinity`.

Payload schemas are exact: every field required, unknown fields rejected, integers distinct from numbers, enum values, ranges, nullability, and the conditional rules:

- `precheck.start`: `quiet_check` requires `duration_ms: 5000`, `pre_window` requires `2000`.
- `window.start`: `calibration` requires `max_duration_ms: 6000`, `vowel` 1000..30000, `phrase` 8000; `phrase_position` (1..10) is non-null if and only if `kind` is `phrase`.
- `precheck.result` and `window.result`: `valid` is true if and only if `invalid_reason` is null.
- `level`: `frame_index` 0..700, `t_audio_ms` 0..35000, `dbfs` -140..20.
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
const verdict = tracker[m.sender_role].accept(m.producer_generation, m.sequence); // 'ok' | 'stale' | 'replay'
if (dedupe.seen(m.message_id)) { /* duplicate, do not forward */ }
const to = forwardTarget(m.type, m.sender_role);   // 'tv' | 'phone' | null (relay consumes it)
```

`SequenceTracker.accept(generation, sequence)`: a lower generation is `stale`; a higher generation starts a new sequence space (`ok`); in the same generation the sequence must be strictly greater than the last accepted, otherwise `replay`. Only `ok` changes state. `MessageIdDedupe` is a bounded LRU (default 1024): `seen(id)` returns true for a duplicate and refreshes its recency.

## Text rules (`text.ts`)

User text (`phrase` 1..60, `cue` 1..12, `device_label` 1..24 code points) is NFC-normalized and trimmed by the **sender** with `normalizeUserText(s)`. The validators are **strict**: they reject text that is not already equal to `normalizeUserText(text)`, so validation is deterministic across runtimes and receivers never "repair" text. Order of rejection reasons: `not_string`, `lone_surrogate`, `control_chars` (U+0000-U+001F and U+007F-U+009F, which includes tab and newline), `not_normalized`, then `too_short` / `too_long` (counted in code points, so one emoji counts once).

```ts
const prepared = prepareUserText(input, 1, 60);    // normalizes, then validates
if (prepared.ok) send(prepared.text);              // otherwise show an inline error
```

Other string fields (`app_version`, `detail`, ids, codes) must not contain control characters or lone surrogates but are not normalized. Phrases are literal text: render them as text, never as HTML.

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

## Interpretation choices to review (PROTOCOL.md is silent or ambiguous)

These are implemented conservatively and are listed in the task handoff with proposed document text:

1. Room rule per type and room repeat rule (above).
2. Pre-auth and relay messages use generation 0 (document: "0 for pre-auth messages", relay "producer_generation: 0").
3. `ack.acked_message_id` and `error.ref_message_id` must match the message id pattern (document says only "string"); an unparsable offending id is reported as `null`.
4. dBFS fields in `precheck.result` and `window.result` use the same -140..20 range as `level.dbfs`; frame counts are 0..700; durations 0..35000 ms; `valid` is true iff `invalid_reason` is null; `mic.state` `sample_rate` is 1..384000 and `channel_count` an integer 1..64.
5. `ack` is sent by the TV or the phone only; the document and ADR-0003 section 10 disagree about relay duplicate handling (`ack {status: duplicate}`), which has no counterpart here.
6. Payload epoch fields (`*_expires_at`, `expires_at`, `server_time`) are integers 0..2^53-1; `generation` fields are integers 0..2^31-1.

## Limitations

- A passing test run proves schema and arithmetic behaviour of this package on the Node version that ran it. It does not prove behaviour on Hermes or on a Vega device. In particular `String.prototype.normalize` availability and correctness on Hermes/Vega is **not verified**; if it is missing the package falls back to a no-op, so on such a runtime `normalizeUserText` cannot compose text and the strict validator cannot detect decomposed input (it would accept it). Verify on the real Vega runtime before relying on NFC enforcement there.
- No MessageFactory or validator use under the Vega SDK has been attempted on this host.
