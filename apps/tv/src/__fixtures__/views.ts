/**
 * Fixture TvView objects, one or more per screen. These are hand-written test data for the UI only; they are
 * not measurements and are never shown in the running app.
 */
import type { ActionId, HistoryDayView, ScreenId, SummaryView, TvStage, TvView, ViewAction } from '@atr/session-core';

export const FOOTER = 'Not a medical device. Does not diagnose or treat any condition.';

export function action(id: ActionId, label: string, extra: Partial<ViewAction> = {}): ViewAction {
  return { id, label, ...extra };
}

export function makeView(overrides: Partial<TvView> & { screen: ScreenId; stage: TvStage }): TvView {
  return {
    title: 'Title',
    body: [],
    announcement: null,
    capturing: false,
    actions: [],
    preferredAction: null,
    pairing: null,
    mic: 'not_paired',
    link: 'offline',
    meter: null,
    timer: null,
    phrase: null,
    result: null,
    cue: null,
    summary: null,
    history: null,
    dialog: null,
    banner: null,
    labels: [],
    footer: FOOTER,
    diagnostics: null,
    ...overrides,
  };
}

const PHRASE = { position: 3, total: 10, text: 'Buy Bobby a puppy', attemptNumber: 1 };

export const onboarding = makeView({
  screen: 'onboarding',
  stage: 'idle',
  title: 'Welcome',
  body: ['This is practice support for the loudness exercises you already do.', 'It is not a medical device.'],
  actions: [action('continue', 'I understand', { hint: 'Continues to the home screen' })],
  preferredAction: 'continue',
});

export const home = makeView({
  screen: 'home',
  stage: 'idle',
  title: 'Across the Room',
  body: ['Yesterday: 6 of 10 reached.'],
  announcement: 'Home. Start session is selected.',
  actions: [
    action('start_session', 'Start session', { hint: 'Begins a new practice session' }),
    action('open_history', 'History'),
    action('open_settings', 'Settings'),
    action('pair_phone', 'Pair phone'),
  ],
  preferredAction: 'start_session',
});

export const pairing = makeView({
  screen: 'pairing',
  stage: 'pairing',
  title: 'Pair the phone',
  body: ['Open the phone page and enter this code. The phone stays by the TV.'],
  mic: 'not_paired',
  link: 'connected',
  pairing: {
    code: 'ACDEFH',
    codeExpiresAt: Date.now() + 9 * 60 * 1000,
    qrPayload: 'https://relay.example.test/join?c=ACDEFH',
    joinRequest: null,
  },
  actions: [action('cancel', 'Cancel'), action('refresh_code', 'Refresh code')],
  preferredAction: 'cancel',
});

export const joinConfirm = makeView({
  screen: 'join_confirm',
  stage: 'pairing',
  title: 'A phone wants to join',
  body: ['This text is ignored: the UI owns the wording of this prompt.'],
  link: 'connected',
  pairing: {
    code: 'ACDEFH',
    codeExpiresAt: null,
    qrPayload: null,
    joinRequest: { deviceLabel: 'Pixel 8', choices: ['42', '17', '86'] },
  },
  actions: [
    action('pick_choice_1', 'Number 42'),
    action('pick_choice_2', 'Number 17'),
    action('pick_choice_3', 'Number 86'),
    action('reject_join', 'Reject'),
  ],
  preferredAction: 'reject_join',
});

export const permissionPending = makeView({
  screen: 'permission_pending',
  stage: 'permission_pending',
  title: 'Allow the microphone on the phone',
  body: ['The phone is asking for microphone permission.'],
  mic: 'waiting_for_permission',
  link: 'connected',
  actions: [action('cancel', 'Cancel')],
  preferredAction: 'cancel',
});

