# @atr/protocol adversarial review: parseWireMessage and validateMessageObject

- Task: T02 independent review / T16 preparation. Reviewer: security (`claude-sonnet-5-5`). Worktree `/Users/nihalnihalani/Desktop/Github/atr-worktrees/security`, branch `wt/security`, base `018bdc0` (package implemented by teammate `contracts`, reviewed by the lead). Nothing in `packages/protocol` was edited.
- Under test: `packages/protocol/src/**` at the base commit, built with `npx tsc -p packages/protocol/tsconfig.build.json --outDir <scratch>/dist` (the checked-in `dist/` was not used because it can be older than the source).
- Environment: Node v25.2.1 (project targets Node 22+/24; the validators use no Node-only API, but see PK-12 about Hermes). Run 2026-10-05, Asia/Kolkata.
- Baseline: `npm test -w @atr/protocol` from the worktree root: 11 test files, **746 tests passed** (vitest 3.2.4), exit 0.
- Evidence class: automated (adversarial probes against the package, synthetic inputs). It says nothing about the relay, TV or phone code that will call these functions.

## 1. Result summary

228 probes (`docs/security/probes/protocol_probes.mjs`): **150 PASS, 55 GAP, 22 INFO, 1 FAIL**.

- PASS: observed behaviour equals the documented contract and no change is recommended.
- GAP: behaviour equals the current rules, but a stricter rule is recommended (section 3).
- INFO: recorded for the reader, no change recommended.
- FAIL: observed differs from the documented contract. **One defect**: PK-01.

| Probe class | Result | Comment |
|---|---|---|
| Prototype pollution (`__proto__`, `constructor`, `prototype`, own `__proto__` key, null-prototype and inherited objects) | 8 PASS | All rejected with `bad_schema`; `Object.prototype` unchanged afterwards |
| Deep nesting, circular, BigInt, hidden `toJSON` | 7 PASS | No stack overflow or hang; 200,000-level object rejected in about 10 ms |
| Huge numbers, non-finite literals, 2^53, generation bounds | 6 PASS, 1 INFO | `1e999` becomes Infinity and is rejected |
| Escaped control characters in strings (C0, DEL, C1, NEL, TAB, LF, CR) | 9 PASS | All rejected |
| Surrogate halves, reversed pairs, as keys, in codes, in `str` fields | 10 PASS | `utf8ByteLength` equals `TextEncoder` on 20,000 random strings |
| Pairing-code homoglyphs and alphabet violations | 20 PASS, 1 INFO | Cyrillic, Greek, fullwidth, lowercase, excluded letters, trailing newline all rejected |
| BOM (leading, trailing, as bytes) | 3 PASS | `invalid JSON` or `binary_rejected` |
| Non-object JSON, batches, non-string inputs | 13 + 8 PASS | |
| Timestamps at plus or minus 24 h | 9 PASS | Boundary inclusive; one millisecond beyond rejected |
| Audio guard (keys, escaped keys, strings 256/257, arrays 16/17, typed arrays, Buffer) | 11 PASS | |
| Failure-detail leakage | 2 PASS, 1 INFO | Marker strings in 10 fields never reach `detail` or `ref_message_id` |
| Duplicate JSON keys | 4 GAP | Last value wins; raw frame still contains both (PK-04) |
| Format, bidi, invisible and visually empty characters | 12 + 12 + 3 GAP | PK-03 |
| Cross-field numeric semantics | 17 GAP | PK-02 |
| Negative zero | 2 GAP | PK-05 |
| TOCTOU on in-memory objects | 1 FAIL | PK-01 |

## 2. Specific questions

- **Prototype pollution.** Not exploitable through the validators: `JSON.parse` creates `__proto__` as an ordinary own key; the exact-key envelope and payload checks reject it as an unknown field (B01 to B07), and `cloneData` runs only after validation. B08 confirms `Object.prototype` unchanged.
- **Duplicate JSON keys.** `JSON.parse` keeps the last value silently (C01 to C04). All components in this stack use ECMAScript `JSON.parse`, so there is no parser differential today, but PROTOCOL.md section 2 says the relay "forwards the validated message unchanged". If the relay forwards the raw frame, a first-wins component in front of it (log scrubber, proxy, WAF) sees a different message than the receiver. Recommendation PK-04.
- **Deep nesting.** Payloads deeper than 8 levels are rejected by the iterative audit walk (D01, D02); the parser failure for 8190 open brackets is caught (D03). Programmatic objects 200,000 levels deep are rejected without recursion (D04).
- **Huge numbers and -0.** Non-finite and out-of-range values are rejected (E01 to E03, E07 to E09, E17). `-0` is accepted for `sequence`, `producer_generation`, `event_timestamp` and every `num` field (E05, E06); see PK-05.
- **Unicode-escaped control characters.** Rejected for every C0, DEL and C1 value (F-U+0000 to F-CR). U+2028 and U+2029 are not in the rejected ranges and are accepted (PK-03).
- **Surrogates.** Lone halves, reversed pairs and lone halves in keys, codes and `str` fields are rejected; valid pairs are accepted; length counts code points (60 emoji accepted, 61 rejected). Lone high surrogates in phrases: `bad_schema: invalid text` (G rows).
- **Homoglyph pairing codes.** The regex `^[ACDEFHJKMNPRTUVWXY3479]{6}$` rejects every non-alphabet code point, including trailing newline (JavaScript `$` without the `m` flag does not match before a final newline). The alphabet has 22 distinct symbols. Residual human look-alikes at 3 m inside the alphabet (U/V, M/N, E/F, 7/T, 4/A) are a TV font question, not a validator one.
- **BOM.** A BOM before or after the JSON text is `invalid JSON`; as bytes it is `binary_rejected`. A BOM in the middle of a phrase is accepted (PK-03).
- **Non-object JSON.** `null`, arrays, numbers, strings, booleans, `{}`, a batch containing a valid message, empty, whitespace-only, trailing garbage, comments, single quotes: all `bad_schema`. Non-string inputs (Buffer, Uint8Array, ArrayBuffer, Blob, number, undefined, null, a parsed object) to `parseWireMessage` all return `binary_rejected`. Safe, but note that an adapter that decodes a binary WebSocket frame to a string before calling the function bypasses the binary rejection (PK-10).
- **message_id collisions.** The validator checks format only (16 to 32 characters, so a client may choose a low-entropy id). `MessageIdDedupe` works as documented; two issues in PK-08.
- **Timestamps.** Exactly now plus or minus 24 h is accepted; one millisecond beyond is rejected; negative, fractional and 2^53-1 values are rejected. `opts.now = NaN` silently falls back to `Date.now()`, so the relay must never take `now` from a peer (L rows).
- **NFC versus NFKC.** The package normalises with NFC only and rejects text that is not already NFC and trimmed. Decision below.
- **U+202E and other direction controls.** Decision below.

