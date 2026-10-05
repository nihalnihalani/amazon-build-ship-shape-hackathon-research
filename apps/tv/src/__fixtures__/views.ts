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

const JOIN_PICK_HINT = 'Choose this number only if it is the number shown on the phone.';
const BEGIN_HINT = 'Starts a short check, then the window';
const STOP_HINT = 'Press OK to stop early. Back cancels this window.';

const PHRASE = { position: 3, total: 10, text: 'Buy Bobby a puppy', attemptNumber: 1 };

export const onboarding = makeView({
  screen: 'onboarding',
  stage: 'idle',
  title: 'Welcome to Across the Room',
  body: ['This is practice support for the loudness exercises you already do.', 'It is not a medical device.'],
  actions: [action('continue', 'I understand')],
  preferredAction: 'continue',
});

export const home = makeView({
  screen: 'home',
  stage: 'idle',
  title: 'Across the Room',
  body: ['Yesterday: 6 of 10 reached.'],
  announcement: 'Home. Start session is selected.',
  actions: [
    action('start_session', 'Start session'),
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
  actions: [action('refresh_code', 'New code'), action('cancel', 'Cancel')],
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
    action('pick_choice_1', '42', { hint: JOIN_PICK_HINT }),
    action('pick_choice_2', '17', { hint: JOIN_PICK_HINT }),
    action('pick_choice_3', '86', { hint: JOIN_PICK_HINT }),
    action('reject_join', 'Reject'),
  ],
  preferredAction: 'reject_join',
});

export const permissionPending = makeView({
  screen: 'permission_pending',
  stage: 'permission_pending',
  title: 'Start the microphone on the phone',
  body: ['On the phone, tap Start microphone and allow access.'],
  mic: 'waiting_for_permission',
  link: 'connected',
  actions: [action('cancel', 'Cancel')],
  preferredAction: 'cancel',
});

export const quietCheck = makeView({
  screen: 'quiet_check',
  stage: 'quiet_check',
  title: 'Quiet check',
  body: ['Quiet please, 5 seconds', 'Press Back to cancel this window.'],
  capturing: true,
  mic: 'measuring',
  link: 'connected',
  timer: { elapsedMs: 1800, maxMs: 5000, label: 'Quiet please, 5 seconds' },
  // The real core exposes no controls during the quiet check: Back cancels.
  actions: [],
  preferredAction: null,
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
  actions: [
    action('begin_vowel', 'Begin', { hint: BEGIN_HINT }),
    action('skip_vowel', 'Skip this step'),
    action('open_settings', 'Settings'),
  ],
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
  actions: [action('stop_early', 'Stop now', { hint: STOP_HINT }), action('cancel', 'Cancel window')],
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
  actions: [action('continue', 'Continue to phrases'), action('rest', 'Rest, then try again')],
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
  actions: [
    action('begin_phrase', 'Begin', { hint: BEGIN_HINT }),
    action('skip_phrase', 'Skip phrase'),
    action('finish_early', 'Finish early'),
    action('open_settings', 'Settings'),
  ],
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
  actions: [action('stop_early', 'Stop now', { hint: STOP_HINT }), action('cancel', 'Cancel window')],
  preferredAction: 'stop_early',
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
  actions: [action('stop_early', 'Stop now', { hint: STOP_HINT }), action('cancel', 'Cancel window')],
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
  actions: [action('stop_early', 'Stop now', { hint: STOP_HINT }), action('cancel', 'Cancel window')],
  preferredAction: 'stop_early',
});

/** Quiet lead and precheck of a window: the real core exposes no controls; Back cancels. */
export const phraseLead = makeView({
  screen: 'phrase',
  stage: 'phrase_active',
  title: 'Phrase 3 of 10',
  body: ['Get ready', 'Press Back to cancel this window.'],
  capturing: true,
  mic: 'measuring',
  link: 'connected',
  phrase: PHRASE,
  timer: { elapsedMs: 500, maxMs: 1500, label: 'Get ready' },
  labels: ['Blind check: the meter is hidden for this phrase'],
  actions: [],
  preferredAction: null,
});