export const quietCheck = makeView({
  screen: 'quiet_check',
  stage: 'quiet_check',
  title: 'Quiet please',
  body: ['Stay quiet for 5 seconds.'],
  capturing: true,
  mic: 'measuring',
  link: 'connected',
  timer: { elapsedMs: 1800, maxMs: 5000, label: 'Quiet check' },
  actions: [action('cancel', 'Cancel', { hint: 'Stops the check' })],
  preferredAction: 'cancel',
});

export const calibration = makeView({
  screen: 'calibration',
  stage: 'calibration',
  title: 'Set today\'s band',
  body: ['From your seat, say: "Buy Bobby a puppy"'],
  capturing: true,
  mic: 'measuring',
  link: 'connected',
  timer: { elapsedMs: 2000, maxMs: 6000, label: 'Calibration phrase' },
  meter: { levelRelDb: 6.2, bandRelDb: null, active: true, caption: 'Relative level, this session only' },
  actions: [action('cancel', 'Cancel')],
  preferredAction: 'cancel',
});

export const vowelReady = makeView({
  screen: 'vowel',
  stage: 'vowel_ready',
  title: 'Say ahh',
  body: ['Say ahh, as long and loud as you can.'],
  announcement: 'Say ahh, as long and loud as you can. Press OK to begin.',
  mic: 'open_not_measuring',
  link: 'connected',
  actions: [action('begin_vowel', 'Begin'), action('skip_vowel', 'Skip')],
  preferredAction: 'begin_vowel',
});

export const vowelActive = makeView({
  screen: 'vowel',
  stage: 'vowel_active',
  title: 'Say ahh',
  capturing: true,
  mic: 'measuring',
  link: 'connected',
  timer: { elapsedMs: 4200, maxMs: null, label: 'Steady sound' },
  meter: { levelRelDb: 14, bandRelDb: 8, active: true, caption: 'Relative level, this session only' },
  actions: [action('stop_early', 'Stop')],
  preferredAction: 'stop_early',
});

export const vowelResult = makeView({
  screen: 'vowel',
  stage: 'vowel_result',
  title: 'Steady sound',
  body: ['14.2 seconds'],
  mic: 'open_not_measuring',
  link: 'connected',
  result: { label: 'Longest steady sound: 14.2 s', tone: 'neutral', detail: null, borderline: false, listener: null, speakerRating: null },
  actions: [action('continue', 'Continue'), action('retry', 'Redo')],
  preferredAction: 'continue',
});

export const phraseReady = makeView({
  screen: 'phrase',
  stage: 'phrase_ready',
  title: 'Say the phrase',
  body: ['From your seat, say the phrase on the screen. Press OK to begin.'],
  announcement: 'Phrase 3 of 10. Press OK to begin.',
  mic: 'open_not_measuring',
  link: 'connected',
  phrase: PHRASE,
  actions: [action('begin_phrase', 'Begin'), action('skip_phrase', 'Skip phrase')],
  preferredAction: 'begin_phrase',
});

/** A visible attempt: the arc and band tick are present. */
export const phraseActiveVisible = makeView({
  screen: 'phrase',
  stage: 'phrase_active',
  title: 'Say the phrase',
  capturing: true,
  mic: 'measuring',
  link: 'connected',
  phrase: { ...PHRASE, position: 2 },
  timer: { elapsedMs: 3000, maxMs: 30000, label: 'Phrase window' },
  meter: { levelRelDb: 12.5, bandRelDb: 9, active: true, caption: 'Relative level, this session only' },
  labels: ['Relative level, this session only'],
});

/** A visible attempt with a banner and a cue chip arriving during the window: both must be visual only (A8-01). */
export const phraseCapturingBannerAndCue = makeView({
  screen: 'phrase',
  stage: 'phrase_active',
  title: 'Say the phrase',
  announcement: 'This must never be spoken while capturing',
  capturing: true,
  mic: 'measuring',
  link: 'connected',
  phrase: { ...PHRASE, position: 2 },
  timer: { elapsedMs: 3000, maxMs: 30000, label: 'Phrase window' },
  meter: { levelRelDb: 12.5, bandRelDb: 9, active: true, caption: 'Relative level, this session only' },
  banner: { kind: 'warning', text: 'The room is getting noisy' },
  cue: { text: 'Louder', expiresAt: Date.now() + 60_000 },
  actions: [action('stop_early', 'Stop'), action('cancel', 'Cancel')],
  preferredAction: 'stop_early',
  labels: ['Relative level, this session only'],
});

