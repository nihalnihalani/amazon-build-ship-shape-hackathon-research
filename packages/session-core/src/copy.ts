/**
 * Every user-visible TV string. One module so a single grep can confirm there is no
 * programme name, trademark, diagnosis, clinical outcome claim or loudness-adequacy claim.
 * Result wording follows ADR-0001 §8: relative level only, never "loud enough" or "heard".
 */

export const FOOTER = 'Not a medical device. Does not diagnose or treat any condition.';
export const LABEL_RELATIVE = 'Relative level, this session only';
export const LABEL_FIXTURE = 'Fixture replay';
export const LABEL_NO_BAND = 'No band set: results not scored';
export const LABEL_LISTENER_EDITION = 'Listener Edition';
export const LABEL_SAME_HOST = 'Same-device microphone mode';
export const METER_CAPTION = 'Relative level, this session only';
export const PRIVACY_LINE =
  'Audio stays on this phone and is never saved or uploaded. Only levels, typed phrases, listener responses, and connection details are sent to the relay and TV.';

export const SUMMARY_COPY = {
  incomplete:
    'Incomplete session: it ended early, was interrupted, or was resumed. Do not compare it with completed sessions.',
  noBand: 'No band was set, so results were not scored.',
  countingRules:
    'Reached counts use the best valid attempt for each phrase. Blind checks use the first valid attempt, with the meter hidden.',
  listenerOff: 'Listener check was off for this session.',
  noEligible: 'No eligible listener responses',
  listenerEdition:
    "Listener Edition: the listener's answers are the primary outcome. Band results are not shown.",
  lateNote: 'Late listener responses are listed separately and are not counted in agreement.',
  borderlineNote: 'Some results were close to the band edge. Their verdicts are kept and counted separately.',
  relativeOnly: 'Levels are relative to the room in this session only. They are not sound pressure levels.',
};

export const UNQUALIFIED_SUFFIX = ' (unqualified phone)';

export const RESULT_COPY = {
  reached: "Reached today's relative level band",
  below: "Below today's relative level band",
  notScored: 'Not scored',
  noBand: LABEL_NO_BAND,
  listenerPending: 'Listener answer pending',
  borderline: "Borderline: within 1 dB of today's band edge. The result is kept.",
};

/** Reasons a window or attempt ended unscored (internal key -> sentence). */
export const REASON_COPY: Record<string, string> = {
  no_voice: 'No voice was detected. Try again when ready.',
  clipped: 'The sound was too strong for the microphone. Move the phone a little farther away and try again.',
  low_coverage: 'The phone did not report enough audio. Check the phone and try again.',
  continuous_sound: 'Sound continued the whole time, so the window could not be scored.',
  nonfinite: 'The microphone reported unusable data. Try again.',
  interrupted: 'The window was interrupted, so it was not scored.',
  cancelled: 'The window was cancelled, so it was not scored.',
  timeout: 'The phone did not answer in time, so the window was not scored.',
  no_start: 'The phone did not start measuring. Try again.',
  room_noisier: "The room is noisier than when we set today's band. Wait for quiet and try again.",
  unstable_floor: 'The room sound changed during the check. Wait for quiet and try again.',
  burst_noise: 'A sudden sound was picked up. Try again when the room is quiet.',
  too_loud: 'The room is too loud for a reliable check. Reduce background sound and try again.',
  session_ended: 'The session ended before this result was shown.',
  silent_input: 'The phone microphone looks muted or blocked.',
  integrity: "The phone's measurement was inconsistent, so it was not scored. Try again.",
  phone_reconnected: 'The phone reconnected, so the window was not scored.',
  unknown: 'The window could not be scored.',
};

export function reasonText(reason: string | null): string {
  if (reason === null) return REASON_COPY.unknown as string;
  return REASON_COPY[reason] ?? (REASON_COPY.unknown as string);
}

export const CAL_COPY = {
  tooQuiet:
    "Too quiet to set today's band. Try once more from your seat, or check the phone is on its mark.",
};

