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

## 5. Commands run

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

## 6. Artifacts and hashes

`tests/a11y/artifacts/`: `report.json` (per-screen controls, focus, ring contrast, axe violations, scale overflow lists, the store journey and its phone message log), `manifest.json` (SHA-256 of every PNG written by the run, not a regression baseline: a few screens vary run to run), `committed/*.png` (8 small screenshots at 960x562, 427 KB total). The other PNGs are gitignored and regenerated by each run.

| File | SHA-256 |
|---|---|
| `report.json` | `368f4a38a7d9b354d904221b5835798e2a1da15045e148df36ded420b2607198` |
| `manifest.json` | `f32220fcf091a5ba20165a7fd2b427d854ced7854b0ab1cb10f2474d3569ac55` |
| `committed/home.png` | `131f8334c39150f744bdd5c5384c1bff81ee7fdd900318eff90e1f1bbdf161b7` |
| `committed/confirm_dialog_destructive.png` | `4e1eb7801c0a7a0709c69f328392e8b4c56c308e9c46e9ec023562ea64ec80be` |
| `committed/phrase_active_hidden.png` | `898cc5f3945cf7e430e21cf696e56cd7a29489f6538cec7028f1b3117c6d5e79` |
| `committed/response_rating.png` | `0583d48858d1ab4f34bee909a129a32834f85cff8dbffb176854bd8d56143946` |
| `committed/reveal_below.png` | `51cd488d1f9fdc1856046cb3df35e56878cd8910887f6e366b4d61b380c63969` |
| `committed/history.png` | `1803fb2adf4bdc83e0a4818c1ee08c048b5de08eff5e5ef8e22ff281ee3364b9` |
| `committed/store_p3_blind_capture.png` | `36e0bf522f46d0ed5c26c6d06fa5b8f2de4f082bf68d672b0e837b60c40900ad` |
| `committed/store_summary.png` | `fb4f7e9db208e637d145e51555bb0d9b32c141a1883f30d6a521e58064a561ed` |

## 7. Limitations

- Web preview only: react-native-web, shimmed `react-native`, shimmed Kepler focus/BackHandler, a shimmed UI-scale hook, the preview's spatial navigation, and an in-page fixture-mode store. No VoiceView, no Vega focus engine, no real remote, no native rendering, no performance data.
- The store-mode journey uses a scripted relay and phone (Playwright `routeWebSocket` + `@atr/protocol`), with no real microphone or relay. It exercises the real session core and real screens.
- Colour contrast was measured for the focus ring only; axe `color-contrast` returned no violation but is unreliable on a CSS-scaled canvas, and high-contrast mode was not observed.
- axe covers only what exists in the web DOM, not Vega's accessibility tree.

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