export const responseRating = makeView({
  screen: 'response',
  stage: 'response_pending',
  title: 'How did that feel?',
  body: ['Choose how loud that phrase felt to you. You can skip the rating.'],
  announcement: 'How did that feel?',
  mic: 'open_not_measuring',
  link: 'connected',
  phrase: PHRASE,
  actions: [
    action('rate_felt_loud', 'Felt loud'),
    action('rate_felt_normal', 'Felt normal'),
    action('rate_skip', 'Skip rating'),
  ],
  preferredAction: 'rate_felt_loud',
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
  announcement: "Reached today's relative level band.",
  mic: 'open_not_measuring',
  link: 'connected',
  phrase: PHRASE,
  result: {
    label: "Reached today's relative level band",
    tone: 'reached',
    detail: null,
    borderline: false,
    listener: 'Listener: heard',
    speakerRating: 'You felt: normal',
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
    label: "Reached today's relative level band (unqualified phone)",
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
  result: {
    label: "Below today's relative level band",
    tone: 'below',
    detail: "Borderline: within 1 dB of today's band edge. The result is kept.",
    borderline: true,
    listener: 'Listener: not heard',
    speakerRating: null,
  },
  actions: [action('next_phrase', 'Next phrase'), action('try_again', 'Try again')],
  preferredAction: 'try_again',
});

export const revealNotScored = makeView({
  screen: 'reveal',
  stage: 'reveal',
  title: 'Result',
  phrase: PHRASE,
  result: { label: 'Not scored', tone: 'not_scored', detail: 'A sudden sound was picked up. Try again when the room is quiet.', borderline: false, listener: null, speakerRating: null },
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
  lines: ['Reached counts use the best valid attempt for each phrase. Blind checks use the first valid attempt.'],
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
  title: 'Last 7 days',
  history: historyDays,
  actions: [action('done', 'Done')],
  preferredAction: 'done',
});

export const pausedOrInvalid = makeView({
  screen: 'paused_or_invalid',
  stage: 'paused_or_invalid',
  title: 'Paused',
  body: [
    'The link to the phone was lost, so the window was not scored. Start again when the phone is back.',
    'Available when the phone is connected and its microphone is open.',
  ],
  mic: 'unknown',
  link: 'reconnecting',
  banner: { kind: 'warning', text: 'Reconnecting to the relay' },
  actions: [
    action('retry', 'Try again', { hint: 'Available when the phone is connected and its microphone is open.', disabled: true }),
    action('skip_phrase', 'Skip phrase'),
    action('finish_early', 'Finish early'),
  ],
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
  body: ['Family mode: off.'],
  actions: [
    action('toggle_family_mode', 'Family mode'),
    action('reset_calibration', 'Reset today\'s band', {
      disabled: true,
      hint: 'Clears the band for this session only. Needs a session with a band.',
    }),
    action('delete_local_data', 'Delete local practice data', {
      destructive: true,
      hint: 'Removes everything this app saved on the TV. Not available during a session.',
    }),
    action('unpair_phone', 'Unpair phone', { disabled: true, hint: 'Revokes the phone. Not available during a session.' }),
    action('open_about', 'About'),
    action('open_diagnostics', 'Diagnostics (developer)'),
    action('back', 'Back'),
  ],
  // The real core leaves the preferred action empty here; the UI then focuses the first enabled control.
  preferredAction: null,
});

export const confirmDialogDestructive = makeView({
  screen: 'confirm_dialog',
  stage: 'idle',
  title: 'Delete all practice data?',
  body: ['This removes every phrase, setting and session summary this app saved on the TV. It cannot be undone.'],
  dialog: {
    title: 'Delete all practice data?',
    body: 'This removes every phrase, setting and session summary this app saved on the TV. It cannot be undone.',
    confirm: action('confirm_destructive', 'Delete data', { destructive: true }),
    cancel: action('cancel_destructive', 'Cancel'),
    preferred: 'cancel',
  },
  // The real core lists both dialog controls in view.actions as well; the UI renders the dialog's own.
  actions: [action('cancel_destructive', 'Cancel'), action('confirm_destructive', 'Delete data', { destructive: true })],
  preferredAction: 'cancel_destructive',
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

/**
 * The screens the web preview lists. The accessibility gate (tests/a11y) asserts this exact list, so a new name
 * here must be added there too.
 */
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
  ['response_rating', responseRating],
  ['response_listener_waiting', responseListenerWaiting],
  ['reveal_reached', revealReached],
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

/** Extra fixtures for jest and for ?screen= in the preview. They are not in the listed set above. */
export const extraScreens: ReadonlyArray<readonly [string, TvView]> = [
  ['phrase_lead', phraseLead],
  ['reveal_unqualified', revealUnqualified],
  ['phrase_capturing_banner_cue', phraseCapturingBannerAndCue],
];

/** Everything jest sweeps. */
export const everyScreen: ReadonlyArray<readonly [string, TvView]> = [...allScreens, ...extraScreens];