### Decision: should phrases displayed on a TV reject U+202E?

**Yes.** Recommend rejecting U+202A to U+202E (embeddings and overrides) and U+2066 to U+2069 (isolates) in `phrases.update` phrases, `cue.text`, `join.request.device_label` and `room.create.client.app_version`. Reasons: (1) phrases are rendered on a screen read at 3 m by people who cannot inspect code points; an explicit override reorders what is displayed (the validator accepts `abc` U+202E `def` today: N-phrase-U+202E); (2) a paired phone or a compromised relay can send them even if the household never would; (3) household phrases in Arabic, Urdu, Persian or Hebrew display correctly under the Unicode bidirectional algorithm without explicit embeddings or overrides, so rejecting them costs no legitimate language; (4) `device_label` is shown on the TV at the moment the user decides whether to accept a pairing (ADR-0003 A3-06), the worst place for reordered text. Keep U+200E, U+200F and U+061C (implicit marks needed in mixed-direction text), keep U+200C and U+200D (required for Persian, Urdu, Devanagari and other scripts, and in emoji sequences). The TV should additionally render each user string in its own bidi-isolated text element and clip it; T17 verifies on the VVD. A reference rule that passes 30 positive and negative cases is in `docs/security/probes/text_policy_sketch.mjs` (pure ASCII, no look-behind, no property escapes, no `u` flag, so it should run on Hermes).

### Decision: NFC or NFKC?

Keep **NFC** for phrases and cues. NFKC would rewrite ligatures, fullwidth forms, superscripts and circled digits, which breaks "render literally" and changes what the household typed (M rows: U+FB01, fullwidth A and circled digits pass unchanged under NFC, which is the intent). NFC already folds canonical singletons: the Angstrom sign and the Kelvin sign are rejected as "not normalized" (M-Angstrom, M-Kelvin), and decomposed Hangul and `e` plus U+0301 are rejected. Confusable and compatibility characters matter for identity, and this protocol has no identifier made of user text: the only identity-like user string is `device_label`, which ADR-0003 treats as untrusted display text. `String.prototype.normalize` on Hermes or the Vega runtime is unverified (README says so); if it is missing, `normalizeUserText` is the identity and the TV-side check would accept non-NFC text while the Node relay still rejects it. Add a startup self-check on the VVD (PK-12).

## 3. Findings

**PK-01 [minor, defect] `validateMessageObject` returns a "clean copy" that can contain data it never validated.**
The function reads `value.payload` four times (JSON.stringify, audit guard, schema check, clone). With a stateful `Proxy` the clone read can differ from the validated read; accessor properties are rejected but Proxies are not. Wire data cannot be a Proxy, so this matters only for in-process callers, but the documented guarantee ("The returned message is a clean copy") is false in that case.
Minimal reproduction (probe D08):
```js
let reads = 0;
const base = { protocol_version: 1, type: 'ping', message_id: 'm_AAAAAAAAAAAAAAAA', room_id: null,
  session_id: null, window_id: null, attempt_id: null, sender_role: 'phone', producer_generation: 1,
  sequence: 1, event_timestamp: Date.now(), payload: {} };
const evil = new Proxy(base, { get(t, k, r) {
  if (k === 'payload') { reads += 1; return reads <= 3 ? {} : { injected: 'unvalidated' }; }
  return Reflect.get(t, k, r); } });
const r = validateMessageObject(evil);   // r.ok === true, r.message.payload.injected === 'unvalidated'
```
Proposed fix: snapshot the input once into plain data (`cloneData` after a bounded walk), validate the snapshot and return the snapshot.

**PK-02 [major] No cross-field or semantic invariants: impossible measurements are accepted.**
17 probes (P01 to P17) accept messages that no honest phone can produce, for example `valid:true` with `coverage 0.01`, `frame_count 700` against `expected_frames 160`, `active_ms 35000` in an 8000 ms window, `longest_active_ms` above `active_ms`, `valid:true` with all statistics null, `p50` above `p95` and `peak` below `p95`, `segments 0` with `onset_ms 300`, `valid:true` with every frame clipped, precheck percentiles out of order, `level` with `frame_index 0` and `t_audio_ms 35000`, and `vad_floor_dbfs 0` (ADR-0001 requires a floor of at most -30). R-S5 lists "impossible durations". A hijacked or buggy phone can therefore feed the TV a result that is internally inconsistent, and the TV's verdict code must either catch it or trust it.
Proposed invariants (schema `refine`, plus a TV recompute in session-core, see ADR-0001 A1-09):
- window.result: `frame_count <= expected_frames + 1`; `nonfinite_frames <= frame_count`, `clipped_frames <= frame_count`; `coverage` equals `(frame_count - nonfinite_frames) / expected_frames` within 0.001 (0 when `expected_frames` is 0); `expected_frames` equals `floor(duration_ms / 50)` within 1; `longest_active_ms <= active_ms <= duration_ms`; `segments = 0` iff `active_ms = 0` iff `onset_ms = null`; `onset_ms <= duration_ms`; when `valid`: `coverage >= 0.90`, `p50`, `p95` and `peak` non-null with `p50 <= p95 <= peak`.
- precheck.result: `p20 <= floor <= p80 <= p95` when non-null; `valid` implies `floor` non-null, `clipped_frames = 0`, `coverage >= 0.90`; `duration_ms` within 50 ms of 5000 (quiet_check) or 2000 (pre_window); `unstable_floor` and `too_loud` only for `quiet_check`.
- level: `t_audio_ms >= 50 * frame_index - 1`; strictly increasing `frame_index` per window and one frame per index (stateful, TV).
- window.start: `-110 <= vad_floor_dbfs <= -30` (with ADR-0001 A1-05).
These are consistency checks, not accuracy claims.

**PK-03 [major] Text policy accepts invisible, separator, bidi-override and tag characters.**
Accepted today (probe ids F-* and N-*): U+2028 and U+2029 (can break layout and log lines), U+200B, U+2060, U+FEFF inside a string, U+FFF9, U+FFFE, U+E000, tag characters such as U+E0041 (invisible, can smuggle data), all of U+202A to U+202E and U+2066 to U+2069, visually empty phrases (three U+200B, U+3164, U+2800: they pass `trim` and the one-character minimum, so the TV would show a blank prompt), and 59 stacked combining marks (a tall glyph that overflows the line). Recommended rule and the decisions on U+202E and NFC are in section 2; reference implementation and 30 self-checks in `text_policy_sketch.mjs`. Lengths are code points, not graphemes (nine family emoji are rejected at 63 code points); say so in the phone UI counter.