export const COPY = {
  starting: { title: 'Starting', body: ['Loading saved settings on this TV.'] },
  onboarding: {
    title: 'Welcome to Across the Room',
    body: [
      'Place the phone upright beside the TV, with its microphone facing the room. Sit where you normally sit, about 2.5 to 3 metres away. The phone stays there during practice.',
      'The TV shows a relative level compared with the quiet room in this session. It is not a calibrated sound level, and it does not measure whether words are understood.',
      PRIVACY_LINE,
    ],
    action: 'I understand',
  },
  home: {
    title: 'Across the Room',
    body: ['Practise from your seat. Use the TV remote for everything.'],
    start: 'Start session',
    history: 'History',
    settings: 'Settings',
    pair: 'Pair phone',
    noSessions: 'No sessions saved on this TV yet.',
    corrupt: 'Some saved data on this TV could not be read and is being ignored. You can delete it in Settings.',
    futureData:
      'Data from a newer version is stored on this TV. Nothing is saved until you delete it in Settings.',
  },
  pairing: {
    title: 'Pair the phone',
    body: [
      'Open the phone page and enter this code, or scan the QR code. The phone stays by the TV.',
      PRIVACY_LINE,
    ],
    waiting: 'Waiting for the phone',
    connecting: 'Connecting to the relay',
    waitingConnect: 'Phone accepted. Waiting for it to connect.',
    gettingCode: 'Getting a new code.',
    refresh: 'New code',
    retryConnect: 'Try again',
    cancel: 'Cancel',
    expired: 'This code has expired. Choose New code.',
    paired: 'Phone paired. Choose Start session when you are ready.',
  },
  join: {
    title: 'A phone wants to join',
    body: (label: string) => [
      'A phone wants to join. Pick the number shown on the phone.',
      `Name the phone gave: ${label}`,
    ],
    pickLabel: (digits: string) => digits,
    pickHint: 'Choose this number only if it is the number shown on the phone.',
    reject: 'Reject',
    expired: 'The join request expired.',
    mismatch: 'That number did not match. Pair again.',
  },
  permission: {
    title: 'Start the microphone on the phone',
    body: [
      'On the phone, tap Start microphone and allow access. The phone stays by the TV; you will not need to touch it during practice.',
    ],
    waitingPhone: 'Waiting for the phone.',
    cancel: 'Cancel',
  },
  quiet: {
    title: 'Quiet check',
    readyBody: [
      'Stay quiet for 5 seconds so the TV can learn the room. The TV makes no sound.',
      'Press OK when you are in your seat.',
    ],
    begin: 'Begin quiet check',
    running: 'Quiet please, 5 seconds',
    failedTitle: 'Quiet check did not pass',
    retry: 'Try again',
    cancel: 'Cancel',
  },
  calibration: {
    title: "Set today's band",
    readyBody: (sentence: string, canKeep: boolean) => [
      `From your seat, say: "${sentence}" in your normal practice voice. You will have 6 seconds.`,
      canKeep ? 'You can keep the band already set in this session.' : 'Press OK when you are ready.',
    ],
    begin: 'Begin',
    keep: "Keep today's band",
    keepDisabledHint: 'No band has been set in this session yet.',
    running: 'Say the sentence now',
    setTitle: "Today's band is set",
    setBody: (margin: string) => [
      `Margin: ${margin} dB above the room (relative, not a sound pressure level).`,
    ],
    failedTitle: "Today's band was not set",
    continue: 'Continue',
    continueNoBand: 'Continue without a band',
    continueNoBandHint: 'Phrases will not be scored. The listener check can still be used.',
    retry: 'Try again',
    cancel: 'Cancel',
  },
  vowel: {
    readyTitle: 'Sustained sound (optional)',
    readyBody: [
      'Say "ahh" in a comfortable voice for as long as is comfortable, up to 30 seconds. You can stop early at any time. Follow the plan your clinician gave you.',
      'The TV shows how long your voice was active. It is a voice-activity duration, not a recognised sound.',
    ],
    begin: 'Begin',
    skip: 'Skip this step',
    running: 'Say ahh',
    timerLabel: 'Voice-activity time',
    stop: 'Stop now',
    resultTitle: 'Sustained sound result',
    continue: 'Continue to phrases',
    rest: 'Rest, then try again',
    cancelled: 'Cancelled. This window was not scored.',
  },
  phrase: {
    ready: 'Press OK when you are ready to say the phrase from your seat.',
    blind: 'Blind check: the meter is hidden for this phrase',
    retryNote: 'Retry: the meter will be shown for this attempt.',
    begin: 'Begin',
    skip: 'Skip phrase',
    finish: 'Finish early',
    running: 'Say the phrase now',
    starting: "Starting the phone's measurement…",
    stop: 'Stop now',
    stopHint: 'Press OK to stop early. Back cancels this window.',
    cancelHint: 'Press Back to cancel this window.',
    cancel: 'Cancel window',
    precheck: 'Checking the room',
    lead: 'Get ready',
    next: 'Next phrase',
    seeSummary: 'See summary',
    tryAgain: 'Try again',
  },
  response: {
    title: 'How did that feel?',
    ratingBody: ['Choose how loud that phrase felt to you. You can skip the rating.'],
    feltLoud: 'Felt loud',
    feltNormal: 'Felt normal',
    skipRating: 'Skip rating',
    waitingListener: 'Waiting for the listener to answer on the phone.',
    waitingTitle: 'Waiting for the listener',
    offerTitle: 'No listener response yet',
    offerBody: 'Keep waiting, or continue without a listener response. A missing response is recorded as missing.',
    keepWaiting: 'Keep waiting',
    continueWithout: 'Continue without listener response',
  },
  reveal: {
    title: 'Result',
    youFelt: (rating: string) => `You felt: ${rating}`,
    listener: (value: string) => `Listener: ${value}`,
    listenerLate: (value: string) => `Listener (late, not counted): ${value}`,
    listenerHeard: 'heard',
    listenerNotHeard: 'not heard',
    listenerMissing: 'no response',
    ratingLoud: 'loud',
    ratingNormal: 'normal',
    ratingNone: 'not rated',
  },
  paused: {
    title: 'Paused',
    retry: 'Try again',
    retryHint: 'Available when the phone is connected and its microphone is open.',
    skipPhrase: 'Skip phrase',
    skipVowel: 'Skip this step',
    finish: 'Finish early',
    cancel: 'Cancel',
    linkLost: 'The link to the phone was lost, so the window was not scored. Start again when the phone is back.',
    blocked: "The room is noisier than when we set today's band. Wait for quiet, then try again.",
    mic: 'The phone microphone stopped, so the window was not scored.',
    interrupted: 'The window was interrupted, so it was not scored.',
    timeout: 'The phone did not answer in time, so the window was not scored.',
    noStart: 'The phone did not start measuring. Try again.',
    phoneReconnected: 'The phone reconnected, so the window was not scored.',
  },
  summary: {
    title: 'Session summary',
    titleIncomplete: 'Session summary (incomplete)',
    done: 'Done',
    history: 'View history',
  },
  history: {
    title: 'Last 7 days',
    body: [
      'Days without a session show No session. Days marked incomplete include a session that ended early, was interrupted, or was resumed; do not compare them with complete days.',
      'Counts only. There is no trend or comparison between days.',
    ],
    done: 'Done',
  },
  resume: {
    title: 'Resume the last session?',
    resume: 'Resume session',
    discard: 'Discard session',
    note: 'Resuming never invents results. You will pair the phone and start its microphone again.',
    interruptedNote: 'A window that was open when the app stopped is recorded as interrupted and not scored.',
  },
  settings: {
    title: 'Settings',
    positioning:
      'Positioning: place the phone upright beside the TV with its microphone facing the room, about 2.5 to 3 metres from your seat. Do not move it during practice.',
    measurement: 'Measurement: relative level compared with the room, this session only.',
    qualification: (state: string) => `Phone qualification: ${state}`,
    qualNotRun: 'not run (Not yet qualified on this phone)',
    qualPassed: 'passed',
    qualFailed: 'failed (Listener Edition is used and band results are hidden)',
    corrupt: 'Some saved data on this TV could not be read and is being ignored. You can delete it here.',
    familyOn: 'Family mode: on. A listener answers on the phone after each phrase.',
    familyOff: 'Family mode: off.',
    familyToggle: 'Family mode',
    familyLocked: 'Change family mode between sessions.',
    cueNone: 'Cue word: not set (set on the phone).',
    cue: (word: string) => `Cue word: ${word} (set on the phone).`,
    resetCalibration: "Reset today's band",
    resetHint: 'Clears the band for this session only. Needs a session with a band.',
    deleteData: 'Delete local practice data',
    deleteHint: 'Removes everything this app saved on the TV. Not available during a session.',
    unpair: 'Unpair phone',
    unpairHint: 'Revokes the phone. Not available during a session.',
    about: 'About',
    diagnostics: 'Diagnostics (developer)',
    back: 'Back',
  },
  about: {
    title: 'About',
    storage:
      'Practice data is stored unencrypted on this TV. Session summaries keep positions and counts only, never phrase text, cue words or phone names, for 8 days. Your phrase bank stays on this TV until you delete it in Settings.',
    relayLine:
      "This TV tells the relay and your phone which practice step you are on and the room's background level. It does not send your results, ratings or history.",
    abuseLine:
      "The relay keeps short-lived abuse-prevention counters (counts only) keyed by a keyed hash of the connection's network address. The key changes at least daily and the counters expire within an hour.",
    version: (v: string) => `Version ${v}`,
  },
  diagnostics: { title: 'Diagnostics' },
  dialog: {
    leave: {
      title: 'Leave this session?',
      body: 'The session will end and results so far are saved as an incomplete session.',
      confirm: 'Leave session',
      cancel: 'Stay',
    },
    delete: {
      title: 'Delete all practice data?',
      body: 'This removes every phrase, setting and session summary this app saved on the TV. It cannot be undone.',
      confirm: 'Delete data',
      cancel: 'Cancel',
    },
    reset: {
      title: "Reset today's band?",
      body: "The band for this session is cleared. You will set it again before phrases are scored.",
      confirm: 'Reset band',
      cancel: 'Cancel',
    },
    unpair: {
      title: 'Unpair the phone?',
      body: 'The phone will have to join again with a new code.',
      confirm: 'Unpair',
      cancel: 'Cancel',
    },
  },
  banner: {
    linkLost: 'Phone link lost. Reconnecting.',
    linkOffline: 'The relay is not reachable.',
    linkFailed: 'Could not reach the relay. Choose Try again.',
    micUnknown: 'Phone state unknown.',
    micNotOpen: 'The phone microphone is not open. Start it on the phone.',
    storageFailed: 'Could not save to this TV. Practice can continue; this result may not be kept.',
    recordNotSaved:
      'Could not save this session to the TV. It is kept so you can recover it the next time the app starts.',
    deleteFailed: 'Some saved data could not be removed. Try again or restart the app.',
    deleted: 'All local practice data was deleted.',
    future: 'Data from a newer version is stored on this TV.',
    phrasesSaved: 'New phrases saved. They apply to the next session.',
    cancelledWindow: 'Window cancelled. It was not scored.',
    pairingLost: 'The pairing with the relay was lost. Pair again.',
    waitingPhone: 'Waiting for the phone.',
    pairingCompromised: 'Pairing may be compromised. Pair again.',
    relayError: (code: string) => `The relay reported: ${code}.`,
    resetDone: "Today's band was cleared. Set it again to score phrases.",
    phoneReconnected: 'Phone reconnected.',
    nfcFailed: 'Text normalisation is unavailable on this TV. Typed phrases may not display as entered.',
    relayCleanupPending: 'Relay cleanup in progress.',
    relayCleanupConfirmed: 'Relay cleanup confirmed.',
    relayCleanupNotConfirmed: 'Relay cleanup not confirmed.',
  },
  mic: {
    waiting: 'Waiting for the microphone permission on the phone.',
    denied: 'Microphone permission was denied on the phone.',
    noInput: 'The phone reports no microphone input.',
    busy: 'The microphone is in use by another app on the phone.',
    unsupported: 'The phone could not apply the microphone settings this app needs.',
    error: 'The phone reported a microphone error.',
  },
  meter: { noLevel: 'No level reported' },
  cue: (text: string) => `Cue: ${text}`,
  measurement: {
    relative: 'Relative band',
    listener: 'Listener edition',
  },
};

/** "1 phrase" / "2 phrases": counts in copy never use the wrong number. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

/** Seconds as a word for spoken scripts: 3000 ms is "three seconds", 30000 ms is "thirty seconds". */
export function secondsWords(ms: number): string {
  const seconds = Math.round(ms / 1000);
  let word: string;
  if (seconds >= 0 && seconds < NUMBER_WORDS.length) word = NUMBER_WORDS[seconds] as string;
  else if (seconds === 30) word = 'thirty';
  else word = String(seconds);
  return seconds === 1 ? `${word} second` : `${word} seconds`;
}

/**
 * A8-02: the fixed script for screen-reader sessions. The measurement starts after the quiet lead, so the user
 * is told to wait exactly that long after the message ends, then speak.
 */
export function speakScript(leadMs: number, lasts: string): string {
  return `After this message, wait ${secondsWords(leadMs)}, then speak. Measurement lasts ${lasts}.`;
}
