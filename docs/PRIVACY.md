# Privacy: what leaves the phone and the TV, what is stored, and for how long

Status: written from ADR-0002 as amended by `docs/adr/AMENDMENTS-REV2.md` (A2-01 to A2-05, A5-01 to A5-05), `docs/PROTOCOL.md` revision 4, the code at commit `63af0ae`, and the automated checks listed in section 9. **Nothing is deployed and no physical phone or Fire TV has been used**, so this document describes designed and test-verified behaviour, not a hosted service. It is an engineering description, not a legal privacy policy, and it does not replace one.

Product framing: **Not a medical device. Does not diagnose or treat any condition.** Practice phrases and practice summaries are treated as potentially sensitive and are minimised.

## 1. In one table

| Question | Answer | How it is enforced or checked |
|---|---|---|
| Is audio uploaded or sent anywhere? | No. Raw samples exist in the phone's audio thread and one 50 ms frame, are reduced to numbers, and are discarded. | `@atr/phone-mic-meter` has no network, storage or recorder code (scan test); the protocol rejects payloads with audio-like keys or long strings or arrays (`audio_rejected`); the phone bundle is scanned for `MediaRecorder` and storage APIs |
| Is audio recorded or saved? | No. There is no `MediaRecorder`, no waveform, no blob, no saved clip. | Same tests; phone e2e checks that cookies, `localStorage`, `sessionStorage`, IndexedDB and the Cache API are empty |
| Is there speech recognition or an LLM? | No. No model decides any result; the verdict is arithmetic on the TV. | By construction; no such dependency exists |
| Does any analytics, advertising or third-party service receive data? | No third-party origin is contacted by the code: the phone smoke test saw no request leave the machine, and the T16 gate audited every frame and request of one full journey (no third-party request, no browser API that can carry audio). **The page's Content-Security-Policy is looser than that:** it currently allows its own origin plus any `wss:` host and a `blob:` worker (T16 finding N-02); the decided fix is `connect-src 'self'` plus the configured relay origin only, not landed at `ac556df`. | CSP in `apps/phone/index.html` and `services/relay/src/local/static.ts`; phone smoke test; `tests/security` (e) |
| Is the relay end-to-end encrypted? | **No.** TLS protects each client-to-relay link only. The relay holds plaintext payloads in memory to validate and forward them. | ADR-0002 forbids the claim; `docs/operations/SECURITY-NOTES.md` section 3 |
| Are accounts, cookies or cross-device identifiers used? | No accounts. The phone sets no cookies and stores nothing. | Phone e2e and unit tests |

## 2. Exactly what leaves the phone

Each row is a protocol message (`docs/PROTOCOL.md` section 3.3), sent over WSS to the relay and forwarded to the TV. Source: ADR-0002 table plus the rows added by A2-01.

| Category | Fields | When | Destination |
|---|---|---|---|
| Level frames | `frame_index`, `t_audio_ms`, `dbfs` (relative level, 0.1 dB steps), `active`, `clipped` | One per 50 ms, only while a measurement window that the TV started is open | Relay, then TV |
| Voice-activity timing | The `active` flag in each level frame reveals **when you are speaking** (at 20 frames per second during a window). `onset_ms`, `active_ms`, `longest_active_ms` in the summary say the same in aggregate. | During windows | Relay, then TV |
| Quiet-check and pre-window aggregates | Floor, percentiles (p20, p80, p95), coverage, clipped and non-finite counts, validity and reason | Once per commanded check | Relay, then TV |
| Window summaries | Percentiles of active frames, peak, durations, segment count, coverage, validity and reason | Once per window | Relay, then TV |
| Typed household phrases | 1 to 10 phrases, each 1 to 60 characters, as typed | When the household presses Save on the phone | Relay, then TV (stored on the TV) |
| Listener response and cue word | `heard` or `not_heard`; a cue word of 1 to 12 characters | Between measurement windows | Relay, then TV |
| Phone status | Microphone state, the settings the browser reports for the audio track (gain control, echo cancellation, noise suppression, sample rate, channel count), which constraints the browser supports, wake-lock state, page visible or hidden, and a `mode` label (`physical_phone`, `same_host` or `fixture_replay`) | On change, and again when the TV (re)connects | Relay, then TV |
| Device label | 1 to 24 characters; default `Android Chrome` on Android Chrome, otherwise `Browser`; shown on the TV during pairing as "Name the phone gave: ..." | At pairing | Relay, then TV |
| Connection details | Pairing code (once, at join), room id, role, credential (a bearer secret over TLS), generation, sequence number, message id, timestamps, heartbeat `ping`, and the connection's network address as seen by whichever server terminates TLS | Always | Relay (and the hosting platform) |