**PK-04 [minor] Duplicate keys survive in forwarded bytes.**
C01 shows `{"type":"ping","type":"unpair"}` validates as `unpair`; C04 shows an invalid first `payload` is never validated. Proposed fix: the relay forwards `JSON.stringify(result.message)` (the validated clean copy), never the raw frame. That removes duplicates, whitespace variants and escape variants in one step and needs no custom parser. Amend PROTOCOL.md section 2 ("forwards the validated message unchanged" becomes "forwards the canonical re-serialisation of the validated message"). Test SEC-V03.

**PK-05 [minor] Negative zero is accepted and preserved.** E05 and E06: `Object.is(sequence, -0)` is true after validation, and `Intl.NumberFormat` renders `-0`; `(-0.04).toFixed(1)` prints `-0.0`. Normalise `-0` to `0` in the clean copy (or reject it for integer fields).

**PK-06 [minor] Numeric fields carry unbounded precision, an unmonitored side channel.**
`level.dbfs` accepts `-23.123456789012345` (E16). A free 52-bit mantissa at 20 frames per second is 1,040 bit/s per numeric field (O-covert-capacity), enough for the lowest-rate speech codecs. The audio guard (keys, long strings, arrays) cannot see this. A validator cannot stop a malicious client, and R-X1 is enforced by code review and network inspection, but quantisation makes the payload audit exact and removes most of the capacity. Proposed fix: `dbfs` and other dB fields are multiples of 0.1 (about 11 bits per frame at most), `t_audio_ms` an integer, `coverage` a multiple of 0.001, and the network audit (SEC-P01) asserts the quantisation.

**PK-07 [minor] `SequenceTracker.accept` accepts any higher generation.**
K06: from generation 1, a message with generation 2^31-1 is `ok`; afterwards the legitimate generation 1 is `stale`. ADR-0003 section 9 requires the relay to compare the generation with the authoritative current value first, so the relay core is safe if it does, but the helper makes the unsafe path the easy one. Proposed fix: `accept(expectedGeneration, generation, sequence)` (or construct the tracker with the generation the relay assigned) so a jump cannot be expressed.

**PK-08 [minor] `MessageIdDedupe` scoping and ordering.**
(a) K03: one instance per room lets either role suppress the other's message that reuses an id; use one instance per (room, role). (b) PROTOCOL.md section 4 puts dedupe (step 8) before rate limits (step 9): an id recorded and then dropped for `rate_limited` makes a legitimate retransmission with the same id silently dropped as a duplicate. Record the id only after the message is accepted (or remove it on a later rejection). (c) K02: after 1,024 other ids the oldest id is evicted; at 40 messages per second that is about 26 s, after which only the sequence check protects (documented, fine). (d) The TV's non-cryptographic id fallback (`createIdFactory` without `crypto`) should be refused at startup if message ids are the dedupe key (`factory.cryptographic` is exposed for this).

**PK-09 [minor] `validateMessageObject` serialises before it bounds anything.**
S08 and `sparse_array_cost.mjs`: a sparse array of 2e7 elements costs about 100 ms; 5e7 about 1.2 s and 1.5 GB RSS; 1e8 about 2.3 s and 2.8 GB RSS (all end in `payload_too_large`). Harmless for strings through `parseWireMessage` (the size check precedes parsing: S05 rejects a 10 MB string in under a millisecond; worst single parse over 1,800 runs of six hostile 8 KB frames was 0.40 ms), but dangerous if any adapter passes untrusted in-memory objects. The session-core contract has `TvInput { kind: 'wire'; message: unknown }`, which invites exactly that. Proposed fix: document that receivers call `parseWireMessage` on the raw text frame only, and change the TV input to carry the raw string (`{ kind: 'wire_text'; text: string }`); keep `validateMessageObject` for already-bounded objects.

**PK-10 [minor] The validators are direction-blind by design; the relay must have one entry point.**
Q01 to Q03: a client can send `room.created` (relay only), `sender_role: "relay"`, or a TV-only `window.start` from the phone and the validator accepts the shape; `isAllowedSender` says no. This is documented, but several functions (`parseWireMessage`, `isAllowedSender`, `SequenceTracker`, `MessageIdDedupe`, rate limits) must be called in the right order by two adapters. Proposed fix: one `processInbound(rawFrame, connectionContext)` in `services/relay/core` that runs every step of PROTOCOL.md section 4 in order, a test that adapters call only it, and the TV mirrors it (reject `sender_role: "tv"` and TV-only types arriving from the relay side). Also assert text-frame-only at the adapter (`isBinary` check) before any decode.

**PK-11 [minor] Document and package drift.**
(a) PROTOCOL.md section 1 says user text "is NFC-normalized and trimmed before length checks"; the package rejects non-normalised text and sender helpers normalise (README: "strict"). Say "senders must normalise; receivers reject". (b) `packages/protocol/README.md` says revision 1; PROTOCOL.md is revision 2. (c) `vad_floor_dbfs` range -140..0 against ADR-0001 (PK-02). (d) `precheck.result.invalid_reason` values are valid for both purposes in the schema but ADR-0001 A1-06 restricts two of them to `quiet_check`. (e) `ack` identity columns are all optional; nothing ties an `ack` to the message it acknowledges (TV state must).

**PK-12 [info] Hermes `String.prototype.normalize`.** Unverified on Vega (README). If absent, `normalizeUserText` becomes the identity. Add a startup assertion that normalising the two-code-point sequence U+0065 U+0301 with NFC equals the single code point U+00E9 on the VVD and surface a diagnostics banner if it fails.

**PK-13 [info] `opts.now` and `opts.maxBytes`.** Caller-controlled by design (`maxBytes` can only be lowered; NaN `now` falls back to the wall clock). The relay must not derive either from peer input.

## 4. Appendix A: probe record (generated by `protocol_probes.mjs`)

Columns: probe id, input class, input, expected (the documented contract, or "ok" where the current rules accept it), observed (validator code and static detail, notes in parentheses), status.

