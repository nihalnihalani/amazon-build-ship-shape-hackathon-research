# T17-prep: remote, accessibility and scale gate on the TV web preview and the jest render tests

- Reviewer: Sonnet 5.5, qa-accessibility (model id `claude-sonnet-5-5`). I did not write the code under review.
- Worktree / branch / base: `/Users/nihalnihalani/Desktop/Github/atr-worktrees/qa`, `wt/qa`, `4d4ef1e`.
- Subject: `apps/tv` screens rendered by the Vite + react-native-web preview (`apps/tv/web`, banner "Web preview — not Vega") and the jest render suite (`apps/tv/src/__tests__`).
- **Evidence class: `web_preview` (browser) and `automated` (jest). Never `real_VVD`.** Nothing here observes VoiceView, the real Vega focus engine, the real D-pad, the real UI-scale setting, native rendering or latency. Those are `pending_external` (blocker B-001: no Vega SDK or VVD). T17 itself is NOT satisfied by this document.
- Requirement mapping (by task ownership, the matrix has no text in this checkout): R-U1, R-U2 (remote-only journeys), R-U3, R-U4 (accessibility), plus R-G1..R-G3 (no blind-result leak into the DOM).

## 1. Verdict

**T17-prep: accept-with-defects.** The preview evidence supports the claims the UI makes about focus, names, footer, blind screens, destructive dialogs and history. Three Medium defects (A11Y-01, A11Y-02, A11Y-03) and several observations need an owner decision or a VVD check before T17 can be verified. No Blocker, no High.

## 2. Defects

Each has an executable repro in `tests/a11y/tv-web-preview.e2e.ts`: a test named `DEFECT A11Y-nn` that asserts the correct behaviour under `it.fails` (suite green while open). `QA_STRICT=1` runs them as ordinary tests; when a fix lands the wrapper must be removed.

### A11Y-01 (Medium, preview; Vega unverified): disabled controls stay keyboard-focusable and expose no `aria-disabled`

- Repro: store mode, Home, Settings (outside a session). The session core marks `Reset today's band` and `Unpair phone` as `disabled: true`. DOM: `action-reset_calibration` and `action-unpair_phone` have `tabindex="0"`, no `aria-disabled`, only `opacity: 0.5`, and the arrow keys land on them (ring drawn).
- Expected: a disabled control is removed from the focus order or announced as disabled.
- Cause: `apps/tv/src/ui/Focusable.tsx` passes `focusable={!disabled}` and `aria-disabled={disabled}` but never `disabled` to `Pressable`. react-native-web's `Pressable` ignores `focusable` and overwrites `aria-disabled` with its own `disabled` prop. On Vega the app relies on the native `Pressable` honouring `focusable`/`aria-disabled`; I could not verify that. `onPress` is guarded, so activation is already safe.
- Suggested fix: also pass `disabled={disabled}` to `Pressable` and add a render test for it; confirm on the VVD (checklist item 4).

### A11Y-02 (Medium, axe `serious`): the confirmation dialogs have `role="alertdialog"` with no accessible name

- Repro: any dialog screen; axe-core 4.13.0 rule `aria-dialog-name` fires on all three dialog fixtures. `ConfirmDialogScreen.tsx` renders `<View role="alertdialog" accessible={false}>` with the title as a child heading but no `aria-label`/`aria-labelledby`.
- Also observed: the screen title and the dialog heading carry the same text, so a screen reader would read the title twice.
- Expected: the dialog is named by its title (and the screen frame does not repeat it). How Vega maps `alertdialog` is unverified (checklist item 5).

### A11Y-03 (Medium, preview; Vega multiplier differs): content and the footer overflow the 1920x1080 canvas at UI scale 1.5 and above

