# Phone companion: state machine and behaviour

Scope: `apps/phone` (task T08). Normative sources: `docs/PROTOCOL.md` revision 4, ADR-0001, 0002, 0003, 0004, 0006 and `docs/adr/AMENDMENTS-REV2.md` (rows owned by H: A2-01, A3-01, A3-07, A4-04, A5-02, A6-02, A8-03, PK-06; where it conflicts with an ADR it wins). Wire handling lives in `src/ports/wire.ts` (on `@atr/protocol`); the microphone in `src/ports/audio.ts` (on `@atr/phone-mic-meter`). Those two files are the only ones that import the packages.

## Layers

| Layer | File | Knows about | Does not know about |
|---|---|---|---|
| Wire port | `src/ports/wire.ts` | envelopes, ids, sequence, strict parsing | DOM, audio |
| Audio port | `src/ports/audio.ts` | microphone, worklet, local summaries | DOM, relay |
| Controller | `src/controller.ts` | everything below as state; no DOM | markup |
| View | `src/view.ts` | DOM only (text via `textContent`) | protocol |
| Transport | `src/transport.ts` | one socket, heartbeat, retry timer | message meaning |
| Wake lock | `src/wake-lock.ts` | Screen Wake Lock | everything else |

## Invariants (each has a test)

1. `getUserMedia` is reachable only from `PhoneController.startMic()`, which only the Start button's click handler calls. No join step, TV command, reconnect or visibility change opens the microphone.
2. The mic state shown and sent is the audio port's **observed** state. The package announces `measuring` when a run is requested; the port reports `measuring` only after the first analysed frame has arrived. `Measuring` is the only level-related text on the phone: no meter, number, unit or verdict is ever rendered.
3. `level` messages exist only while the window the TV started is open, valid and the page is visible, at most 700 per window, bound to session/window/attempt, `frame_index` increasing.
4. Shutdown is complete and awaited: tracks stopped, worklet port closed, nodes disconnected, AudioContext closed, wake lock released, listener controls locked. "Mic off" is reported (and `session.end` acknowledged) only after the port says it is off.
5. Nothing is persisted: no `localStorage`/`sessionStorage`/`IndexedDB`/`MediaRecorder`; credentials and phrases live in memory; a reload means pairing again.
6. Every text the phone sends is `normalizeUserText(...)` output and passes the package validators before it is sent; invalid text is explained on the phone and never sent.
7. Once a message is sent it is never resent automatically (phrases, cue, listener answer). A refusal is shown and the user acts again.
8. (A3-01) Until the person answers "Yes, that was me" to "Did you just pick NN on your TV?", the phone sends nothing but the join protocol and `ping`: no `mic.state`, `ack`, `phrases.update`, `cue`, `level` or result; TV commands are ignored without an ack; the microphone is never opened. The gate is one check in the single send function, so no UI path can bypass it.
9. (A5-02) Nothing is persisted: no cookies, `localStorage`, `sessionStorage`, IndexedDB or Cache API entries (unit test traps every access; real-Chrome flow checks the stores are empty).
10. (A8-03) The page never plays a sound and never vibrates; the audio graph reaches the output only through a zero-gain node.
11. (PK-06) Levels, summaries, validity and rounding come from `@atr/phone-mic-meter` and are sent exactly as returned; the phone never recomputes or re-rounds them.

## Screens and the join/pairing machine

```
 join/idle --Join tapped--> join/connecting --socket open: join.request--> join/pending
    ^                            | error/close                               |  "On your TV, pick NN"
    |                            v                                           | join.accepted (credential held, NOT yet trusted)
    +<-- reject / error / close / Cancel (reason shown) <-------------------- v
    |                                                                  join/confirming   "Did you just pick NN on your TV?"
    |        No, cancel / connection lost / unpaired / revoked before Yes     |  (only join protocol and ping are sent)
    +<---------------------------------------------------------------------+  | Yes, that was me
    |                                                                          v
    |   unpaired / revoked / expired / superseded / auth refused         setup (paired)  -> mic.state is the first message
    +<------------------------------------------------------------------------+
        (Join screen with "This phone is no longer paired" + the reason; no retries)
```