/** A hidden first attempt: the view carries NO meter, NO result and NO level-dependent text. */
export const phraseActiveHidden = makeView({
  screen: 'phrase',
  stage: 'phrase_active',
  title: 'Say the phrase',
  capturing: true,
  mic: 'measuring',
  link: 'connected',
  phrase: PHRASE,
  timer: { elapsedMs: 3000, maxMs: 30000, label: 'Phrase window' },
  labels: ['Blind check: the meter is hidden for this phrase'],
  meter: null,
  result: null,
});

export const responseRating = makeView({
  screen: 'response',
  stage: 'response_pending',
  title: 'How loud did that feel?',
  body: ['Choose how that phrase felt. The meter stays hidden until you answer.'],
  announcement: 'How loud did that feel?',
  mic: 'open_not_measuring',
  link: 'connected',
  phrase: PHRASE,
  actions: [
    action('rate_felt_loud', 'Felt loud'),
    action('rate_felt_normal', 'Felt normal'),
    action('rate_skip', 'Skip rating'),
  ],
  preferredAction: 'rate_felt_normal',
});

export const responseListenerWaiting = makeView({
  screen: 'response',
  stage: 'response_pending',
  title: 'Waiting for the listener',
  body: ['The listener has not answered yet.'],
  mic: 'open_not_measuring',
  link: 'connected',
  phrase: PHRASE,
  cue: { text: 'Louder', expiresAt: Date.now() + 3000 },
  actions: [action('keep_waiting', 'Keep waiting'), action('continue_without_listener', 'Continue without listener response')],
  preferredAction: 'keep_waiting',
});

export const revealReached = makeView({
  screen: 'reveal',
  stage: 'reveal',
  title: 'Result',
  announcement: 'Reached the far side.',
  mic: 'open_not_measuring',
  link: 'connected',
  phrase: PHRASE,
  result: {
    label: 'Reached the far side',
    tone: 'reached',
    detail: 'Above today\'s band',
    borderline: false,
    listener: 'Heard',
    speakerRating: 'Felt normal',
  },
  actions: [action('next_phrase', 'Next phrase'), action('try_again', 'Try again'), action('finish_early', 'Finish early')],
  preferredAction: 'next_phrase',
});

export const revealUnqualified = makeView({
  screen: 'reveal',
  stage: 'reveal',
  title: 'Result',
  phrase: PHRASE,
  result: {
    label: 'Reached the far side (unqualified phone)',
    tone: 'reached',
    detail: null,
    borderline: false,
    listener: null,
    speakerRating: null,
  },
  actions: [action('next_phrase', 'Next phrase'), action('try_again', 'Try again')],
  preferredAction: 'next_phrase',
});

export const revealBelow = makeView({
  screen: 'reveal',
  stage: 'reveal',
  title: 'Result',
  phrase: PHRASE,
  result: { label: 'Did not reach the far side', tone: 'below', detail: 'Below today\'s band', borderline: true, listener: 'Not heard', speakerRating: null },
  actions: [action('next_phrase', 'Next phrase'), action('try_again', 'Try again')],
  preferredAction: 'try_again',
});

export const revealNotScored = makeView({
  screen: 'reveal',
  stage: 'reveal',
  title: 'Result',
  phrase: PHRASE,
  result: { label: 'Not scored', tone: 'not_scored', detail: 'The room was too noisy', borderline: false, listener: null, speakerRating: null },
  actions: [action('try_again', 'Try again'), action('next_phrase', 'Next phrase')],
  preferredAction: 'try_again',
});