Never sent: audio, PCM, waveforms, recordings, per-frame spectra, verdicts, ratings, results or history. The phone also never receives the verdict, the meter, or which phrase positions are blind (`QA-05`): it sees only a neutral stage name and an explicit `listener.open`.

**Measurement budget (T16 N-12).** Level frames and voice-activity timing leave the phone only while a window the TV started is open and the page shows the Measuring badge. At `ac556df` the phone has no per-session budget, cooldown or idle limit, so a paired TV (or a hostile relay holding a stolen TV credential) could chain windows for as long as the page stays open and visible; in the gate's test a raw TV had 15 consecutive windows applied. The decided fix is a budget of 5 minutes of cumulative capture per session, at least 1 s between windows and a microphone that turns itself off after 10 minutes without a TV command, with a visible message (routed, not landed).

## 3. Exactly what leaves the TV

| Category | Fields | When | Destination |
|---|---|---|---|
| Room and pairing | `room.create` with app version (for example `0.1.0`) and platform (`vega` or `web_preview`); `join.confirm` (accept or reject); `pairing.refresh`; `unpair`; `room.close`; `auth.resume` with the TV credential; `ping` | Pairing, reconnects, deletion | Relay |
| Session commands | `session.begin` (family mode on or off, number of phrases, cue maximum 3); `session.state` (stage name, phrase position, cues used, which attempt is open for the listener) | During a session | Relay, then phone |
| Measurement commands | `precheck.start` (purpose, 2000 or 5000 ms); `window.start` (kind, phrase position, maximum duration, **the room's background floor level** in dBFS); `window.stop`; `window.cancel`; `listener.open` (timeout); `attempt.reveal` (carries no verdict); `session.end` | During a session | Relay, then phone |
| Acknowledgements | `ack` with the acknowledged message id, an outcome (`applied`, `ignored_stale`, `rejected`) and a short fixed detail such as `late` or `cue_limit` | In reply to phone messages | Relay, then phone |

The TV does **not** send results, verdicts, speaker ratings, history, phrase text, cue text or the session summary anywhere. The TV tells the relay and the phone which practice step you are on and the room's background level (amendment A2-02). Phrases travel from the phone to the TV only; the TV never echoes them.

## 4. The exact copy shown to people

**Phone, every screen (A2-01, exact; `apps/phone/src/config.ts`):**

> Audio stays on this phone and is never saved or uploaded. The phone sends only sound levels and when you are speaking, typed phrases, listener responses, phone status (microphone, screen, device name) and connection details to the relay and TV.

**TV, Settings > About** (`packages/session-core/src/copy.ts`, rendered by the `about` view; since the tv fix `99da796` (merged) the About screen in `apps/tv/src/screens/AboutScreen.tsx` renders that body as the **single source** of the privacy and storage disclosure and adds only a one-line licence notice and, if the body has none, the version; checked by reading the diff and by the new `apps/tv/src/__tests__/about.test.tsx`; not seen on a Vega device):

- "Practice data is stored unencrypted on this TV. Session summaries keep positions and counts only, never phrase text, cue words or phone names, for 8 days. Your phrase bank stays on this TV until you delete it in Settings."
- "This TV tells the relay and your phone which practice step you are on and the room's background level. It does not send your results, ratings or history."
- "The relay keeps short-lived abuse-prevention counters (counts only) keyed by a keyed hash of the connection's network address. The key changes at least daily and the counters expire within an hour."
- "Licences: MIT for this app, qrcode-generator, React Native and React; the Vega packages are used under the Amazon Vega SDK licence terms." (the one line the `apps/tv` copy adds; the earlier second storage sentence was removed by the fix. The wording about the Vega packages is shorthand: the precise licence is Amazon's Program Materials License Agreement, see [release/LICENSES.md](release/LICENSES.md).)

**TV footer, every screen:** "Not a medical device. Does not diagnose or treat any condition."

**Resolved in session-core (merged at `cfa5158`, commit `0061d83`).** The TV's onboarding and pairing screens previously showed the ADR-0002 revision 1 sentence, which omits voice-activity timing, phone status and the device name. `PRIVACY_LINE` in `packages/session-core/src/copy.ts` is now the exact amended A2-01 sentence, the same one the phone shows, and `packages/session-core/test/privacy-copy.test.ts` checks that it matches the A2-01 row of `docs/adr/AMENDMENTS-REV2.md`, that onboarding and pairing each show it once, and that the revision 1 wording appears nowhere in the TV copy table. The About screen's second copy source, which had repeated the storage sentence, was removed by the tv fix `99da796` (merged at `ac556df`), so the three screens that carry a privacy statement now take it from session-core only.

**Claims that must not be made** (ADR-0002): "end-to-end encrypted", "no data leaves the household", "only numbers", "relay never inspects payloads". Also not allowed anywhere: dB SPL, intelligibility, comprehension, hearing or clinical claims, and any efficacy claim.

## 5. What the relay stores

The relay validates every message against the shared schema and forwards the **canonical re-serialisation** of the validated copy (never the raw frame). It stores room and connection metadata only.

| Store | Holds | Never holds |
|---|---|---|
| Local relay (`MemoryRoomStore`) | The records below, in process memory only. Restarting the relay empties it; TV and phone pair again. | Anything on disk |
| AWS relay (DynamoDB, prepared, **not deployed**) | One table plus a sparse `live-rooms` index (keys only): room record (room id, TV and phone slots, generations, epochs, active session id, pairing-code HMAC), the single join request, connection records, code records, credential tombstones (SHA-256 digests of consumed credentials), recent message-id markers, per-session cue counters (a number), rate-limit counters and exponential-delay state keyed by an **HMAC of the source address** (IPv4 /32, IPv6 /64) under a secret-derived key that **changes daily**, concurrent-connection counters | Phrases, cue text, device labels, levels, listener responses, results, raw addresses, raw credentials, raw pairing codes |

Details that matter:

- **Pairing codes** are stored as HMAC-SHA-256 under a secret (local: random per process; AWS: an SSM SecureString `/atr/relay/<stage>/hash-secret` that the owner creates). Credentials are stored as domain-separated SHA-256 digests of 256-bit random values.
- **Abuse counters** carry a count and an expiry of at most one hour and nothing else (A2-03). They are disclosed in TV Settings > About and in the README.
- **Lifetimes.** Pairing code 10 minutes and one use; join request 60 seconds; credential 2 hours, renewed by rotation on every resume; room 12 hours absolute and closed after 30 minutes with no connection. Expiry is logical on every message; DynamoDB TTL (`expires_at`) is physical cleanup that can lag by days.
- **SQS deadline queue (AWS only).** Messages contain a connection id, the API domain and the stage: no secrets, no content. Main queue retention 1 hour, dead-letter queue 24 hours.
- **Point-in-time recovery is deliberately off** so that deleted rooms and their hashes are not kept for 35 days after a user asked for them to be gone.

## 6. Logs and retention

| Where | What | Retention |
|---|---|---|
| Relay logs (both adapters, same core) | **No line per message.** Ordinary traffic is one `minute_aggregate` line per kind and message type per minute (counts only). Only errors and security events get their own line, with closed vocabularies: event name, error code, message type, byte length, role, an 8-hex-character prefix of a hash of the room id, latency. Never message bodies, phrases, cue text, device labels, credentials, pairing codes, full ids or network addresses (A2-04). | Lambda log groups: 14 days at most (`RetentionInDays: 14` in `infra/template.yaml`, asserted by a test). The local relay writes to its process output; the owner of that terminal decides retention. |
| EMF metrics (AWS) | Security counters only (failed joins, failed resumes, credential reuse, room cap) | CloudWatch metrics defaults |
| API Gateway, CloudFront, S3 access and execution logs; X-Ray | **Off.** The stage sets `DataTraceEnabled: false` and `LoggingLevel: OFF`, because execution logging with data tracing would write message bodies. Tests fail the build if a trace, a non-whitelisted access-log field, X-Ray, or a CloudFront or S3 log destination appears. | n/a |
| TV | No `console` calls in the app source; the production Babel build strips them; the production bundle check requires no `console.log`, `warn`, `info` or `debug` reference | n/a |

A redaction test suite feeds sentinel content (phrases, cue text, credentials, codes, labels, addresses) through every message type and failure path and scans all log output (`services/relay/test/redaction.test.ts`, `logger.test.ts`, and the SEC-P* tests).

### Hosting logs once deployed

Not applicable yet: **no AWS deployment exists (B-003)**. When deployed, the template keeps API Gateway execution and access logging, X-Ray, CloudFront logging and S3 access logging off, so the only application logs are the redacted Lambda lines above. AWS may still keep platform-level operational and billing records outside this template's control, including source addresses at the API Gateway and CloudFront edge. This must be re-verified on the deployed stack by searching the logs for a test phrase, a credential and a pairing code after a real session (`infra/README.md`, verify item 5), and disclosed in the final README.

## 7. What is stored on the TV

Store: Vega AsyncStorage (`@react-native-async-storage/async-storage`, aliased to `@amazon-devices/react-native-async-storage__async-storage`). **It is unencrypted** and the TV says so in Settings > About. No encryption is claimed anywhere. Every key starts with `atr:v1:`; deletion removes only `atr:` keys, never a blanket `clear()`.

| Key | Content | Retention |
|---|---|---|
| `atr:v1:meta` | schema version, creation time | until deleted |
| `atr:v1:settings` | family mode, cue word setting, measurement mode, qualification state, UI preferences | until deleted |
| `atr:v1:phrases` | the phrase bank (1 to 10 phrases) | **until the household deletes it** (stated in About) |
| `atr:v1:session:<id>`, `atr:v1:index` | per-session summaries: positions, counts, outcomes, dates. **Never phrase text, cue text or phone names.** | **8 days** (7 shown plus today), pruned on launch (A5-04; ADR-0005 revision 1 said 30 days) |
| `atr:v1:active` | checkpoint of an in-progress session for crash resume; contains nothing about an unrevealed attempt | discarded on launch if older than 12 hours |

Credentials, pairing codes, levels and audio are **never** stored (memory only). Fixture and demo history is never written to real history; fixture mode uses an in-memory store and a persistent "Fixture replay" label.

## 8. Deletion

| What | How | What is verified |
|---|---|---|
| TV data | Settings > Delete local practice data. A confirmation dialog has **Cancel focused by default**. On confirm the TV makes a best-effort `unpair` and `room.close` (banner "Relay cleanup in progress.", then "confirmed" or "not confirmed"), drops credentials and room identity, removes every `atr:` key, **verifies by listing keys**, and resets memory. It never reports success if verification finds a key. | session-core tests with a fake store; QA review suite; web-preview journey. Real AsyncStorage on a device: **not verified** (B-001). |
| Reset today's band | Clears the current session's floor and band only | session-core tests |
| Unpair | Revokes the phone's credential at the relay | relay and session-core tests |
| Relay room | `room.close` revokes everything; otherwise the room expires logically after 12 hours (or 30 minutes with no connection); DynamoDB TTL removes items later | relay tests on the memory store and a strict DynamoDB model; **not tested on real DynamoDB** (B-003) |
| Phone | Nothing is stored. Closing or reloading the page discards the credential and pairing. On session end, unpair, background or expiry the page stops all tracks, closes its audio context and releases the wake lock. | phone unit tests and real-Chrome tests with synthetic audio; a real phone's capture indicator is **not verified** (B-002). **Residual (T16 N-07):** after the TV deletes its data and closes the room the phone page leaves the paired view but still holds the household phrases in memory until the tab is closed; the decided fix clears phrase state with the credential (routed, not landed at `ac556df`) |
| Logs | Contain no personal content by design and age out after at most 14 days on AWS. There is no per-person log deletion tool. | redaction tests |

## 9. What is verified and what is not

| Claim | Evidence class | Source |
|---|---|---|
| No audio, storage or recorder code in the DSP package; no `MediaRecorder` or storage API in the phone bundle | automated | `@atr/phone-mic-meter` tests (450), `@atr/phone` bundle test |
| Phone persists nothing; no request left the machine; no cookies | automated (headless desktop Chrome, synthetic audio) | `npm run e2e:all -w @atr/phone` (smoke and flow parts passed in the clean-clone run; see [TESTING.md](TESTING.md)) |
| Relay logs and storage contain no bodies, phrases, credentials, codes, labels or addresses | automated (memory store, strict DynamoDB model, real local HTTPS/WSS server) | `@atr/relay` tests (1,113 with cfn-lint) |
| IaC keeps tracing, access logging, PITR and X-Ray off and log retention at 14 days | automated (template assertions, cfn-lint) | `services/relay/test/infra.test.ts` |
| TV copy, deletion flow, retention | automated (jest with mocks; session-core fakes) | `apps/tv` jest (639), session-core (371) |
| Every frame and request of one full journey audited: fields, no audio or base64, quantised values, levels only inside TV-started windows, no third-party request; relay logs closed-vocabulary with no secrets, codes, phrases, labels or addresses; no browser storage; hidden-attempt leak differential | automated (local relay as a child process, desktop Chrome, headless TV core, TV web preview) | T16 gate, `tests/security` (113 tests), `docs/security/T16_GATE.md`: pass with residuals |
| Real network capture from a physical phone showing only the documented messages | **pending** | B-002 |
| Hosted logs contain no content; platform-level records | **pending** | B-003 |
| AsyncStorage contents and deletion on a real Vega device | **pending** | B-001, B-004 |

## 10. Decisions and items for the owner

1. ~~Align the TV's onboarding and pairing sentence with the amended phone sentence~~ done in session-core (`0061d83`); ~~remove the About screen's second copy source~~ done (`99da796`). Nothing remains here except the on-device check that the About screen reads correctly on Vega (T17, B-001).
2. Provide a real privacy contact and decide whether a public privacy notice is required for any store or public launch. This document is not one.
3. Before any hosted use: deploy, then run the log-content check in section 6 and update this document and the README with the result.