* There are two screens, Join and Setup. A lost pairing returns to Join with a plain explanation ("This phone is no longer paired", the reason, "The microphone is off. To pair again, enter a new code from the TV below."); there is no separate unpaired screen.
* Code input: 6 characters from `ACDEFHJKMNPRTUVWXY3479`, case-insensitive (upper-cased), spaces and hyphens ignored. `#code=XXXXXX` fills the field once and is removed from the address bar (fragments are never sent to a server). **It never auto-joins**: a connection opens only when the person taps Join.
* After `join.pending`: heading "On your TV, pick NN" (the TV shows three numbers; the phone shows only the real one).
* After `join.accepted` (A3-01): heading "Did you just pick NN on your TV?" with "Yes, that was me" and "No, cancel". The relay saying "accepted" proves nothing about whose room it is (a hostile QR can point at an attacker's room that accepts anyone). Yes: setup opens, `mic.state` is sent at once, Start microphone is enabled. No, or the connection dropping, or an unpaired/revoked/superseded signal before Yes: the credential is discarded, nothing more is sent, the socket is closed, and the phone is back on Join; an unconfirmed pairing is never resumed.
* **Session announced early (DEF-003):** the TV sends `session.begin` and `session.state` right after it accepts the join, i.e. while the question is on screen. While waiting for Yes the phone keeps only the latest `session.begin` and the latest `session.state` (a newer begin for another session drops an older held state): no ack, no state change, nothing sent. On Yes it sends `mic.state` first, then applies the held begin (acked `applied`) and the held state (acked), in that order. Every other command that arrives before Yes (precheck, window, listener, reveal, end...) is dropped for good: never run, never acked. No, a dropped connection, an unpaired signal, or starting a new join discards the held messages.
* **`session.begin` is idempotent** for the session already running: a repeat (the TV resends it defensively) is acked `applied` and changes nothing about progress (stage, position, cue count, open window); only a changed `family_mode`/`phrase_count` is refreshed. A begin for a different session starts that session fresh.
* Device label: default `Android Chrome` (Android + Chrome user agent) else `Browser`; 1-24 code points.
* Relay: `wss://<this host>/ws`. `?relay=` (ws/wss only) is honoured in the **test build only**.
* Not a secure context: a banner says the microphone cannot work here; Start is disabled; the port never calls `getUserMedia`.
* Credentials (`phone_credential`, room id) are held in the controller object only; they are not part of observable state and never reach the DOM. A3-07 rotation: every `auth.ok` carries `next_credential`; the credential just presented is consumed, so the next `auth.resume` presents the rotated one (memory only; a refused resume does not rotate; Retry after `failed` uses the latest). An `auth.ok` without `next_credential` is invalid and ignored.

### Wire rules (PROTOCOL.md rev 2/3)

| Moment | room_id | producer_generation | sequence |
|---|---|---|---|
| `join.request` | null | 0 | 0 |
| `auth.resume` (every new connection) | null | 0 | 0 |
| after `join.accepted` / `auth.ok` | the room | the generation from that message (starts at 1) | restarts at 0 |

`mic.state` is sent immediately after every `join.accepted` and `auth.ok`, then on every change (state, settings, wake lock, visibility, session id), de-duplicated.

## Transport and reconnect

States (PROTOCOL.md section 6): `disconnected`, `connecting`, `authenticating`, `connected`, `reconnecting`, `failed`.

* Heartbeat: `ping` every 10 s while connected. No inbound traffic for 25 s: the link is declared dead and reconnecting starts. The phone shows "Connection to the TV unknown", never "off".
* Backoff after an unexpected close: 0.5, 1, 2, 4, 8 s, then 8 s, each multiplied by a jitter factor in [0.75, 1.25) (A6-02; the draw is injectable, 0.5 gives exactly the nominal delay). Each attempt sends `auth.resume` with the in-memory credential. The schedule restarts after a successful `auth.ok`.
* After 2 minutes of continuous failure (from the first lost link, or from a manual Retry) the phone reports `failed`, closes any half-open socket and stops retrying by itself; the page shows "Cannot reach the relay. Automatic retries stopped after 2 minutes. Tap Retry now." with a Retry now button. Retry reconnects at once, resets the attempt counter and starts a fresh 2-minute window. A successful `auth.ok` clears the window. The microphone is left as it is (the user can turn it off).
* Link lost: any open window or precheck is aborted (levels stop at once) and an `interrupted` result is queued; it is delivered after `auth.ok` (or when the TV reappears, `peer.state`). A window is never resumed: the TV must send a fresh `window.start` with new ids.
* Refusals while resuming: `revoked`, `expired`, `unauthorized`, `not_found`, `unauthenticated`, `superseded`, an `unpaired` message, or `auth.ok` with `phone_paired: false` end the pairing: capture shut down, no more retries, back on Join with the explanation. `rate_limited` keeps retrying. `origin_rejected` stops with `failed`.
* Messages naming another room are ignored.

## Microphone (audio port snapshot)

States are the protocol's `MicStatePayload.state`:

| State | Cause | UI badge | Start button |
|---|---|---|---|
| `off` | never opened, stopped, session ended, page hidden | Mic off | yes |
| `permission_pending` | `getUserMedia` outstanding | Waiting for permission | hidden; Cancel shown |
| `permission_denied` | NotAllowed / PermissionDenied | Permission denied (+ site settings steps) | yes |
| `no_input` | NotFound, no audio track | No microphone found | yes |
| `input_busy` | NotReadable / Abort; or track muted (`detail: track_muted`) | Microphone busy / muted | yes |
| `constraints_unsupported` | Overconstrained | Settings not supported | yes, plus "Try browser default settings" |
| `open_idle` | stream open, nothing analysed | Mic open, not measuring | hidden; Turn off shown |
| `measuring` | first frame of a run observed | Measuring | hidden |
| `error` | insecure context, no `mediaDevices`, worklet failed, track ended, context suspended/closed | specific wording per `detail` | yes |

A precheck that reports `invalid_reason: 'silent_input'` (no signal at all) shows "The microphone looks muted or blocked." (with a hint) in the microphone section and the status region until a later precheck is fine or the microphone is closed or restarted. Only prechecks set it; no window result or level is ever shown. `silent_input` is a protocol reason since revision 4 and is sent to the TV like any other. For `pre_window` only `interrupted`, `nonfinite`, `low_coverage`, `silent_input`, `clipped`, `burst_noise` are valid; if the DSP ever returned `unstable_floor`/`too_loud` for it, the validator refuses to build the message, nothing is sent, and the phone says "The phone could not report that measurement to the TV. Ask the TV to try again."

### Measurement numbers on the wire (PK-06)

The DSP package owns the statistics, VAD and validity; the wire port only rounds, in `quantizeOutbound` inside `PhoneMessageFactory.build`: dB fields to 0.1 dB (`quantizeDb`), `coverage` to 0.001 (`quantizeCoverage`), `t_audio_ms`/`duration_ms`/`active_ms`/`longest_active_ms`/`onset_ms` to whole milliseconds. It never recomputes a value, flag or reason, is an exact no-op on values already on the grid (what the reworked package will emit), and rounding is monotone so the validators' orderings still hold.

### Text safety (revision 4)

Phrases, the cue word and the device name are checked with the package's rules, which now also reject text-direction controls and invisible separators, text that is blank to the eye, and runs of more than four combining marks. Each gets a plain message ("... contains a character that cannot be shown safely ...", "... has nothing visible in it ...", "... has more than 4 accent or combining marks in a row ..."); nothing unsafe is ever sent. The phone also trims leading/trailing whitespace including a byte order mark.

Settings (`auto_gain_control`, `echo_cancellation`, `noise_suppression`, `sample_rate`, `channel_count`) are what the browser reports; `null` means unknown. `supported.*` is `null` when `getSupportedConstraints()` is unavailable (revision 3). The page says these are reports and "do not prove the audio is unprocessed".

* Cancel during `permission_pending` returns to `off`; a stream that arrives later is stopped by the package. Because the package keeps the abandoned `open()` promise until the browser settles it (an ignored prompt never does), the port swaps in a fresh capture instance on cancel/close so Start works again immediately (regression-tested).
* Start while a session is muted/suspended/failed first releases the old session, then opens a fresh one.
* `mode` in `mic.state` is self-reported context: `fixture_replay` (test build), `same_host` (localhost, "Same-Mac microphone mode"), else `physical_phone`.

## Window ids

Each precheck and each capture has its own `window_id`; the precheck and capture of one attempt share the `attempt_id`. The phone treats every window id as single-use (a finished id is `ignored_stale/window_closed`), binds `level` and `window.result` to the capture's window id, and binds listener controls to the capture window plus the shared attempt. `window.cancel` and `attempt.reveal` for the attempt lock the listener controls whichever of its window ids they name.

## Screen wake lock ("Keep this screen on")

Wanted while the page is visible, the phone is paired and (the microphone is open or a TV session is active). One request at a time; state is what the browser did: `held`, `released` (browser or us), `rejected`, `unsupported`, `not_requested`. A browser release is reported and not re-requested in a loop. On return to visible it is re-requested only if a session is active.

## Page visibility (background policy)

`hidden`: any open window/precheck is invalidated (`window.result` / `precheck.result` with `valid:false`, `invalid_reason:'interrupted'`), the microphone is shut down completely (mobile browsers suspend capture in the background; keeping a dead stream "open" would be dishonest), `mic.state` reports `visibility: hidden` and then `off`. `visible`: nothing restarts; the user taps Start microphone again. Start is disabled while hidden and `window.start`/`precheck.start` are rejected with `page_hidden`.

## TV commands and acknowledgements

Every TV command gets an `ack` carrying the command's session/window/attempt ids.

| Command | Applied when | Otherwise |
|---|---|---|
| `session.begin` | always (replaces an older session; resets cue count if the id changed) | |
| `session.state` | known session; updates stage (neutral wording), cue count; defence in depth: a state naming no/another open attempt locks listener controls (outside `response_pending`) | `ignored_stale` unknown session |
| `precheck.start` | session known, page visible, mic `open_idle`, no run active; runs locally for `duration_ms`, then one `precheck.result`, no level frames | `rejected` (`mic_not_open`, `busy`, `page_hidden`), `ignored_stale` (unknown session, closed window id), `applied/duplicate` |
| `window.start` | same gates; streams `level`, then `window.result` at `max_duration_ms` or `window.stop` | same |
| `window.stop` | matching open window: ack first, then `window.result` | `applied/already_closed` for a finished window; `rejected/precheck_not_stoppable`; `ignored_stale` unknown |
| `window.cancel` | matching run: discard, no result | `applied/already_closed`, `ignored_stale` |
| `listener.open` | session known, no capture running: binds Heard/Not heard/Cue to that window+attempt (idempotent; keeps an answer already given) | `rejected/capture_open`, `ignored_stale` |
| `attempt.reveal` | locks the controls; a reveal for another attempt does not lock the open one | `applied/nothing_open`, `ignored_stale/other_attempt` |
| `session.end` | stops capture completely, releases wake lock, reports `mic.state off`, then acks | `ignored_stale` |

`listener.open.timeout_ms` IS enforced on the phone (A4-04): the controls lock exactly when it elapses ("Time is up for this answer. The TV decides what happens next."). The TV's "Keep waiting" sends a fresh `listener.open`, which re-enables them for its attempt (an answer already given for the same attempt is kept) and restarts the clock. The controls also lock on `attempt.reveal`, on `window.cancel` naming the attempt (precheck and capture windows of one attempt share the attempt id), on `session.end`, on the next precheck/capture, and on unpair; every lock cancels the timer.

## Listener controls (ADR-0004)

Heard / Not heard (88 px tall) and Cue (shows the cue word, default `Volume`, editable in the settings panel: 1-12 code points, literal, memory only) are enabled only when: the TV opened them, no capture is running and the link is connected. One answer per attempt; Cue stays available until reveal or three cues. "Cues used: n of 3" is shown. Count = max(TV-reported, baseline + cues sent minus cues refused), so it never goes backwards and starts from the TV's count after a mid-session re-pair. Taps after `attempt.reveal` are never sent.

## Acks for phone messages

| Phone message | TV `applied` | TV `rejected` (for example a phrase window is open) | `ignored_stale` |
|---|---|---|---|
| `phrases.update` | "The TV saved N phrases." | "...could not save the phrases right now... press Save again after the current phrase window"; the list the TV confirmed is shown; no resend | n/a |
| `cue` | feedback cleared | cue given back + "could not take the cue right now... try again"; `cue_limit` marks the limit reached | |
| `listener.response` | stays answered | one more tap is allowed, with an explanation | "Too late... not counted" |

Connection lost before an ack: `phrases.update` shows "Not sent... try again when it reconnects" instead of "sending" forever.

## Phrase editor (R-F1)

1-10 rows, each 1-60 code points after NFC + trim, control characters and unpaired surrogates rejected, live per-row messages, Save disabled until valid, editing disabled while measuring ("Editing is paused while measuring."). What was sent is listed back as plain text (a test proves `<img src=x onerror=alert(1)>` renders as text).

## Build, CSP and the worklet (decision)

* `npm run build` -> `dist/` (production); `npm run build:test` -> `dist-test/` (compile-time flag `__ATR_TEST_AUDIO__`; the synthetic-audio module, the persistent banner text and `window.__atrTestAudio` exist only there; a test builds production and asserts none of those strings ship).
* The AudioWorklet module is `FRAME_PROCESSOR_SOURCE` from `@atr/phone-mic-meter`, written by the build as `frame-processor.js` next to `index.html` (content hash in the URL query) and loaded **by module URL from the page's own origin**. No Blob URL is used, so the CSP is `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' wss:; img-src 'self'; base-uri 'none'; form-action 'none'` (the test build also allows `ws:`). No inline script or style, no third-party origin.
* Author CSS must not defeat the `hidden` attribute: `[hidden] { display: none !important; }` (a real-browser e2e run found `.btn { display: inline-block }` was showing "hidden" buttons).

## Privacy copy, silence and Do Not Disturb

* The privacy sentence is the A2-01 text from `docs/adr/AMENDMENTS-REV2.md`, exact: "Audio stays on this phone and is never saved or uploaded. The phone sends only sound levels and when you are speaking, typed phrases, listener responses, phone status (microphone, screen, device name) and connection details to the relay and TV." It appears on every screen; tests assert the old wording is gone from the DOM and the bundle.
* A8-03: no sound, no vibration (no `vibrate`, speech, notification or audio-element API in the bundle, asserted). Setup copy suggests turning on Do Not Disturb.

## Tests and evidence classes

| Command (from the worktree root) | What it shows | Evidence class |
|---|---|---|
| `npm run typecheck -w @atr/phone` | types | automated |
| `npm test -w @atr/phone` | state machine, wire shapes (an independent PROTOCOL.md checker AND the package parser), audio port against the real capture adapter with fake browser objects, view rendering, lifecycle/reconnect, production-bundle exclusions (builds both flavours) | automated (happy-dom, fakes) |
| `npm run e2e:all -w @atr/phone` | real headless Chrome: render/join smoke; full flow with synthetic audio through the real AudioContext/AudioWorklet (including the confirmation step, empty cookie/storage/IndexedDB/Cache API, no vibration or sound); production bundle with strict CSP; hostile-QR scenario against a scripted attacker relay | automated, synthetic or stubbed audio in desktop Chrome |

None of these is a real-phone check. Pending: real Android Chrome permission prompt, AGC/echo/noise read-back on a real input, background/lock behaviour, wake-lock behaviour, capture indicator (see the task handoff).