export const summaryData: SummaryView = {
  complete: true,
  phrasesCompleted: 8,
  phrasesAttempted: 10,
  phrasesSkipped: 2,
  attemptsInvalid: 3,
  invalidReasons: { room_too_noisy: 2, clipped: 1 },
  reachedVisible: 5,
  scoredVisible: 7,
  reachedHidden: 1,
  scoredHidden: 3,
  longestActiveMs: 14200,
  hiddenRatings: { feltLoud: 1, feltNormal: 1, skipped: 1 },
  agreementHidden: { agree: 2, eligible: 3 },
  agreementVisible: { agree: 0, eligible: 0 },
  lateListenerResponses: 1,
  borderlineCount: 2,
  calibrationMarginDb: 9,
  lines: ['Bands are relative to this session only.'],
};

export const summary = makeView({
  screen: 'summary',
  stage: 'summary',
  title: 'Session summary',
  announcement: 'Session summary.',
  link: 'connected',
  summary: summaryData,
  actions: [action('done', 'Done'), action('open_history', 'View history')],
  preferredAction: 'done',
});

export const summaryIncomplete = makeView({
  screen: 'summary',
  stage: 'summary',
  title: 'Session summary',
  summary: { ...summaryData, complete: false },
  actions: [action('done', 'Done')],
  preferredAction: 'done',
});

/** Seven days; two have no session (null), one has a recorded session with nothing scored. */
export const historyDays: HistoryDayView[] = [
  { date: '2026-09-29', weekdayLabel: 'Tue', sessions: 1, reached: 6, scored: 10, longestActiveMs: 12400, incomplete: false },
  { date: '2026-09-30', weekdayLabel: 'Wed', sessions: null, reached: null, scored: null, longestActiveMs: null, incomplete: false },
  { date: '2026-10-01', weekdayLabel: 'Thu', sessions: 2, reached: 9, scored: 10, longestActiveMs: 15100, incomplete: false },
  { date: '2026-10-02', weekdayLabel: 'Fri', sessions: null, reached: null, scored: null, longestActiveMs: null, incomplete: false },
  { date: '2026-10-03', weekdayLabel: 'Sat', sessions: 1, reached: 0, scored: 4, longestActiveMs: 8000, incomplete: true },
  { date: '2026-10-04', weekdayLabel: 'Sun', sessions: 1, reached: null, scored: null, longestActiveMs: null, incomplete: false },
  { date: '2026-10-05', weekdayLabel: 'Mon', sessions: 1, reached: 7, scored: 8, longestActiveMs: 13000, incomplete: false },
];

export const history = makeView({
  screen: 'history',
  stage: 'history',
  title: 'History',
  history: historyDays,
  actions: [action('done', 'Done')],
  preferredAction: 'done',
});

export const pausedOrInvalid = makeView({
  screen: 'paused_or_invalid',
  stage: 'paused_or_invalid',
  title: 'Phone link lost',
  body: ['The phone stopped responding. Phone state unknown. Nothing was scored.'],
  mic: 'unknown',
  link: 'reconnecting',
  banner: { kind: 'warning', text: 'Reconnecting to the relay' },
  actions: [action('retry', 'Pair again'), action('cancel', 'End session')],
  preferredAction: 'retry',
});

export const resumeOrDiscard = makeView({
  screen: 'resume_or_discard',
  stage: 'resume_or_discard',
  title: 'Resume the last session?',
  body: ['A session was interrupted. Resuming never invents results.'],
  actions: [action('resume_session', 'Resume session'), action('discard_session', 'Discard session', { destructive: true })],
  preferredAction: 'resume_session',
});