| ID | Input class | Input | Expected | Observed | Status |
|---|---|---|---|---|---|
| A01 | control | valid ping | ok | ok(ping) | PASS |
| A02 | control | valid phrases.update (1 phrase) | ok | ok(phrases.update) | PASS |
| A03 | control | valid cue | ok | ok(cue) | PASS |
| A04 | control | valid join.request | ok | ok(join.request) | PASS |
| A05 | control | valid window.result | ok | ok(window.result) | PASS |
| A06 | control | valid precheck.result | ok | ok(precheck.result) | PASS |
| A07 | control | valid level | ok | ok(level) | PASS |
| B01 | prototype pollution | 13th envelope key "__proto__":{"polluted":"yes"} (raw JSON) | bad_schema | bad_schema: envelope has an unknown field | PASS |
| B02 | prototype pollution | ping payload {"__proto__":{"polluted":1}} | bad_schema | bad_schema: payload: unknown field | PASS |
| B03 | prototype pollution | cue payload with "constructor":{"prototype":{"x":1}} | bad_schema | bad_schema: payload: unknown field | PASS |
| B04 | prototype pollution | "message_id" renamed to "__proto__" (still 12 keys) | bad_schema | bad_schema: envelope has an unknown field | PASS |
| B05 | prototype pollution | phrases element is object {"__proto__":{}} | bad_schema | bad_schema: payload.phrases[0]: expected string | PASS |
| B06 | prototype pollution | validateMessageObject(Object.create({polluted:1}) with envelope fields) | bad_schema | bad_schema: message is not an object | PASS |
| B07 | prototype pollution | validateMessageObject(JSON.parse(B01)) with own "__proto__" key | bad_schema | bad_schema: envelope has an unknown field | PASS |
| B08 | prototype pollution | global state after B01-B07: ({}).polluted, ({}).x, Object.prototype own keys | clean | clean | PASS |
| C01 | duplicate keys | "type" appears twice ("ping" then "unpair") | ok | ok(unpair) (last wins: parsed type=unpair; a first-wins component (log scrubber, proxy) would see "ping". Forward a canonical re-serialization, not the raw frame.) | GAP |
| C02 | duplicate keys | "message_id" twice (B..., then A...) | ok | ok(ping) (clean copy carries m_AAAAAAAAAAAAAAAA; raw frame still contains both ids) | GAP |
| C03 | duplicate keys | cue payload "text" twice | ok | ok(cue) (kept: Volume) | GAP |
| C04 | duplicate keys | "payload" twice (first invalid, last valid) | ok | ok(ping) (first payload is never validated; only the last survives parsing) | GAP |
| D01 | deep nesting | ping payload nested 9 objects deep (raw) | bad_schema | bad_schema: payload nested too deeply | PASS |
| D02 | deep nesting | payload = 3900 nested arrays (8040 bytes raw, under the cap) | bad_schema | bad_schema: payload nested too deeply | PASS |
| D03 | deep nesting | 8190 x "[" raw frame (parser stress) | bad_schema | bad_schema: invalid JSON | PASS |
| D04 | deep nesting | validateMessageObject, payload 200000 levels deep (programmatic) | bad_schema\|payload_too_large | payload_too_large: message exceeds the size limit (no crash; 9.5 ms) | PASS |
| D05 | deep nesting | validateMessageObject, circular payload | bad_schema | bad_schema: message is not serializable | PASS |
| D06 | deep nesting | validateMessageObject, BigInt in payload | bad_schema | bad_schema: message is not serializable | PASS |
| D07 | deep nesting | validateMessageObject, non-enumerable toJSON that hides content from the size check | bad_schema | bad_schema: message is not plain data | PASS |
| D08 | TOCTOU | stateful Proxy whose 4th read of "payload" (the clone step) returns {injected:"unvalidated"} | bad_schema | ok(ping) (clean copy contains unvalidated field: true; validate a clone made once, not the original object) | FAIL |
| E01 | huge numbers | sequence 1e999 (raw, parses to Infinity) | bad_schema | bad_schema: sequence: out of range | PASS |
| E02 | huge numbers | sequence -1e999 | bad_schema | bad_schema: sequence: out of range | PASS |
| E03 | huge numbers | sequence 9007199254740993 (rounds to 2^53) | bad_schema | bad_schema: sequence: out of range | PASS |
| E04 | huge numbers | sequence 9007199254740991 (MAX_SAFE_INTEGER) | ok | ok(ping) (legal; a producer that sends it exhausts its own sequence space until it resumes with a new generation) | INFO |
| E05 | negative zero | sequence -0 (raw) | ok | ok(ping) (Object.is(sequence,-0)=true; Intl.NumberFormat renders "-0"; normalise to +0 in the clean copy) | GAP |
| E06 | negative zero | level.dbfs -0 | ok | ok(level) (Object.is(dbfs,-0)=true; (-0.04).toFixed(1) would print -0.0) | GAP |
| E07 | huge numbers | producer_generation 2147483648 (2^31) | bad_schema | bad_schema: producer_generation: out of range | PASS |
| E08 | huge numbers | producer_generation 2147483647 | ok | ok(ping) | PASS |
| E09 | huge numbers | level.dbfs 1e308 | bad_schema | bad_schema: payload.dbfs: out of range | PASS |
| E10 | numbers | sequence as string "5" | bad_schema | bad_schema: sequence: out of range | PASS |
| E11 | numbers | sequence 1.5 | bad_schema | bad_schema: sequence: out of range | PASS |
| E12 | numbers | sequence 1e2 and 100.0 (non-canonical integer spellings) | ok | ok(ping) (accepted; spelling is not preserved by JSON.parse, so no differential) | INFO |
| E13 | numbers | NaN literal in raw JSON | bad_schema | bad_schema: invalid JSON | PASS |
| E14 | numbers | Infinity literal in raw JSON | bad_schema | bad_schema: invalid JSON | PASS |
| E15 | numbers | level.frame_index 701 | bad_schema | bad_schema: payload.frame_index: out of range | PASS |
| E16 | numbers | level.dbfs = -23.123456789012345 (15 digits) | ok | ok(level) (unbounded mantissa precision is a covert channel (see review, section 3)) | GAP |
| E17 | numbers | window.result.coverage 1.0000001 | bad_schema | bad_schema: payload.coverage: out of range | PASS |
| F-U+0000 | escaped control char | phrase "aU+0000b" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-U+001F | escaped control char | phrase "aU+001Fb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-U+007F | escaped control char | phrase "aU+007Fb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-U+0080 | escaped control char | phrase "aU+0080b" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-U+0085 NEL | escaped control char | phrase "aU+0085 NELb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-U+009F | escaped control char | phrase "aU+009Fb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-TAB | escaped control char | phrase "aTABb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-LF | escaped control char | phrase "aLFb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-CR | escaped control char | phrase "aCRb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-U+2028 LINE SEP | format/invisible char | phrase "aU+2028 LINE SEPb" | ok | ok(phrases.update) | GAP |
| F-U+2029 PARA SEP | format/invisible char | phrase "aU+2029 PARA SEPb" | ok | ok(phrases.update) | GAP |
| F-U+200B ZWSP | format/invisible char | phrase "aU+200B ZWSPb" | ok | ok(phrases.update) | GAP |
| F-U+200C ZWNJ | format/invisible char | phrase "aU+200C ZWNJb" | ok | ok(phrases.update) | GAP |
| F-U+200D ZWJ | format/invisible char | phrase "aU+200D ZWJb" | ok | ok(phrases.update) | GAP |
| F-U+2060 WORD JOINER | format/invisible char | phrase "aU+2060 WORD JOINERb" | ok | ok(phrases.update) | GAP |
| F-U+FEFF BOM mid-string | format/invisible char | phrase "aU+FEFF BOM mid-stringb" | ok | ok(phrases.update) | GAP |
| F-U+00AD SOFT HYPHEN | format/invisible char | phrase "aU+00AD SOFT HYPHENb" | ok | ok(phrases.update) | GAP |
| F-U+FFFE noncharacter | format/invisible char | phrase "aU+FFFE noncharacterb" | ok | ok(phrases.update) | GAP |
| F-U+FFF9 interlinear | format/invisible char | phrase "aU+FFF9 interlinearb" | ok | ok(phrases.update) | GAP |
| F-U+E000 private use | format/invisible char | phrase "aU+E000 private useb" | ok | ok(phrases.update) | GAP |
| F-U+E0041 TAG LATIN A (surrogate pair) | format/invisible char | phrase "aU+E0041 TAG LATIN A (surrogate pair)b" | ok | ok(phrases.update) | GAP |
| F-3 x U+200B only | visually empty phrase | phrase = 3 x U+200B only | ok | ok(phrases.update) (passes trim and the 1-code-point minimum but renders as blank) | GAP |
| F-U+3164 HANGUL FILLER | visually empty phrase | phrase = U+3164 HANGUL FILLER | ok | ok(phrases.update) (passes trim and the 1-code-point minimum but renders as blank) | GAP |
| F-U+2800 BRAILLE BLANK | visually empty phrase | phrase = U+2800 BRAILLE BLANK | ok | ok(phrases.update) (passes trim and the 1-code-point minimum but renders as blank) | GAP |
| F-leading-space | trim | phrase " Hello" | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| F-trailing-nbsp | trim | phrase "Hello\u00a0" | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| F-trailing-2028 | trim | phrase "Hello\u2028" (edge) | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| F-whitespace-only | trim | phrase "   " | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| F-empty | length | phrase "" | bad_schema | bad_schema: payload.phrases[0]: too short | PASS |
| F-1char | length | phrase "I" (1 code point) | ok | ok(phrases.update) (see ADR-0001 finding: a 1-syllable phrase cannot reach active_ms >= 400) | INFO |
| F-60ascii | length | phrase 60 x "a" | ok | ok(phrases.update) | PASS |
| F-61ascii | length | phrase 61 x "a" | bad_schema | bad_schema: payload.phrases[0]: too long | PASS |
| F-60emoji | length | phrase 60 x U+1F600 (120 UTF-16 units, 240 bytes) | ok | ok(phrases.update) | PASS |
| F-61emoji | length | phrase 61 x U+1F600 | bad_schema | bad_schema: payload.phrases[0]: too long | PASS |
| F-zwj-family | length | 9 x family emoji (7 code points each = 63) | bad_schema | bad_schema: payload.phrases[0]: too long (length is code points, not grapheme clusters: 9 visible glyphs are rejected) | INFO |
| F-combining-stack | combining marks | "x" + 59 x U+0301 (NFC-stable, 60 code points) | ok | ok(phrases.update) (renders as a tall stacked glyph; limit consecutive combining marks (<= 4) or clip the container) | GAP |
| F-device-label-24emoji | length | device_label 24 emoji (96 bytes) | ok | ok(join.request) | PASS |
| F-device-label-25 | length | device_label 25 chars | bad_schema | bad_schema: payload.device_label: too long | PASS |
| G-lone high U+D800 | surrogate | phrase lone high U+D800 | bad_schema | bad_schema: payload.phrases[0]: invalid text | PASS |
| G-lone low U+DC00 | surrogate | phrase lone low U+DC00 | bad_schema | bad_schema: payload.phrases[0]: invalid text | PASS |
| G-high at end | surrogate | phrase high at end | bad_schema | bad_schema: payload.phrases[0]: invalid text | PASS |
| G-high before ASCII | surrogate | phrase high before ASCII | bad_schema | bad_schema: payload.phrases[0]: invalid text | PASS |
| G-reversed pair low,high | surrogate | phrase reversed pair low,high | bad_schema | bad_schema: payload.phrases[0]: invalid text | PASS |
| G-valid pair U+1F600 | surrogate | phrase valid pair U+1F600 | ok | ok(phrases.update) | PASS |
| G-key | surrogate | payload key "\ud800" (lone surrogate as key name) | bad_schema | bad_schema: payload: unknown field | PASS |
| G-pairing-code | surrogate | pairing_code containing lone high surrogate | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| G-app-version | surrogate | room.create app_version lone surrogate | bad_schema | bad_schema: payload.client.app_version: invalid text | PASS |
| G-utf8-len | surrogate | utf8ByteLength vs TextEncoder over 20000 random strings with lone/paired surrogates | match | match | PASS |
| H-valid | pairing code | join.request pairing_code "ACDEFH" | ok | ok(join.request) | PASS |
| H-lowercase | pairing code | join.request pairing_code "acdefh" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-Cyrillic A U+0410 | pairing code | join.request pairing_code "<U+0410>CDEFH" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-Greek Alpha U+0391 | pairing code | join.request pairing_code "<U+0391>CDEFH" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-fullwidth A U+FF21 | pairing code | join.request pairing_code "<U+FF21>CDEFH" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-Latin O (not in alphabet) | pairing code | join.request pairing_code "ACDEFO" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-digit zero | pairing code | join.request pairing_code "ACDEF0" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-digit one | pairing code | join.request pairing_code "ACDEF1" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-letter I | pairing code | join.request pairing_code "ACDEFI" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-letter L | pairing code | join.request pairing_code "ACDEFL" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-digit 5 | pairing code | join.request pairing_code "ACDEF5" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-letter S | pairing code | join.request pairing_code "ACDEFS" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-digit 8 | pairing code | join.request pairing_code "ACDEF8" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-letter B | pairing code | join.request pairing_code "ACDEFB" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-trailing newline | pairing code | join.request pairing_code "ACDEFH\n" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-5 chars | pairing code | join.request pairing_code "ACDEF" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-7 chars | pairing code | join.request pairing_code "ACDEFHJ" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-zero-width inside | pairing code | join.request pairing_code "AC<U+200B>DEFH" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-leading space | pairing code | join.request pairing_code " ACDEF" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-NUL | pairing code | join.request pairing_code "ACDEF\u0000" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-alphabet | pairing code | alphabet "ACDEFHJKMNPRTUVWXY3479": 22 distinct symbols; 22^6 = 113379904 | 22 | 22 (residual look-alike pairs at 3 m for human review: U/V, M/N, E/F, 7/T, 4/A) | INFO |
| I01 | BOM | leading U+FEFF before a valid frame | bad_schema | bad_schema: invalid JSON | PASS |
| I02 | BOM | trailing U+FEFF after a valid frame | bad_schema | bad_schema: invalid JSON | PASS |
| I03 | BOM | UTF-8 BOM bytes EF BB BF + JSON as a Buffer (binary) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-null | non-object JSON | raw "null" | bad_schema | bad_schema: message is not an object | PASS |
| J-empty array | non-object JSON | raw "[]" | bad_schema | bad_schema: message is not an object | PASS |
| J-number | non-object JSON | raw "1" | bad_schema | bad_schema: message is not an object | PASS |
| J-string | non-object JSON | raw "\"x\"" | bad_schema | bad_schema: message is not an object | PASS |
| J-true | non-object JSON | raw "true" | bad_schema | bad_schema: message is not an object | PASS |
| J-empty object | non-object JSON | raw "{}" | bad_schema | bad_schema: envelope is missing a field | PASS |
| J-batch [valid message] | non-object JSON | raw "[{\"protocol_version\":1,\"type\":\"ping\",..." | bad_schema | bad_schema: message is not an object | PASS |
| J-empty string | non-object JSON | raw "" | bad_schema | bad_schema: invalid JSON | PASS |
| J-whitespace only | non-object JSON | raw "   " | bad_schema | bad_schema: invalid JSON | PASS |
| J-valid + trailing garbage | non-object JSON | raw "{\"protocol_version\":1,\"type\":\"ping\",\"..." | bad_schema | bad_schema: invalid JSON | PASS |
| J-trailing comma | non-object JSON | raw "{\"a\":1,}" | bad_schema | bad_schema: invalid JSON | PASS |
| J-comment | non-object JSON | raw "/*c*/{}" | bad_schema | bad_schema: invalid JSON | PASS |
| J-single quotes | non-object JSON | raw "{'a':1}" | bad_schema | bad_schema: invalid JSON | PASS |
| J-input-Buffer | non-string input | parseWireMessage(Buffer) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-Uint8Array | non-string input | parseWireMessage(Uint8Array) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-ArrayBuffer | non-string input | parseWireMessage(ArrayBuffer) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-Blob | non-string input | parseWireMessage(Blob) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-number | non-string input | parseWireMessage(number) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-undefined | non-string input | parseWireMessage(undefined) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-null | non-string input | parseWireMessage(null) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-parsed object | non-string input | parseWireMessage(parsed object) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| K01 | message_id | same id twice | true | true | PASS |
| K02 | message_id | after 1024 further distinct ids the first id is evicted; resend of it | false | false (after eviction only the sequence check stops a replay; at 40 msgs/s the window is ~26 s) | INFO |
| K03 | message_id | id first used by role "phone", then by role "tv" in the same dedupe instance | true | true (API has no role parameter: one instance per room lets either role suppress the other's message that reuses an id; use one instance per (room, role)) | GAP |
| K04 | message_id | ids differing only in case are distinct | false | false | PASS |
| K05 | message_id | length 16 and 32 accepted, 15 and 33 rejected | ok,ok,bad_schema,bad_schema | ok,ok,bad_schema,bad_schema (format allows low-entropy chosen ids (e.g. 16 x "A"); uniqueness is not enforced by the validator) | PASS |
| K06 | sequence | SequenceTracker: generation jump to 2^31-1 from a producer on generation 1 | ok | ok (tracker accepts ANY higher generation; relay must first compare to the authoritative current generation (ADR-0003 section 9). Afterwards legit generation 1 is stale: stale) | GAP |
| K07 | sequence | tracker: same sequence twice | replay | replay | PASS |
| L-now | timestamp | event_timestamp now (receiver now fixed) | ok | ok(ping) | PASS |
| L-now+24h | timestamp | event_timestamp now+24h (receiver now fixed) | ok | ok(ping) | PASS |
| L-now+24h+1ms | timestamp | event_timestamp now+24h+1ms (receiver now fixed) | bad_schema | bad_schema: event_timestamp: outside allowed skew | PASS |
| L-now-24h | timestamp | event_timestamp now-24h (receiver now fixed) | ok | ok(ping) | PASS |
| L-now-24h-1ms | timestamp | event_timestamp now-24h-1ms (receiver now fixed) | bad_schema | bad_schema: event_timestamp: outside allowed skew | PASS |
| L-0 | timestamp | event_timestamp 0 (receiver now fixed) | bad_schema | bad_schema: event_timestamp: outside allowed skew | PASS |
| L--1 | timestamp | event_timestamp -1 (receiver now fixed) | bad_schema | bad_schema: event_timestamp: expected integer | PASS |
| L-1.5 | timestamp | event_timestamp 1.5 (receiver now fixed) | bad_schema | bad_schema: event_timestamp: expected integer | PASS |
| L-MAX_SAFE_INTEGER | timestamp | event_timestamp MAX_SAFE_INTEGER (receiver now fixed) | bad_schema | bad_schema: event_timestamp: outside allowed skew | PASS |
| L-now-NaN | timestamp | opts.now = NaN (caller bug) with ts = real Date.now() | ok | ok(ping) (falls back to Date.now(); relay must never take opts.now from the peer) | INFO |
| L-maxBytes-raise | size | opts.maxBytes = 1e9 (attempt to raise the cap) | ok | ok(ping) (cap is min(opts.maxBytes, 8192)) | INFO |
| M-NFD e+U+0301 | normalization | phrase NFD e+U+0301 | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| M-NFC precomposed | normalization | phrase NFC precomposed | ok | ok(phrases.update) | PASS |
| M-Angstrom sign U+212B | normalization | phrase Angstrom sign U+212B | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| M-Kelvin sign U+212A | normalization | phrase Kelvin sign U+212A | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| M-Hangul decomposed jamo | normalization | phrase Hangul decomposed jamo | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| M-ligature U+FB01 (NFKC differs) | normalization | phrase ligature U+FB01 (NFKC differs) | ok | ok(phrases.update) (literal text preserved; NFKC would corrupt user text and is not recommended for phrases) | INFO |
| M-fullwidth A (NFKC differs) | normalization | phrase fullwidth A (NFKC differs) | ok | ok(phrases.update) (literal text preserved; NFKC would corrupt user text and is not recommended for phrases) | INFO |
| M-circled digit (NFKC differs) | normalization | phrase circled digit (NFKC differs) | ok | ok(phrases.update) (literal text preserved; NFKC would corrupt user text and is not recommended for phrases) | INFO |
| M-Devanagari with ZWJ (legit) | normalization | phrase Devanagari with ZWJ (legit) | ok | ok(phrases.update) | PASS |
| M-normalize-available | normalization | String.prototype.normalize present in this runtime | true | true (on Hermes/Vega this is unverified; if absent, normalizeUserText is the identity and non-NFC text would pass the TV-side check (relay still enforces on Node)) | INFO |
| N-phrase-U+202A LRE | bidi control | phrase "abcU+202A LREdef" | ok | ok(phrases.update) (explicit override/embedding/isolate; recommend reject) | GAP |
| N-phrase-U+202B RLE | bidi control | phrase "abcU+202B RLEdef" | ok | ok(phrases.update) (explicit override/embedding/isolate; recommend reject) | GAP |
| N-phrase-U+202C PDF | bidi control | phrase "abcU+202C PDFdef" | ok | ok(phrases.update) (explicit override/embedding/isolate; recommend reject) | GAP |
| N-phrase-U+202D LRO | bidi control | phrase "abcU+202D LROdef" | ok | ok(phrases.update) (explicit override/embedding/isolate; recommend reject) | GAP |
| N-phrase-U+202E RLO | bidi control | phrase "abcU+202E RLOdef" | ok | ok(phrases.update) (explicit override/embedding/isolate; recommend reject) | GAP |
| N-phrase-U+2066 LRI | bidi control | phrase "abcU+2066 LRIdef" | ok | ok(phrases.update) (explicit override/embedding/isolate; recommend reject) | GAP |
| N-phrase-U+2067 RLI | bidi control | phrase "abcU+2067 RLIdef" | ok | ok(phrases.update) (explicit override/embedding/isolate; recommend reject) | GAP |
| N-phrase-U+2068 FSI | bidi control | phrase "abcU+2068 FSIdef" | ok | ok(phrases.update) (explicit override/embedding/isolate; recommend reject) | GAP |
| N-phrase-U+2069 PDI | bidi control | phrase "abcU+2069 PDIdef" | ok | ok(phrases.update) (explicit override/embedding/isolate; recommend reject) | GAP |
| N-phrase-U+200E LRM | bidi control | phrase "abcU+200E LRMdef" | ok | ok(phrases.update) (implicit marks are legitimate in mixed-direction text; keep allowed) | INFO |
| N-phrase-U+200F RLM | bidi control | phrase "abcU+200F RLMdef" | ok | ok(phrases.update) (implicit marks are legitimate in mixed-direction text; keep allowed) | INFO |
| N-phrase-U+061C ALM | bidi control | phrase "abcU+061C ALMdef" | ok | ok(phrases.update) (implicit marks are legitimate in mixed-direction text; keep allowed) | INFO |
| N-label-RLO | bidi control | device_label "Mom\u202es phone" (shown on the TV at pairing) | ok | ok(join.request) | GAP |
| N-cue-RLO | bidi control | cue "Vol\u202eume" | ok | ok(cue) | GAP |
| N-appver-RLO | bidi control | room.create app_version "1.0\u202e" | ok | ok(room.create) | GAP |
| O01 | audio guard | cue payload extra key "Data" | audio_rejected | audio_rejected: payload contains an audio-like field | PASS |
| O02 | audio guard | key spelled "d\u0061ta" (escaped) | audio_rejected | audio_rejected: payload contains an audio-like field | PASS |
| O03 | audio guard | cue.text of 257 code points | audio_rejected | audio_rejected: payload contains an oversized string | PASS |
| O04 | audio guard | cue.text of 256 code points (schema says max 12) | bad_schema | bad_schema: payload.text: too long | PASS |
| O05 | audio guard | phrases array of 17 items | audio_rejected | audio_rejected: payload contains an oversized array | PASS |
| O06 | audio guard | phrases array of 11 items (schema max 10, guard max 16) | bad_schema | bad_schema: payload.phrases: too many items | PASS |
| O-Float32Array | audio guard | validateMessageObject, payload.x = Float32Array | audio_rejected\|bad_schema | audio_rejected: payload contains binary data | PASS |
| O-Uint8Array | audio guard | validateMessageObject, payload.x = Uint8Array | audio_rejected\|bad_schema | audio_rejected: payload contains binary data | PASS |
| O-ArrayBuffer | audio guard | validateMessageObject, payload.x = ArrayBuffer | audio_rejected\|bad_schema | audio_rejected: payload contains binary data | PASS |
| O-Buffer | audio guard | validateMessageObject, payload.x = Buffer | audio_rejected\|bad_schema | audio_rejected: payload contains binary data | PASS |
| O-Blob | audio guard | validateMessageObject, payload.x = Blob | audio_rejected\|bad_schema | audio_rejected: payload contains binary data | PASS |
| O-covert-capacity | audio guard | level.dbfs with a free 52-bit mantissa at 20 frames/s | n/a | 1040 bit/s (130 B/s) per numeric field, before t_audio_ms (not blocked by the guard; low-rate speech codecs run at 0.7-2.4 kbit/s. Recommend quantized numeric fields.) | INFO |
| P01 | cross-field semantics | valid:true with coverage 0.01 | ok | ok(window.result) | GAP |
| P02 | cross-field semantics | frame_count 700 > expected_frames 160 | ok | ok(window.result) | GAP |
| P03 | cross-field semantics | active_ms 35000 > duration_ms 8000 | ok | ok(window.result) | GAP |
| P04 | cross-field semantics | longest_active_ms 8000 > active_ms 3000 | ok | ok(window.result) | GAP |
| P05 | cross-field semantics | valid:true but p95_active/p50/peak all null | ok | ok(window.result) | GAP |
| P06 | cross-field semantics | p50 (-10) > p95 (-20) and peak (-30) < p95 | ok | ok(window.result) | GAP |
| P07 | cross-field semantics | segments 0 but onset_ms 300 and active_ms 3000 | ok | ok(window.result) | GAP |
| P08 | cross-field semantics | valid:true with clipped_frames 160 (all frames) | ok | ok(window.result) | GAP |
| P09 | cross-field semantics | window.result kind "calibration" with duration_ms 100 | ok | ok(window.result) | GAP |
| P10 | cross-field semantics | precheck valid:true with floor_dbfs null | ok | ok(precheck.result) | GAP |
| P11 | cross-field semantics | precheck p20 (-40) > p80 (-70), floor outside [p20,p80] | ok | ok(precheck.result) | GAP |
| P12 | cross-field semantics | precheck valid:true with floor_dbfs 0 (loud) and clipped_frames 100 | ok | ok(precheck.result) | GAP |
| P13 | cross-field semantics | level frame_index 0 with t_audio_ms 35000 | ok | ok(level) | GAP |
| P14 | cross-field semantics | level frame_index 5 repeated with new message_id/sequence (replayed frame) | ok | ok(level) | GAP |
| P15 | cross-field semantics | level dbfs 20 (above full scale) active:true clipped:false | ok | ok(level) | GAP |
| P16 | cross-field semantics | window.result invalid_reason "no_voice" with active_ms 3000 | ok | ok(window.result) | GAP |
| P17 | cross-field semantics | window.start vad_floor_dbfs 0 (ADR: floor <= -30) | ok | ok(window.start) | GAP |
| Q01 | direction | relay-only type room.created sent with sender_role "phone" | ok | ok(room.created) (validator is direction-blind by design; isAllowedSender("room.created","phone")=false) | INFO |
| Q02 | direction | client sends sender_role "relay" ping | ok | ok(ping) (isAllowedSender("ping","relay")=false) | INFO |
| Q03 | direction | phone sends TV-only window.start | ok | ok(window.start) (isAllowedSender("window.start","phone")=false) | INFO |
| Q04 | identity | ping with session_id set | bad_schema | bad_schema: session_id: must be null | PASS |
| Q05 | identity | join.request with room_id set | bad_schema | bad_schema: room_id: must be null | PASS |
| Q06 | identity | level with null room_id | bad_schema | bad_schema: room_id: required | PASS |
| Q07 | identity | auth.resume envelope room differs from payload room | bad_schema | bad_schema: room_id: differs from payload | PASS |
| Q08 | identity | pre-auth type with generation 1 | bad_schema | bad_schema: producer_generation: must be 0 | PASS |
| S01 | size | valid ping padded with trailing spaces to exactly 8192 bytes | ok | ok(ping) | PASS |
| S02 | size | 8193 bytes | payload_too_large | payload_too_large: message exceeds the size limit | PASS |
| S03 | size | largest legal phrase bank: 10 x 60 emoji (600 code points x 4 bytes = 2400 B + envelope) | ok | ok(phrases.update) (2709 bytes; the 8192-byte cap has about 3x headroom for every schema-legal message) | INFO |
| S04 | size | legal phrase bank 10 x 60 CJK (3 bytes each = 1800 B) | ok | ok(phrases.update) | PASS |
| S05 | size | 10 MB string frame | payload_too_large | payload_too_large: message exceeds the size limit (0.00 ms) | PASS |
| S06 | size | object with 800 unknown keys (7091 B, under the cap) | bad_schema | bad_schema: envelope has an unknown field (0.29 ms) | PASS |
| S07 | timing | worst single parse over 1800 runs of 6 hostile 8 KB frames | fast | fast (worst 0.47 ms on this host (Node v25.2.1); not a load test) | INFO |
| S08 | serialize-then-check | validateMessageObject with payload.x = sparse Array(2e7) (programmatic object) | bad_schema\|payload_too_large | payload_too_large: message exceeds the size limit (105 ms; validateMessageObject calls JSON.stringify before any bound (sparse_array_cost.mjs: 1e8 elements = about 2.3 s and 2.7 to 2.8 GB RSS). Safe for strings via parseWireMessage; a hazard for untrusted in-memory objects) | GAP |
| T01 | information leak | marker string placed in 10 different fields; any in detail/ref_message_id? | none | none | PASS |
| T02 | information leak | unknown type: ref_message_id echoes only a well-formed client id | m_AAAAAAAAAAAAAAAA | m_AAAAAAAAAAAAAAAA | INFO |
| T03 | information leak | malformed message_id is never echoed | null | null | PASS |

## 5. Appendix B: reproduction and artifacts

Commands, run from the worktree root `/Users/nihalnihalani/Desktop/Github/atr-worktrees/security` at commit `018bdc0` (2026-10-05, about 04:10 IST, Node v25.2.1):

```sh
npm test -w @atr/protocol                                                     # baseline, exit 0, 746 tests
npx tsc -p packages/protocol/tsconfig.build.json --outDir /tmp/atr-protocol-dist
export ATR_PROTOCOL_DIST=/tmp/atr-protocol-dist/index.js
node docs/security/probes/protocol_probes.mjs docs/security/probes/protocol_probe_results.json   # exit 0
node docs/security/probes/sparse_array_cost.mjs                               # memory-heavy: about 2.8 GB RSS at 1e8
node docs/security/probes/text_policy_sketch.mjs                              # 30 cases, 0 mismatches
node docs/security/probes/adr0001_sim.mjs                                     # ADR-0001 arithmetic (8 s)
node docs/security/probes/adr0001_threshold_sweep.mjs                         # threshold sweep (about 30 s)
```

Artifacts in `docs/security/probes/` (SHA-256 at the time of writing):

| File | SHA-256 |
|---|---|
| protocol_probes.mjs | e079c3604cc1433a670730eebfa59ccecc0cfc53273a19842d206ef32875d7cc |
| protocol_probe_results.json | 053df98ea3c1f3541cd483e37308f7b73e6a2ad614128931def40ec93bc87087 |
| protocol_test_baseline.txt | cac3fa8d92dc690cd0aad1ea87786afed9753f90a79b97c08dfff0028d404219 |
| sparse_array_cost.mjs | 1d71a38a175064d8f164ef2812130a49855499ad38aac144b83b5f1b6bd4e8a1 |
| sparse_array_cost_output.txt | 0c9c3026f23b8d70a30d88ec35a0996fd63303f767cb11ff0a991cc8ef758e9a |
| text_policy_sketch.mjs | 7ac692cac8d828a9cabed943c49de508baf8a115c707ffb7fde43820c3d101ee |
| adr0001_sim.mjs | 60e4c0200f06025291f961a83cae3913ddb7327f3e53a067da36bae44547037e |
| adr0001_sim_output.txt | 59216c78f815b809107fa0885bc18518e2f246cde3c595543760276a638ca072 |
| adr0001_threshold_sweep.mjs | 3f6aaca0665fab901699a241e09b8a6c96b4940c006da16b492b8a3367b37355 |
| adr0001_threshold_sweep_output.txt | f316b1ee0a43129da43a7ed6059e48d7c56bf107d63254ea4b1182bc4b88a8a1 |

Limits: the probes show how the validators behave on adversarial input; they do not test the relay, the TV reducer, the phone page, Hermes, Vega or AWS. Timing figures are from one host and are not a load test. The two simulation scripts model noise synthetically and prove nothing about real rooms or microphones (T04). The probe script writes its record in pure ASCII (non-ASCII code points appear as `<U+XXXX>`).