- Repro (`?scale=1.5`, the preview's only scale knob): Home: `action-pair_phone` bottom at 1167 px against a canvas bottom of 1124 px, the footer bar at 1306 px (off screen); `calibration` and `phrase_active_visible` also overflow. At 2.0, 15 of 29 screens overflow, and on `summary` the first lines start 190 px above the canvas.
- Clean at 1.0 and 1.25 (hard assertions, passing).
- Caveat: the preview shim applies ONE multiplier to text, size and space. The app asks for three item types and Vega's `low_downscale` space type SHRINKS spacing at higher scales, so the preview probably over-predicts overflow. It is still a real risk for "footer on every screen": it must be checked at every scale step the VVD offers (checklist item 9).

## 3. Observations (not defects; owner decisions or VVD checks)

- **OBS-A1 Fixtures drift from the real session core.** The 29 hand-written fixtures do not match what `session-core` emits: `join_confirm` prefers **Reject** in the fixture but **Accept** in the real view (verified in store mode); `paused_or_invalid` shows "Pair again" / "End session" versus the core's "Try again" / "Skip phrase" / "Finish early"; `vowel_active` "Stop" versus "Stop now"; `pairing` "Refresh code" versus "New code"; `response_rating` prefers "Felt normal" versus the core's first control "Felt loud". Fixture results are valid for UI behaviour, not for product copy or focus defaults. The store-mode journey below covers the real views.
- **OBS-A2 Default focus on the join request is Accept** (real core). A reflexive OK accepts a phone. security-review should decide; the fixture author chose Reject.
- **OBS-A3 Focus leaves the screen during the quiet lead and the precheck** (ADR-0008, by design): no focusable control, `aria-live="off"`, empty live region; the capture phase then puts focus on "Stop now". On Vega this needs a VoiceView check (focus loss, any re-announcement at capture start). Pressing OK again about 3.5 s after Begin stops the capture early.
- **OBS-A4 Summary wording**: "Reached the far side, blind checks: x of y" differs from ADR-0001 section 8 ("Reached today's relative level band") and can read as arrival/audibility. Product copy decision.
- **OBS-A5 axe, non-critical, web-only artefacts**: `aria-allowed-role` minor x15 on 14 screens (the flagged nodes are `#atr-body-0`, the first body line, and `permission-state`, both given the React Native role `summary` by `ScreenFrame.tsx`/`MeasureScreens.tsx`, which has no web ARIA equivalent), `landmark-unique` moderate x1 (`permission_pending`, the same `section` element). Totals (rule x screen): 3 serious (all A11Y-02), 1 moderate, 14 minor, 0 critical.
- **OBS-A6 Preview navigation is the shim's, not Vega's**: arrow keys use a nearest-neighbour scoring (for example Right from "Reset today's band" jumps to "Diagnostics" in the next row instead of "Delete local practice data" in the same row), and Space activates a focused control (react-native-web). Every enabled control was still reachable on every screen, so the reachability result holds for the preview only.
- **OBS-A7 `npm run dev` for the preview does not start**: the dependency optimiser fails with `[PARSE_ERROR] Flow is not supported ../node_modules/react-native/Libraries/Utilities/codegenNativeComponent.js:1:1` (`react-native-svg` deep-imports `react-native/...`, which resolves to the Flow sources in `apps/tv/node_modules`). `vite build` + `vite preview` works and is what the runner uses.

## 4. What the gate asserts and found

Files: `tests/a11y/tv-web-preview.e2e.ts`, `tests/a11y/helpers.ts`, `tests/a11y/scripted-phone.ts`, `tests/a11y/run-a11y.mjs`, `tests/a11y/vitest.config.ts`, `tests/a11y/tsconfig.json`. Keyboard only (arrows, Enter, Escape = Back) in system Google Chrome (playwright-core, `channel: 'chrome'`).

| Check | Scope | Result |
|---|---|---|
| Footer text "Not a medical device. Does not diagnose or treat any condition." | 29 fixture screens + every store-mode screen visited | present on all |
| Every interactive element has an accessible name (`aria-labelledby`, `aria-label`, text, title) | 29 fixtures + store screens | no unnamed element |
| Visible focus: exactly one preferred element, it holds focus at entry, ring colour not transparent, 6 px width, scale 1.05 (shape, not colour alone), exactly one ring on screen | 27 fixtures that have controls | pass; ring contrast against the screen background 13.26:1 (minimum over screens, threshold 3:1) |
| No-control screens hold no focus and show no ring | `phrase_active_visible`, `phrase_active_hidden` | pass (Escape dispatches `remote back`; Enter dispatches `remote ok`) |
| Back (Escape) reaches the store exactly once, Enter activates exactly the focused control | all 29 | pass |
| Keyboard reachability and "exactly one ring at every moment" | 18 screens with 2 or more enabled controls, 117 arrow presses in total | all enabled controls reachable, 0 ring violations (shim navigation, OBS-A6) |
| Destructive dialog opens with Cancel focused, even when the view prefers Confirm; focus cannot leave the dialog over 8 arrow presses; a non-destructive dialog follows the view | 3 dialog fixtures; store-mode Settings, Delete | pass; store: Escape is Cancel and focus returns to "Delete local practice data"; OK on the default focus deletes nothing; confirming shows "All local practice data was deleted." and `localStorage` never receives an `atr:` key (fixture-mode store) |
| History "No session" | fixture `history` (days with `sessions: null` caption exactly "No session", days with a session never do); store mode: all 7 captions and aria-labels "No session"; after the journey 6 days "No session" and today "2 of 3 reached" | pass |
| No meter element for blind screens | `phrase_active_hidden`, `response_rating`: no `arc-*` test ids, no `svg`, no result element, no "reached/below/dB" in text or any `aria-label`; DOM `arc-meter` present iff `view.meter` is non-null on all 29; `phrase_active_visible` has one (non-vacuous); a negative control injects one and the check flips | pass |
| Live blind capture (store mode, scripted phone sends -140/+20 dBFS frames) | DOM polled every ~100 ms from Begin to the rating prompt, plus a MutationObserver log of the live region | no meter/svg/result, no verdict wording in body text, `aria-label`s or live-region text; `aria-live="off"` and empty text whenever a control-less or capture screen is up; the verdict first appears after the rating |
| Real session store through the real screens, keyboard only | pair (QR with `role=img` and a label, spoken code "A C D E F H"), join, mic, quiet check (20 OK presses in the lead: 1 `precheck.start`, no cancel), calibration, skip sustained sound, phrase 1 Back during capture (phone got one `window.cancel` `user_cancel`, "Not scored", Try again focused), retry, phrase 2 below, phrase 3 blind, rating, reveal, summary, history | pass; summary lines: "Phrases completed: 3 of 3 attempted", "Attempts not scored: 1 / cancelled: 1", blind "1 of 1", other "1 of 2" |
| Scale 1.0 and 1.25: nothing beyond the canvas, no horizontal scroll | all 29 | pass |
| Scale 1.5, 2.0 | all 29 | A11Y-03 |
| axe-core 4.13.0 on the canvas | all 29 | 0 critical; see OBS-A5 and A11Y-02 |
| Checker self-test | injected meter, forced transparent borders, stripped label | each check fails when it should |

jest render suite (`apps/tv`, `npx jest --silent`): 18 suites, 374 tests, exit 0. It already asserts, with mock Pressables: preferred focus and Cancel-first dialogs, labels equal text, no arc/path for hidden attempts, silent live region while capturing, no controls during a window, UI-scale geometry, remote key routing (key down only, Back via BackHandler only). Gaps it cannot cover: real layout overflow at scale (react-test-renderer has no layout engine, so A11Y-03 is invisible to it), react-native-web/Vega `disabled` semantics (A11Y-01), the missing dialog name (A11Y-02), and fixture/core drift (OBS-A1).

## 5. Commands run (original review at `4d4ef1e`; the current head is in section 7a)

UTC, 2026-10-04T22:55Z to 23:15Z (2026-10-05 04:25 to 04:45 IST), commit `4d4ef1e`. Chrome 154.0.8037.97 (system, headless), playwright-core 1.63.0, vite 8.3.2 (`build` + `preview`), axe-core 4.13.0, Node v25.2.1, macOS.

| # | Command (cwd) | Exit | Result | Class |
|---|---|---|---|---|
| 1 | `npm ci --ignore-scripts` in `apps/tv` and `apps/tv/web` | 0, 0 | installed (needed for jest and the preview; `node_modules` is untracked) | n/a |
| 2 | `npx vite build` (`apps/tv/web`) | 0 | built | web_preview |
| 3 | `npx vite` dev server (`apps/tv/web`) | 1 | fails: Flow parse error (OBS-A7) | web_preview |
| 4 | `node a11y/run-a11y.mjs` (`tests`) | 0 | 1 file, 45 tests: 42 pass, 3 expected-fail defect repros | web_preview |
| 5 | `QA_STRICT=1 node a11y/run-a11y.mjs` | 1 | 42 pass, 3 fail = A11Y-01, A11Y-02, A11Y-03 | web_preview |
| 6 | `npx jest --silent` (`apps/tv`) | 0 | 18 suites, 374 tests | automated |
| 7 | `npx tsc -p a11y/tsconfig.json` (`tests`) | 0 | no type errors | automated |

Repeat: `cd tests && node a11y/run-a11y.mjs` (builds, serves on 5179 or a free port, runs, stops the server; `TV_PREVIEW_URL` reuses a running server). Runtime about 85 s.

## 6. Artifacts and hashes (refreshed by the wave 2 full run, section 9)

`tests/a11y/artifacts/`: `report.json` (per-screen controls, focus, ring contrast, axe violations, scale overflow lists, the store journey and its phone message log), `manifest.json` (SHA-256 of every PNG written by the run, not a regression baseline: a few screens vary run to run), `committed/*.png` (8 small screenshots at 960x562, 427 KB total). The other PNGs are gitignored and regenerated by each run.

| File | SHA-256 |
|---|---|
| `report.json` | `ec338ab4fa1aab3a0664975e3b58345972b8908b878d237e842d81add0782cfd` |
| `manifest.json` | `465516d45c86decaec885b8e3b38a43a1b1a85feb5b86ab5f4a877e30168fa92` |
| `committed/home.png` | `f3b447a47aeea4ec84f6f2fa40e8242bd6febd33d4a20dc73a331723d2cf0eaf` |
| `committed/confirm_dialog_destructive.png` | `6a8f3309aafb1cf16426bcdc16766045048532716f97880eeb54bfad28de0517` |
| `committed/phrase_active_hidden.png` | `6e749c60cdd09ee07155a084c953a05cdb655046cdafd05a85164f4108ca97ce` |
| `committed/response_rating.png` | `bc64d87104936ff1dbcc5190e156e3a7763baed5825eda41243876ec8ef7b9ca` |
| `committed/reveal_below.png` | `86b5bc089e14254cae0899451ca4fcced22fbd8659a17009bc34c87261521596` |
| `committed/history.png` | `0baf61cafc23a0a3473b9ee2fa86c8f52275f4670e273e08fd5fcf083fb45f98` |
| `committed/store_p3_blind_capture.png` | `4d87d3f3f162dd298636e237ebf411d7708b093077707d87a0664a40b0c79cc4` |
| `committed/store_summary.png` | `c1c6acea280bf2a835b1d40fea66daddf8b37046956fb05fd919bf6c2b8a7be8` |

## 7. Limitations

- Web preview only: react-native-web, shimmed `react-native`, shimmed Kepler focus/BackHandler, a shimmed UI-scale hook, the preview's spatial navigation, and an in-page fixture-mode store. No VoiceView, no Vega focus engine, no real remote, no native rendering, no performance data.
- The store-mode journey uses a scripted relay and phone (Playwright `routeWebSocket` + `@atr/protocol`), with no real microphone or relay. It exercises the real session core and real screens.
- Colour contrast was measured for the focus ring only; axe `color-contrast` returned no violation but is unreliable on a CSS-scaled canvas, and high-contrast mode was not observed.
- axe covers only what exists in the web DOM, not Vega's accessibility tree.

## 7a. Update: protocol revision 4 follow-up

`tests/a11y/scripted-phone.ts` now speaks revision 4 (frames built with `quantizeDb` / `quantizeCoverage`, integer milliseconds, `auth.resume` answered with `auth.ok.next_credential` rotation, an optional `silent_input` first quiet check). Three tests were added in group D2 and the suite is now **48 tests: 44 pass + 4 expected-fail repros** (A11Y-01, A11Y-02, A11Y-03 and the browser twin of QA-09). `QA_STRICT=1` fails exactly those four, each for its intended reason.

- `silent_input` in the real UI: the quiet check fails, "Try again" is focused, the footer stays, nothing is captured, a good check recovers. Observation OBS-A8: the screen says "The window could not be scored." (QA-08 in `QA_REVIEW_T11_T13_T14.md`).
- Link loss on the quiet-check screen: warning banner, mic chip "Phone state unknown" (never "off"), nothing starts by itself, the first `auth.resume` presents the `room.created` credential, the mic chip recovers after the reconnect and the banner clears.
- DEFECT QA-09 in the browser: the real TV code presents the original credential again on its second reconnect (`credential_trail`: 2 resumes, `secondIsRotated: false`).
- **OBS-A9**: during a reconnect the quiet-check screen's preferred "Begin" is disabled, so focus moves to "Cancel" (`link_loss_focus`: active `action-cancel`) and returns when the link recovers. OK on Cancel only opens the Stay/Leave dialog, so it is safe, but VoiceView and the real focus engine must be observed for this focus jump (checklist item 7 and 12).

Commands (UTC 2026-10-04T23:15Z to 23:30Z): `npm run test:a11y -w @atr/tests` exit 0, 48 tests; `QA_STRICT=1 npm run test:a11y -w @atr/tests` exit 1, 4 fail / 44 pass.

## 7b. Update: contract revision 2 (wave 2), T17-prep browser re-review deferred

The session-core rework removed `accept_join` (number matching: `pick_choice_1..3` plus Reject, Reject preferred) and changed the wire input to raw text. The TV rework that renders it is not merged yet, so at this head the preview's join screen still has the old controls.

- `tests/a11y/scripted-phone.ts` is rev 2 ready: raw text frames only, `requestJoin(digits)` exposes `confirmDigits`, and the e2e picks the choice whose label contains the digits with arrow keys and Enter (`pickMatchingChoice`); a new store-mode test checks that a wrong pick rejects and burns the code, that Reject and Back reject, and that the right pick pairs.
- The store-mode groups (D and D2: the real store through the real screens, silent_input, link loss and rotation, the wrong-pick test and the A11Y-01 repro) are gated by `TV_UI_REV2=1` and skipped by default until the tv rework lands. `QA-09` in the browser is now a regular test (the rotation fix is in session-core) and is part of the gated group.
- Ungated result at `7785c45` (`npm run test:a11y -w @atr/tests`, exit 0): 49 tests, 42 pass (including the expected-fail repros A11Y-02 and A11Y-03) and 7 skipped. `QA_STRICT=1` fails exactly A11Y-02 and A11Y-03. The artifacts in `tests/a11y/artifacts/` are from the last full run (revision 4 head), not regenerated, because a partial run would overwrite the store-mode evidence.
- OBS-A2 (default focus Accept on a join request) is resolved by the contract (Reject is preferred); it still has to be confirmed in the rendered UI after the tv merge.

The full T17-prep re-review (all groups, `TV_UI_REV2=1`) waits for the tv rework.

## 8. Checklist for the VVD / VoiceView / UI-scale session (all `pending_external` until done)

Record the build id, VVD image, date, available UI-scale steps and VoiceView version; screen-record each run; label results `real_VVD` only when produced on the VVD. Use the store-driven flow (real copy), not the fixtures.

1. **Remote-only journey (R-U1, R-U2).** Install; with only D-pad, OK and Back complete: onboarding, pair (code and QR), quiet check, calibration, optional sustained sound, phrases including blind 3 (and 6, 9 with a bank of 9 or 10), summary, history, delete. Compare the first-focused control on every screen with `report.json` (`focused`) and the control order with `ariaOrder`.
2. **Real D-pad navigation.** Every multi-control screen (Home column, Settings two-row grid, Join, Reveal): each enabled control is reachable and no D-pad move is surprising (the preview's Settings quirk, OBS-A6).
3. **Focus visibility.** Ring visible and not clipped at 100% and at every scale step; ring contrast acceptable on the TV.
4. **Disabled controls (A11Y-01).** Settings outside a session: `Reset today's band` and `Unpair phone` cannot be focused (or VoiceView says unavailable) and OK does nothing.
5. **Dialogs (A11Y-02).** Open Delete: VoiceView announces the title and body once (not twice), Cancel is focused, the D-pad cannot leave the dialog, Back closes it and focus returns to the opener; confirming deletes only `atr:` data.
6. **VoiceView order and hints.** For each screen read the order and compare it with `ariaOrder`; the hint is read after the label; QR announced as an image with its label; pairing code and confirm digits read digit by digit.
7. **Quiet windows with VoiceView ON (ADR-0008, R-U3).** After OK on Begin: no speech during the 1.5 s lead is required, but nothing may be spoken during the precheck or capture; record what VoiceView does when focus disappears at the start and when "Stop now" takes focus at capture start; compare the precheck floor rise against a run with VoiceView OFF to detect contamination. Do not disable the user's accessibility service.
8. **Blind attempt with VoiceView ON (R-G1..G3).** Nothing about level or verdict is spoken before reveal; after the rating the result is spoken once.
9. **UI scale (A11Y-03, R-U4).** Walk every screen at every supported step: nothing clipped, the footer text visible on every screen (especially Home, Summary, Calibration, capture screens), nothing starts above the screen.
10. **Duplicate OK on the device.** 20 quick OK presses on Begin start one window; OK during the lead/precheck does nothing; Back cancels at every phase.
11. **High contrast / large text** if the platform offers them; record that they were not available if not.
12. **Back semantics.** Back on every screen is "one up" and never exits; Home leaves the app; Back during capture stops the real phone's microphone (browser capture indicator off).
13. **Kill and relaunch mid-capture** (also in `QA_REVIEW_T11_T13_T14.md`): Resume/Discard prompt, Cancel-or-safe default focus, VoiceView reading of the prompt.
14. **Summary and history read-out.** VoiceView reads the denominators ("x of y"), "No session" days and the incomplete flag; confirm the product decision on "Reached the far side" wording (OBS-A4).

## 9. Wave 2: T17-prep re-review of the reworked TV (`d239809`: tv rework `7806229`, contract revision 2, session rework, protocol revision 4)

Evidence class: **web_preview** (Chrome 154.0.8037.97, Vite `build` + `preview`, react-native-web with shims) plus **automated** for the jest and vitest results. Not VoiceView, not the Vega focus engine, not the real UI-scale setting (the shim applies one multiplier; Vega's spacing type shrinks at larger scales). T17 itself stays `pending_external` (B-001).

### 9.1 Verdict

**T17-prep wave 2: accept-with-defects.** Two Medium defects are open (A11Y-04, A11Y-05); no Blocker, no High. The three defects from the first review that were routed to tv are fixed and verified; the reworked number-matching UI, the visual-only chips (A8-01) and the screen-reader input (A8-02) behave as specified in the browser.

### 9.2 Status of the earlier findings

| Id | Was | Now | Evidence |
|---|---|---|---|
| A11Y-01 | Medium, disabled controls focusable | **fixed** | Settings outside a session: `Reset today's band` and `Unpair phone` have `aria-disabled="true"` and `tabindex=-1`; no fixture exposes a disabled-but-focusable control (hard assertion on all 29) |
| A11Y-02 | Medium, dialog unnamed (axe serious) | **fixed** | axe finds no `aria-dialog-name`; the `alertdialog` has an accessible name; the dialog title appears once in the page text |
| A11Y-03 | Medium, overflow at 1.5 | **replaced by the ruling** (scrolling is acceptable) | new check, section 9.3; passes at 1.0, 1.25, 1.5 |
| QA-09 (browser) | High, consumed credential | **fixed** | the real TV code presents the rotated credential on its second reconnect (`credential_trail.secondIsRotated: true`) |
| OBS-A1 | fixtures drift from the core | **resolved** | fixtures are synced to the real store; the sweep covers the new views |
| OBS-A2 | default focus Accept on a join | **resolved** | `join_confirm` prefers `action-reject_join` in the real UI and the fixture; OK-on-default rejects |
| OBS-A4 | "Reached the far side" wording | **resolved** | the summary says "Reached today's relative level band, blind checks: 1 of 1" |
| OBS-A7 | `npm run dev` did not start | **resolved** | `vite` in `apps/tv/web` starts and serves `index.html` and `src/main.tsx` (HTTP 200); the suite still uses `build` + `preview` |
| OBS-A5 | axe non-critical | now 13 minor (`aria-allowed-role`, the RN role `summary`) + 1 moderate (`landmark-unique`); **no serious or critical** | `report.json` |

### 9.3 A11Y-03 re-expressed (ruling) and what it found

The check, run on all 29 screens at 1.0, 1.25, 1.5 and 2.0, keyboard only: (a) the footer stays fully visible, (b) every enabled control, reached by arrow keys, becomes fully on the canvas, essentially visible in its scroll viewport (at least 90 %) and clear of the pinned footer when it receives focus, (c) no content is clipped horizontally, (d) at 1.0 and 1.25 nothing scrolls and nothing fixed lies beyond the canvas. Focus-driven scrolling settles within 2 to 13 ms at 1.0 to 1.5 (about 830 ms timeout at 2.0 only because of A11Y-05).

- **1.0, 1.25, 1.5: all four conditions hold.** Information: at 1.5 only `summary` and `summary_incomplete` scroll (219 px). Nothing scrolls at 1.0 and 1.25.
- **2.0 (information):** 20 of 29 screens scroll: home 378, pairing 302, join_confirm 343, permission_pending 47, calibration 150, vowel_active 138, vowel_result 170, phrase_ready 313, phrase_active_visible 199, response_rating 279, response_listener_waiting 336, reveal_reached 491, reveal_below 414, reveal_not_scored 337, summary 977, summary_incomplete 1054, history 346, paused_or_invalid 362, settings 578, about 331 (px). The footer stayed visible on every screen.

### 9.4 Open defects (both Medium, `it.fails` repros in `tests/a11y/tv-web-preview.e2e.ts`)

- **A11Y-04: the screen scroller clips the focus ring.** The focused control is drawn with a 6 px ring and a 1.05 scale, so its box grows by about 8 px beyond its layout box, and the new `ScrollView` (`FocusScroll.tsx`) clips anything outside its padding box. A control at the left edge of the content (every left-aligned control on every screen, at every scale) loses its left ring segment (box left 72 against a viewport left of 80: the whole 6 px left border is outside). At 2.0 the last control (for example Cancel on `permission_pending` and `calibration`) loses a few pixels at the bottom. 123 control-visits are affected across the four scales (27, 28, 30 and 38). The ring is still visible on the other sides and the background changes, so focus is still perceivable, but the designed ring is cut off. A screenshot of the left edge was inspected. Fix: give the scroll content horizontal and bottom padding at least the ring plus scale growth (about 10 px), or move the page padding inside the scroll content.
- **A11Y-05: at UI scale 2.0 content is clipped horizontally.** `join_confirm`: the three number buttons plus Reject need 1736 px in a 1600 px viewport, so the first and third number buttons are cut at the sides (74 % and 85 % visible when focused; `left=10 right=598` for the first). `calibration`: the timer block and the meter row are wider than the screen (content 1865 px in 1600 px; 10 elements beyond the left edge, the timer label starts at x = -30 and the meter caption reads "Relative level, no b…"). Horizontal scrolling is not offered, so the cut content cannot be reached. The number choices are the security-relevant prompt, hence Medium. Fix: wrap the number row to a second line (or stack it) and let the timer and meter wrap at large scales.

### 9.5 Additional checks in this wave (all pass)

- Real store through the real screens, keyboard only, with the number-matching UI: pair (a choice whose label contains the phone's digits is pressed with arrow keys and Enter), quiet check, calibration, Back during capture, retry, blind phrase 3, summary ("Phrases completed: 3 of 3 attempted, 0 skipped", "Attempts not scored: 1 (cancelled 1)", blind 1 of 1, other phrases 1 of 2), history ("2 of 3 reached", six days "No session").
- Wrong number pick: the TV sends reject, shows "That number did not match. Pair again.", shows no code or QR, and a later right pick pairs; Back also rejects; Reject is the focused default.
- A8-01: while a window is open the status chips, labels and banner are `aria-hidden` with no label (4 elements checked at phrase 1 capture); after the window closes they are labelled again.
- A8-02: `?screenReader=1` gives the quiet-check script ("After this message, stay quiet for the whole check. Measurement lasts five seconds.") and a measured lead of 3070 ms; without it 1603 ms and no script.
- `silent_input`: the quiet check fails, Try again is focused, and the screen now says "The phone microphone looks muted or blocked."
- Link loss on the quiet-check screen: mic chip "Phone state unknown", warning banner, the first `auth.resume` presents the `room.created` credential, recovery clears the banner. OBS-A9 still holds: while Begin is disabled focus sits on Cancel (`link_lost` focus: `action-cancel`); OK on it only opens the Stay/Leave dialog. Needs a VVD look.
- 29 fixtures: footer on all, every interactive element named, 28 screens have one preferred control holding focus with a ring (contrast 13.26:1 minimum), 1 screen has no focusable control (`quiet_check`, the running quiet check: Back is the control), and the capture fixtures `phrase_active_visible` and `phrase_active_hidden` now carry Stop now and Cancel window like the real capture phase, Back and OK reach the store, no blind fixture has a meter, svg or result element.

### 9.6 The scripted phone and the `integrity` stall

The journey stalled at calibration with `integrity`. **This is not a session-core false positive.** The script reported `duration_ms: 8000` (160 frames) for a calibration window the TV had commanded for 6000 ms. The frame passed the protocol validators (the wire invariants all held: frame counts, coverage, active time, percentile order, so the TV acknowledged it), then failed the TV-only rule of A1-09, `duration_ms <= max_duration_ms + 500` (8000 > 6500). `active_ms` (2500, at least 400) and the margin (20 dB, at least 13) were fine. A real phone cannot trigger it: `phone-mic-meter` clamps `duration_ms` to `max_duration_ms`. The fix is in the script (the duration now follows the commanded `max_duration_ms`, `expected_frames` follows the duration), not in the TV, and `tests/a11y/scripted-phone.unit.ts` (8 tests, no browser) now checks the script's payloads against the protocol validators and session-core's re-validation, including the exact 6500/6501 ms boundary, so a drift fails with a reason instead of stalling.

### 9.7 Commands (UTC 2026-10-05 00:00Z to 00:35Z, commit `d239809`, Node v25.2.1)

| Command | Exit | Result |
|---|---|---|
| `npm install`, `npm ci --ignore-scripts` in `apps/tv` and `apps/tv/web`, `npm run build -w` the four packages | 0 | rebuilt |
| `npm test -w @atr/tests` | 0 | 163 tests, all pass (the coordinator unwrapped QA-10..13; no expected-fail left in the review suite) |
| `npm run test:a11y -w @atr/tests` | 0 | 59 tests (51 browser + 8 unit): 57 pass + 2 expected-fail repros (A11Y-04, A11Y-05), none skipped |
| `QA_STRICT=1 npm run test:a11y -w @atr/tests` | 1 | exactly A11Y-04 and A11Y-05 fail, each for its intended reason |
| `npm run typecheck -w @atr/tests` | 0 | no type errors |

`TV_UI_REV2=0` now skips the store-mode groups (used only against an older UI); by default they run.

### 9.8 Still `pending_external` (VVD checklist in section 8 stands)

VoiceView order, announcements, dialogs and the A8-01/A8-02 behaviour; the real focus engine (including the focus jump to Cancel during an outage and the ring clipping of A11Y-04 on the TV); real UI-scale steps (the scroll and the 2.0 clipping above are preview results from one shimmed multiplier); high contrast; all of T17.