export const settings = makeView({
  screen: 'settings',
  stage: 'idle',
  title: 'Settings',
  body: ['Practice data stays on this TV.'],
  actions: [
    action('toggle_family_mode', 'Family mode: Off'),
    action('reset_calibration', 'Reset today\'s band'),
    action('unpair_phone', 'Unpair phone'),
    action('delete_local_data', 'Delete local practice data', { destructive: true }),
    action('open_about', 'About'),
    action('open_diagnostics', 'Diagnostics'),
  ],
  preferredAction: 'toggle_family_mode',
});

export const confirmDialogDestructive = makeView({
  screen: 'confirm_dialog',
  stage: 'idle',
  title: 'Delete local practice data?',
  body: [],
  dialog: {
    title: 'Delete local practice data?',
    body: 'This removes every saved session from this TV. It cannot be undone.',
    confirm: action('confirm_destructive', 'Delete', { destructive: true }),
    cancel: action('cancel_destructive', 'Cancel'),
    preferred: 'cancel',
  },
});

/** A buggy view that asks for the destructive control to be preferred; the UI must still start on Cancel. */
export const confirmDialogWrongPreference: TvView = {
  ...confirmDialogDestructive,
  dialog: confirmDialogDestructive.dialog === null ? null : { ...confirmDialogDestructive.dialog, preferred: 'confirm' },
};

export const confirmDialogPlain = makeView({
  screen: 'confirm_dialog',
  stage: 'idle',
  title: 'End the session?',
  dialog: {
    title: 'End the session?',
    body: 'The session will be saved as incomplete.',
    confirm: action('confirm_destructive', 'End session'),
    cancel: action('cancel_destructive', 'Keep going'),
    preferred: 'confirm',
  },
});

export const about = makeView({
  screen: 'about',
  stage: 'idle',
  title: 'About',
  body: ['Practice support for exercises your clinician gave you.'],
  actions: [action('back', 'Back')],
  preferredAction: 'back',
});

export const diagnostics = makeView({
  screen: 'diagnostics',
  stage: 'idle',
  title: 'Diagnostics',
  diagnostics: { relay_rtt_ms: '180', schema_version: '1', link: 'connected' },
  actions: [action('back', 'Back')],
  preferredAction: 'back',
});

export const disabledAction = makeView({
  screen: 'home',
  stage: 'idle',
  title: 'Across the Room',
  actions: [
    action('start_session', 'Start session', { disabled: true }),
    action('open_history', 'History'),
  ],
  preferredAction: 'start_session',
});

/** Every screen id with at least one fixture. */
export const allScreens: ReadonlyArray<readonly [string, TvView]> = [
  ['onboarding', onboarding],
  ['home', home],
  ['pairing', pairing],
  ['join_confirm', joinConfirm],
  ['permission_pending', permissionPending],
  ['quiet_check', quietCheck],
  ['calibration', calibration],
  ['vowel_ready', vowelReady],
  ['vowel_active', vowelActive],
  ['vowel_result', vowelResult],
  ['phrase_ready', phraseReady],
  ['phrase_active_visible', phraseActiveVisible],
  ['phrase_active_hidden', phraseActiveHidden],
  ['phrase_capturing_banner_cue', phraseCapturingBannerAndCue],
  ['response_rating', responseRating],
  ['response_listener_waiting', responseListenerWaiting],
  ['reveal_reached', revealReached],
  ['reveal_unqualified', revealUnqualified],
  ['reveal_below', revealBelow],
  ['reveal_not_scored', revealNotScored],
  ['summary', summary],
  ['summary_incomplete', summaryIncomplete],
  ['history', history],
  ['paused_or_invalid', pausedOrInvalid],
  ['resume_or_discard', resumeOrDiscard],
  ['settings', settings],
  ['confirm_dialog_destructive', confirmDialogDestructive],
  ['confirm_dialog_wrong_preference', confirmDialogWrongPreference],
  ['confirm_dialog_plain', confirmDialogPlain],
  ['about', about],
  ['diagnostics', diagnostics],
];
