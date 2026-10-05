/**
 * Projection from the machine state to TvView.
 *
 * Hard guarantees enforced here (and unit-tested):
 *  - For a hidden first attempt before reveal: view.meter === null and view.result === null, and no
 *    string depends on level or verdict. The blind branches below never read verdict fields.
 *  - While capturing, announcement === null.
 *  - Results always carry a text label; colour/tone alone never carries a result.
 *  - The footer is constant. The persistent relative-level label accompanies any meter, result or summary.
 *  - Credentials, room ids and pairing codes outside the pairing screen never appear in a view.
 */

import {
  CALIBRATION_PHRASE,
  CALIBRATION_WINDOW_MS,
  DEVICE_QUALIFICATION_STATUS,
  LEVEL_STALE_MS,
  LICENSES_NOTICE_PLACEHOLDER,
  PHRASE_WINDOW_MS,
  PRE_WINDOW_MS,
  QUIET_CHECK_MS,
  QUIET_LEAD_MS,
  QUIET_LEAD_SCREEN_READER_MS,
  VOWEL_MAX_MS,
} from './constants.js';
import type {
  ActionId,
  DialogView,
  HistoryDayView,
  MeterView,
  ResultView,
  ScreenId,
  SummaryView,
  TimerView,
  TvStage,
  TvView,
  ViewAction,
} from './contract.js';
import {
  CAL_COPY,
  COPY,
  FOOTER,
  LABEL_FIXTURE,
  LABEL_LISTENER_EDITION,
  LABEL_NO_BAND,
  LABEL_RELATIVE,
  LABEL_SAME_HOST,
  METER_CAPTION,
  RESULT_COPY,
  UNQUALIFIED_SUFFIX,
  plural,
  reasonText,
  secondsWords,
  speakScript,
} from './copy.js';
import type { Banner, Core, DialogKind, Env, Win } from './model.js';
import { safeLocalDate } from './dates.js';
import { deriveHistory, deriveSummary, summarizeRecord } from './records.js';
import type { AttemptRecord, VowelRecord } from './records.js';
import {
  attemptsAt,
  currentAttempt,
  isBlindNow,
  isHiddenPosition,
  isListenerEdition,
  linkView,
  measureReady,
  micOpen,
  micView,
  quietLeadMs,
} from './selectors.js';
import { phoneJoinUrl } from './urls.js';
import { bandEdgeRelDb, maxTolerableRiseDb } from './verdict.js';

const act = (id: ActionId, label: string, extra: Partial<ViewAction> = {}): ViewAction => ({ id, label, ...extra });

const BEGIN_HINT = 'The window starts after a short pause so the room can be quiet.';

/** Builds the full view. Pure: reads only `s` and `env`. */
export function buildView(s: Core, env: Env): TvView {
  const v: TvView = {
    screen: 'home',
    stage: s.stage,
    title: '',
    body: [],
    announcement: null,
    capturing: s.win !== null,
    actions: [],
    preferredAction: null,
    pairing: null,
    mic: micView(s),
    link: linkView(s),
    meter: null,
    timer: null,
    phrase: null,
    result: null,
    cue: s.cue && s.now < s.cue.expiresAt ? { text: s.cue.text, expiresAt: s.cue.expiresAt } : null,
    summary: null,
    history: null,
    dialog: null,
    banner: null,
    labels: [],
    footer: FOOTER,
    diagnostics: null,
  };

  let announcement: string | null = null;
  let banner: Banner | null = s.banner;

  if (!s.booted) {
    v.screen = 'home';
    v.title = COPY.starting.title;
    v.body = [...COPY.starting.body];
    announcement = v.title;
  } else if (s.dialog !== null) {
    announcement = projectDialog(v, s.dialog);
  } else if (s.overlay !== null && !isBlindNow(s)) {
    announcement = projectOverlay(v, s, env);
  } else {
    announcement = projectStage(v, s, env);
  }

  // Derived banners never hide an explicit one.
  if (banner === null) banner = derivedBanner(s, v);
  v.banner = banner;

  // Meter / result / summary are mutually consistent with the blind rule: enforce one last time.
  const blind = isBlindNow(s);
  if (blind) {
    v.meter = null;
    v.result = null;
    v.summary = null;
  }

  v.labels = labelsFor(s, v, env);
  if (v.capturing) {
    // A8-01: nothing is announced while a precheck or capture is open.
    v.announcement = null;
  } else if (blind) {
    // A hidden attempt waiting for its reveal: the static stage text only. Cue and banner text is queued.
    v.announcement = announcement;
  } else {
    // QA-12: the screen's own text is never replaced. A cue (and any held banner text) is appended, so the screen is
    // announced first and the cue gets its turn after it; each queued text appears once and stays for this stage.
    const queued = s.deferred.texts;
    v.announcement = queued.length > 0 ? `${announcement ?? ''} ${queued.join(' ')}`.trim() : announcement;
  }
  // After a dialog closes, focus returns to the control that opened it.
  if (s.dialog === null && s.restoreFocus !== null && v.actions.some((a) => a.id === s.restoreFocus && a.disabled !== true)) {
    v.preferredAction = s.restoreFocus;
  }
  // The preferred action must exist and be enabled.
  if (v.preferredAction !== null) {
    const preferred = v.actions.find((a) => a.id === v.preferredAction);
    if (!preferred || preferred.disabled === true) v.preferredAction = null;
  }
  return v;
}

/* ------------------------------------------------------------------ labels and banners */

function labelsFor(s: Core, v: TvView, env: Env): string[] {
  const labels: string[] = [];
  if (env.fixtureMode) labels.push(LABEL_FIXTURE);
  if (s.mic.mode === 'fixture_replay' && !env.fixtureMode && v.mic !== 'not_paired') labels.push(LABEL_FIXTURE);
  if (s.mic.mode === 'same_host' && v.mic !== 'not_paired') labels.push(LABEL_SAME_HOST);
  if (v.meter !== null || v.result !== null || v.summary !== null) labels.push(LABEL_RELATIVE);
  const session = s.session;
  if (session && isListenerEdition(s)) labels.push(LABEL_LISTENER_EDITION);
  if (
    session &&
    !isListenerEdition(s) &&
    session.noBand &&
    session.calMarginDb === null &&
    (s.stage === 'vowel_ready' ||
      s.stage === 'vowel_active' ||
      s.stage === 'vowel_result' ||
      s.stage === 'phrase_ready' ||
      s.stage === 'phrase_active' ||
      s.stage === 'response_pending' ||
      s.stage === 'reveal' ||
      s.stage === 'summary')
  ) {
    labels.push(LABEL_NO_BAND);
  }
  return labels;
}

function derivedBanner(s: Core, v: TvView): Banner | null {
  const flow = derivedFlowBanner(s, v);
  if (flow !== null) return flow;
  // PK-12: if String.prototype.normalize is missing, typed text is not normalised; say so everywhere.
  if (!s.nfcOk && s.overlay === null && s.dialog === null) return { kind: 'warning', text: COPY.banner.nfcFailed };
  return null;
}

function derivedFlowBanner(s: Core, v: TvView): Banner | null {
  const inFlow = s.session !== null || s.stage === 'pairing';
  if (!inFlow || s.overlay !== null || s.dialog !== null) return null;
  if (s.stage === 'summary' || s.stage === 'history' || s.stage === 'resume_or_discard') return null;
  if (s.link === 'failed') return { kind: 'error', text: COPY.banner.linkFailed };
  if (s.link === 'reconnecting') return { kind: 'warning', text: COPY.banner.linkLost };
  if (s.link === 'offline' && s.roomId !== null) return { kind: 'warning', text: COPY.banner.linkOffline };
  if (s.session && s.stage !== 'pairing' && s.stage !== 'permission_pending') {
    if (v.mic === 'unknown') return { kind: 'warning', text: COPY.banner.micUnknown };
    if (!micOpen(s) && s.win === null) return { kind: 'warning', text: COPY.banner.micNotOpen };
    if (micOpen(s) && !s.session.beginAcked && s.win === null) return { kind: 'info', text: COPY.banner.waitingPhone };
  }
  return null;
}

/* ------------------------------------------------------------------ dialog and overlays */

function projectDialog(v: TvView, kind: DialogKind): string {
  const c = COPY.dialog[kind];
  const confirm = act('confirm_destructive', c.confirm, { destructive: true });
  const cancel = act('cancel_destructive', c.cancel);
  const dialog: DialogView = { title: c.title, body: c.body, confirm, cancel, preferred: 'cancel' };
  v.screen = 'confirm_dialog';
  v.title = c.title;
  v.body = [c.body];
  v.dialog = dialog;
  v.actions = [cancel, confirm];
  v.preferredAction = 'cancel_destructive';
  return `${c.title} ${c.body}`;
}

function projectOverlay(v: TvView, s: Core, env: Env): string {
  if (s.overlay === 'about') {
    v.screen = 'about';
    v.title = COPY.about.title;
    v.body = [
      COPY.about.version(env.appVersion),
      COPY.about.storage,
      COPY.about.relayLine,
      COPY.about.abuseLine,
      `Phone microphone: ${DEVICE_QUALIFICATION_STATUS}.`,
      LICENSES_NOTICE_PLACEHOLDER,
    ];
    v.actions = [act('back', COPY.settings.back)];
    v.preferredAction = 'back';
    return v.title;
  }
  if (s.overlay === 'diagnostics') {
    v.screen = 'diagnostics';
    v.title = COPY.diagnostics.title;
    v.diagnostics = diagnosticsOf(s, env);
    v.actions = [act('back', COPY.settings.back)];
    v.preferredAction = 'back';
    return v.title;
  }
  // settings
  v.screen = 'settings';
  v.title = COPY.settings.title;
  const inSession = s.session !== null;
  v.body = [
    COPY.settings.positioning,
    COPY.settings.measurement,
    COPY.settings.qualification(
      s.settings.qualification === 'passed'
        ? COPY.settings.qualPassed
        : s.settings.qualification === 'failed'
          ? COPY.settings.qualFailed
          : COPY.settings.qualNotRun,
    ),
    s.settings.familyMode ? COPY.settings.familyOn : COPY.settings.familyOff,
    s.settings.cueWord === null ? COPY.settings.cueNone : COPY.settings.cue(s.settings.cueWord),
  ];
  if (s.corruptKeys > 0) v.body.push(COPY.settings.corrupt);
  const canReset =
    inSession &&
    s.session !== null &&
    s.session.calMarginDb !== null &&
    s.session.floorDbfs !== null &&
    (s.stage === 'vowel_ready' || s.stage === 'phrase_ready' || (s.stage === 'calibration' && s.sub === 'ready'));
  const canUnpair = !inSession && (s.phonePaired || s.peerConnected) && s.authed;
  v.actions = [
    act('toggle_family_mode', COPY.settings.familyToggle, {
      hint: inSession ? COPY.settings.familyLocked : undefined,
      disabled: inSession,
    }),
    act('reset_calibration', COPY.settings.resetCalibration, { hint: COPY.settings.resetHint, disabled: !canReset }),
    act('delete_local_data', COPY.settings.deleteData, {
      hint: COPY.settings.deleteHint,
      destructive: true,
      disabled: inSession || s.deleting,
    }),
    act('unpair_phone', COPY.settings.unpair, { hint: COPY.settings.unpairHint, disabled: !canUnpair }),
    act('open_about', COPY.settings.about),
    act('open_diagnostics', COPY.settings.diagnostics),
    act('back', COPY.settings.back),
  ];
  v.preferredAction = null;
  return v.title;
}

function diagnosticsOf(s: Core, env: Env): Record<string, string> {
  const c = s.counters;
  const sess = s.session;
  const margin = sess?.calMarginDb ?? null;
  const tolerance = margin !== null ? maxTolerableRiseDb(margin) : null;
  const lead = quietLeadMs(s);
  const d: Record<string, string> = {
    link: linkView(s),
    authenticated: s.authed ? 'yes' : 'no',
    generation: String(s.generation),
    phone_connected: s.peerConnected ? 'yes' : 'no',
    mic_state: s.mic.state ?? 'unknown',
    // A4-03: the practice step is redacted while an unrevealed attempt exists (cannot be reached from the UI;
    // enforced here as well).
    stage: isBlindNow(s) ? 'redacted' : s.stage,
    platform: env.platform,
    app_version: env.appVersion,
    fixture_mode: env.fixtureMode ? 'yes' : 'no',
    storage_blocked_by_newer_version: s.future ? 'yes' : 'no',
    unreadable_stored_values: String(s.corruptKeys),
    // A1-08: what the gate will tolerate today (relative dB, this session only).
    calibration_margin_db: margin === null ? 'not set' : margin.toFixed(1),
    max_tolerated_floor_rise_db:
      tolerance === null
        ? 'not set'
        : tolerance.inclusive
          ? `${tolerance.limitDb.toFixed(1)} or less`
          : `less than ${tolerance.limitDb.toFixed(1)}`,
    // A8-02: the quiet lead in use and whether the screen reader raised it.
    screen_reader: s.screenReader ? 'on' : 'off',
    quiet_lead_ms: String(lead),
    quiet_lead_default_ms: String(QUIET_LEAD_MS),
    quiet_lead_screen_reader_ms: String(s.settings.quietLeadScreenReaderMs ?? QUIET_LEAD_SCREEN_READER_MS),
    // PK-12
    nfc_self_test: s.nfcOk ? 'pass' : 'FAIL',
    phone_qualification: s.settings.qualification,
    messages_sent: String(c.sent ?? 0),
    messages_received: String(c.received ?? 0),
    messages_ignored_stale: String(c.ignored_stale ?? 0),
    messages_rejected: String(c.rejected ?? 0),
    messages_unparseable: String(c.parse_errors ?? 0),
    heartbeats_sent: String(c.pings_sent ?? 0),
    heartbeats_answered: String(c.pongs ?? 0),
    duplicates_dropped: String(c.duplicates ?? 0),
    integrity_errors: String(c.integrity_errors ?? 0),
    clock_date_invalid: String(c.clock_date_invalid ?? 0),
    session_begin_resends: String(c.begin_resends ?? 0),
    join_mismatches: String(c.join_mismatches ?? 0),
    inputs_ignored: String(c.inputs_ignored ?? 0),
    cues_used: isBlindNow(s) ? 'redacted' : String(sess?.cuesUsed ?? 0),
    delete_remaining_keys: String(s.deleteRemaining),
    relay_cleanup: s.relayCleanup,
  };
  return d;
}

/* ------------------------------------------------------------------ stages */

function projectStage(v: TvView, s: Core, env: Env): string {
  switch (s.stage) {
    case 'idle':
      return projectIdle(v, s, env);
    case 'pairing':
      return projectPairing(v, s, env);
    case 'permission_pending':
      return projectPermission(v, s);
    case 'quiet_check':
      return projectQuiet(v, s);
    case 'calibration':
      return projectCalibration(v, s);
    case 'vowel_ready':
    case 'vowel_active':
    case 'vowel_result':
      return projectVowel(v, s);
    case 'phrase_ready':
    case 'phrase_active':
    case 'response_pending':
    case 'reveal':
      return projectPhrase(v, s);
    case 'summary':
      return projectSummary(v, s);
    case 'history':
      return projectHistory(v, s, env);
    case 'paused_or_invalid':
      return projectPaused(v, s);
    case 'resume_or_discard':
      return projectResume(v, s);
  }
}

function projectIdle(v: TvView, s: Core, env: Env): string {
  if (s.idleScreen === 'onboarding') {
    v.screen = 'onboarding';
    v.title = COPY.onboarding.title;
    v.body = [...COPY.onboarding.body];
    v.actions = [act('continue', COPY.onboarding.action)];
    v.preferredAction = 'continue';
    return `${v.title}. ${COPY.onboarding.body[0] ?? ''}`;
  }
  v.screen = 'home';
  v.title = COPY.home.title;
  // A record dated after today (a clock that was wrong) is never shown as the last session.
  const today = safeLocalDate(env.localDate, s.now);
  const shown = s.records.filter((r) => r.localDate <= today);
  const last = shown.length > 0 ? shown[shown.length - 1] : undefined;
  let lastLine: string = COPY.home.noSessions;
  if (last) {
    const sum = summarizeRecord(last);
    const reached = sum.reachedVisible + sum.reachedHidden;
    const scored = sum.scoredVisible + sum.scoredHidden;
    lastLine =
      scored === 0
        ? `Last session, ${last.localDate}: ${plural(sum.phrasesCompleted, 'phrase')} completed${last.complete ? '' : ' (incomplete)'}.`
        : `Last session, ${last.localDate}: reached ${reached} of ${scored} scored${last.complete ? '' : ' (incomplete)'}.`;
  }
  v.body = [...COPY.home.body, lastLine];
  if (s.future) v.body.push(COPY.home.futureData);
  if (s.corruptKeys > 0) v.body.push(COPY.home.corrupt);
  v.actions = [
    act('start_session', COPY.home.start),
    act('open_history', COPY.home.history),
    act('open_settings', COPY.home.settings),
    act('pair_phone', COPY.home.pair),
  ];
  v.preferredAction = 'start_session';
  void env;
  return `${v.title}. ${COPY.home.body[0] ?? ''}`;
}

function projectPairing(v: TvView, s: Core, env: Env): string {
  const code = s.code;
  const qr = code !== null ? phoneJoinUrl(env.relayUrl, code) : null;
  v.pairing = {
    code,
    codeExpiresAt: s.codeExpiresAt,
    qrPayload: qr,
    joinRequest: s.joinRequest
      ? { deviceLabel: s.joinRequest.deviceLabel, choices: [...s.joinRequest.choices] as [string, string, string] }
      : null,
  };
  if (s.joinRequest !== null) {
    // A3-06 number matching: three choices, Reject preferred. The view never says which choice is right.
    v.screen = 'join_confirm';
    v.title = COPY.join.title;
    v.body = COPY.join.body(s.joinRequest.deviceLabel);
    const pickIds = ['pick_choice_1', 'pick_choice_2', 'pick_choice_3'] as const;
    v.actions = [
      ...s.joinRequest.choices.map((digits, i) =>
        act(pickIds[i] as ActionId, COPY.join.pickLabel(digits), { hint: COPY.join.pickHint }),
      ),
      act('reject_join', COPY.join.reject),
    ];
    v.preferredAction = 'reject_join';
    return `${v.title}. ${v.body.join(' ')}`;
  }
  v.screen = 'pairing';
  v.title = COPY.pairing.title;
  let status: string = COPY.pairing.waiting;
  if (s.joinAccepted) status = COPY.pairing.waitingConnect;
  else if (s.link === 'failed' || s.roomId === null) status = s.link === 'failed' ? COPY.banner.linkFailed : COPY.pairing.connecting;
  else if (s.code === null) status = COPY.pairing.gettingCode;
  v.body = [...COPY.pairing.body, status];
  const expired = s.codeExpiresAt !== null && s.now >= s.codeExpiresAt;
  v.actions = [
    act('refresh_code', s.link === 'failed' ? COPY.pairing.retryConnect : COPY.pairing.refresh, {
      disabled: s.link === 'connecting' || s.joinAccepted,
    }),
    act('cancel', COPY.pairing.cancel),
  ];
  v.preferredAction = 'cancel';
  if (expired) v.body.push(COPY.pairing.expired);
  return `${v.title}. ${status}`;
}

function micStatusLine(v: TvView): string | null {
  switch (v.mic) {
    case 'waiting_for_permission':
      return COPY.mic.waiting;
    case 'permission_denied':
      return COPY.mic.denied;
    case 'no_input':
      return COPY.mic.noInput;
    case 'input_busy':
      return COPY.mic.busy;
    case 'constraints_unsupported':
      return COPY.mic.unsupported;
    case 'error':
      return COPY.mic.error;
    default:
      return null;
  }
}

function projectPermission(v: TvView, s: Core): string {
  v.screen = 'permission_pending';
  v.title = COPY.permission.title;
  v.body = [...COPY.permission.body];
  const line = micStatusLine(v);
  if (line !== null) v.body.push(line);
  // DEF-003: the phone has not acked this session yet, so nothing can be measured.
  if (s.session && s.session.beginSent && !s.session.beginAcked) v.body.push(COPY.permission.waitingPhone);
  v.actions = [act('cancel', COPY.permission.cancel)];
  v.preferredAction = null;
  return `${v.title}. ${COPY.permission.body[0] ?? ''}`;
}

/* ---- windows: timer and meter ---- */

function clampElapsed(elapsed: number, max: number): number {
  return Math.max(0, Math.min(elapsed, max));
}

/**
 * The one line that says what is happening in a window. The speaker's prompt ("Say ... now") appears only once the
 * phone has started measuring (DEF-007): before that the TV is waiting, getting the room checked, or getting ready.
 */
function windowLine(w: Win, running: string): string {
  if (w.phase === 'lead') return COPY.phrase.lead;
  if (w.phase === 'precheck') return COPY.phrase.precheck;
  if (w.phase === 'starting') return COPY.phrase.starting;
  return running;
}

function timerFor(s: Core, w: Win, captureLabel: string): TimerView | null {
  const now = s.now;
  if (w.phase === 'lead') {
    return { elapsedMs: clampElapsed(now - (w.leadUntil - w.leadMs), w.leadMs), maxMs: w.leadMs, label: COPY.phrase.lead };
  }
  if (w.phase === 'precheck') {
    const max = w.kind === 'quiet_check' ? QUIET_CHECK_MS : PRE_WINDOW_MS;
    return {
      elapsedMs: clampElapsed(now - (w.precheckAt ?? now), max),
      maxMs: max,
      label: w.kind === 'quiet_check' ? COPY.quiet.running : COPY.phrase.precheck,
    };
  }
  // DEF-007: no timer until the phone's first level frame has arrived.
  if (w.phase === 'starting' || w.captureAt === null) return null;
  return {
    elapsedMs: clampElapsed(now - w.captureAt, w.maxMs),
    maxMs: w.maxMs,
    label: captureLabel,
  };
}

/** Meter only in the capture phase of a window that is not a hidden first attempt. */
function meterFor(s: Core, w: Win): MeterView | null {
  if (w.hidden) return null;
  if (w.phase !== 'capture' && w.phase !== 'closing') return null;
  const lvl = s.level;
  const fresh = lvl !== null && s.now - lvl.at <= LEVEL_STALE_MS;
  return {
    levelRelDb: fresh && lvl ? Math.round(lvl.relDb * 10) / 10 : null,
    bandRelDb: isListenerEdition(s) ? null : bandEdgeRelDb(s.session?.calMarginDb ?? null),
    active: fresh && lvl ? lvl.active : false,
    caption: fresh ? METER_CAPTION : COPY.meter.noLevel,
  };
}

/**
 * Controls during a window. Before the capture phase (quiet lead, precheck) and after Stop there are no
 * focusable controls: a repeated OK cannot activate Cancel, and Back always cancels. In the capture phase of a
 * vowel or phrase, Stop (OK) is preferred and Cancel stays labelled and focusable.
 */
function captureActions(w: Win, stopLabel: string, cancelLabel: string): { actions: ViewAction[]; preferred: ActionId | null } {
  if (w.phase !== 'capture') return { actions: [], preferred: null };
  return {
    actions: [act('stop_early', stopLabel, { hint: COPY.phrase.stopHint }), act('cancel', cancelLabel)],
    preferred: 'stop_early',
  };
}

/* ---- quiet check ---- */

function projectQuiet(v: TvView, s: Core): string {
  v.screen = 'quiet_check';
  v.title = COPY.quiet.title;
  const open = measureReady(s);
  if (s.win !== null) {
    v.body = [s.win.phase === 'lead' ? COPY.phrase.lead : COPY.quiet.running, COPY.phrase.cancelHint];
    v.timer = timerFor(s, s.win, COPY.quiet.running);
    v.actions = [];
    return v.title;
  }
  if (s.sub === 'failed') {
    v.title = COPY.quiet.failedTitle;
    v.body = [reasonText(s.session?.quietFailure ?? null)];
    v.actions = [act('retry', COPY.quiet.retry, { disabled: !open }), act('cancel', COPY.quiet.cancel)];
    v.preferredAction = 'retry';
    return `${v.title}. ${v.body[0] ?? ''}`;
  }
  v.body = [...COPY.quiet.readyBody];
  if (s.screenReader) v.body.push(`After this message, stay quiet for the whole check. Measurement lasts ${secondsWords(QUIET_CHECK_MS)}.`);
  v.actions = [
    act('begin_quiet_check', COPY.quiet.begin, { hint: BEGIN_HINT, disabled: !open }),
    act('cancel', COPY.quiet.cancel),
  ];
  v.preferredAction = 'begin_quiet_check';
  return `${v.title}. ${v.body.join(' ')}`;
}

/* ---- calibration ---- */

function projectCalibration(v: TvView, s: Core): string {
  v.screen = 'calibration';
  v.title = COPY.calibration.title;
  const session = s.session;
  const open = measureReady(s);
  const hasBand = session !== null && session.calMarginDb !== null;
  if (s.win !== null) {
    v.body = [windowLine(s.win, COPY.calibration.running), COPY.phrase.cancelHint];
    v.timer = timerFor(s, s.win, COPY.calibration.running);
    v.meter = meterFor(s, s.win);
    v.actions = [];
    return v.title;
  }
  if (s.sub === 'result' && session?.lastCalibration) {
    const cal = session.lastCalibration;
    if (cal.accepted && cal.marginDb !== null) {
      v.title = COPY.calibration.setTitle;
      v.body = COPY.calibration.setBody(cal.marginDb.toFixed(1));
      v.result = { label: COPY.calibration.setTitle, tone: 'neutral', detail: v.body[0] ?? null, borderline: false, listener: null, speakerRating: null };
      v.actions = [act('continue', COPY.calibration.continue), act('retry', COPY.calibration.retry, { disabled: !open })];
      v.preferredAction = 'continue';
    } else {
      v.title = COPY.calibration.failedTitle;
      const text = cal.reason === 'too_quiet' ? CAL_COPY.tooQuiet : reasonText(cal.reason);
      v.body = [text];
      v.result = { label: COPY.calibration.failedTitle, tone: 'not_scored', detail: text, borderline: false, listener: null, speakerRating: null };
      v.actions = [
        act('retry', COPY.calibration.retry, { disabled: !open }),
        act('continue', hasBand ? COPY.calibration.keep : COPY.calibration.continueNoBand, {
          hint: hasBand ? undefined : COPY.calibration.continueNoBandHint,
        }),
        act('cancel', COPY.calibration.cancel),
      ];
      v.preferredAction = 'retry';
    }
    return `${v.title}. ${v.body.join(' ')}`;
  }
  v.body = COPY.calibration.readyBody(CALIBRATION_PHRASE, hasBand);
  if (s.screenReader) v.body.push(speakScript(quietLeadMs(s), secondsWords(CALIBRATION_WINDOW_MS)));
  v.actions = [
    act('begin_calibration', COPY.calibration.begin, { hint: BEGIN_HINT, disabled: !open }),
    act('skip_calibration', COPY.calibration.keep, {
      hint: hasBand ? undefined : COPY.calibration.keepDisabledHint,
      disabled: !hasBand,
    }),
    act('cancel', COPY.calibration.cancel),
  ];
  v.preferredAction = 'begin_calibration';
  return `${v.title}. ${v.body.join(' ')}`;
}

/* ---- vowel ---- */

function qualified(s: Core): string {
  // A9-02: until the phone is qualified, a band verdict says so.
  return s.settings.qualification === 'passed' ? '' : UNQUALIFIED_SUFFIX;
}

function vowelResult(s: Core, rec: VowelRecord, hasBand: boolean): ResultView {
  const dur = rec.longestActiveMs !== null ? `${(rec.longestActiveMs / 1000).toFixed(1)} s` : null;
  if (!rec.valid) {
    return {
      label: RESULT_COPY.notScored,
      tone: 'not_scored',
      detail: reasonText(rec.reason),
      borderline: false,
      listener: null,
      speakerRating: null,
    };
  }
  const durationLine = dur !== null ? `Voice-activity duration: ${dur}` : null;
  if (hasBand && !isListenerEdition(s) && (rec.verdict === 'reached' || rec.verdict === 'not_reached')) {
    return {
      label: (rec.verdict === 'reached' ? RESULT_COPY.reached : RESULT_COPY.below) + qualified(s),
      tone: rec.verdict === 'reached' ? 'reached' : 'below',
      detail: durationLine,
      borderline: rec.borderline,
      listener: null,
      speakerRating: null,
    };
  }
  return {
    label: durationLine ?? 'Voice-activity duration',
    tone: 'neutral',
    detail: isListenerEdition(s) ? null : hasBand ? null : RESULT_COPY.noBand,
    borderline: false,
    listener: null,
    speakerRating: null,
  };
}

function projectVowel(v: TvView, s: Core): string {
  v.screen = 'vowel';
  const session = s.session;
  const hasBand = session !== null && session.calMarginDb !== null;
  if (s.stage === 'vowel_active' && s.win !== null) {
    v.title = s.win.phase === 'capture' || s.win.phase === 'closing' ? COPY.vowel.running : COPY.vowel.readyTitle;
    v.body = [windowLine(s.win, COPY.vowel.running), COPY.phrase.cancelHint];
    v.timer = timerFor(s, s.win, COPY.vowel.timerLabel);
    v.meter = meterFor(s, s.win);
    const c = captureActions(s.win, COPY.vowel.stop, COPY.phrase.cancel);
    v.actions = c.actions;
    v.preferredAction = c.preferred;
    return v.title;
  }
  if (s.stage === 'vowel_result' && session?.lastVowel) {
    v.title = COPY.vowel.resultTitle;
    v.result = vowelResult(s, session.lastVowel, hasBand);
    v.body = [v.result.label];
    if (v.result.detail !== null) v.body.push(v.result.detail);
    v.actions = [act('continue', COPY.vowel.continue), act('rest', COPY.vowel.rest)];
    v.preferredAction = 'continue';
    return `${v.title}. ${v.body.join('. ')}`;
  }
  v.title = COPY.vowel.readyTitle;
  v.body = [...COPY.vowel.readyBody];
  if (s.screenReader) v.body.push(speakScript(quietLeadMs(s), `up to ${secondsWords(VOWEL_MAX_MS)}`));
  v.actions = [
    act('begin_vowel', COPY.vowel.begin, { hint: BEGIN_HINT, disabled: !measureReady(s) }),
    act('skip_vowel', COPY.vowel.skip),
    act('open_settings', COPY.home.settings),
  ];
  v.preferredAction = 'begin_vowel';
  return `${v.title}. ${v.body.join(' ')}`;
}

/* ---- phrases ---- */

function phraseInfo(s: Core, attempt: AttemptRecord | null): TvView['phrase'] {
  const session = s.session;
  if (!session) return null;
  const position = attempt ? attempt.position : session.phraseIdx + 1;
  const text = session.phrases[position - 1] ?? '';
  const attemptNumber = attempt ? attempt.attemptNumber : attemptsAt(session, position).length + 1;
  return { position, total: session.phrases.length, text, attemptNumber };
}

function listenerText(a: AttemptRecord): string | null {
  if (a.state !== 'revealed') return null;
  let text: string | null = null;
  if (a.listener === 'heard') text = COPY.reveal.listener(COPY.reveal.listenerHeard);
  else if (a.listener === 'not_heard') text = COPY.reveal.listener(COPY.reveal.listenerNotHeard);
  else if (a.listener === 'missing') text = COPY.reveal.listener(COPY.reveal.listenerMissing);
  if (a.lateListener !== null) {
    text = COPY.reveal.listenerLate(a.lateListener === 'heard' ? COPY.reveal.listenerHeard : COPY.reveal.listenerNotHeard);
  }
  return text;
}

function resultForAttempt(s: Core, a: AttemptRecord, familyMode: boolean): ResultView {
  let label: string;
  let tone: ResultView['tone'];
  let detail: string | null = null;
  const listener = familyMode ? listenerText(a) : null;
  if (a.reason === 'listener_edition') {
    // Listener Edition: the listener's answer is the primary outcome; band verdicts are not shown (A9-02).
    label = listener ?? RESULT_COPY.listenerPending;
    tone = 'neutral';
  } else if (a.verdict === 'reached') {
    label = RESULT_COPY.reached + qualified(s);
    tone = 'reached';
  } else if (a.verdict === 'not_reached') {
    label = RESULT_COPY.below + qualified(s);
    tone = 'below';
  } else if (a.reason === 'no_band') {
    label = RESULT_COPY.noBand;
    tone = 'not_scored';
  } else {
    label = RESULT_COPY.notScored;
    tone = 'not_scored';
    detail = reasonText(a.reason);
  }
  const borderline = a.borderline && (a.verdict === 'reached' || a.verdict === 'not_reached');
  if (borderline) detail = RESULT_COPY.borderline;
  let speakerRating: string | null = null;
  if (a.hidden && a.state === 'revealed' && a.rating !== null) {
    speakerRating = COPY.reveal.youFelt(
      a.rating === 'felt_loud'
        ? COPY.reveal.ratingLoud
        : a.rating === 'felt_normal'
          ? COPY.reveal.ratingNormal
          : COPY.reveal.ratingNone,
    );
  }
  return { label, tone, detail, borderline, listener: a.reason === 'listener_edition' ? null : listener, speakerRating };
}

function projectPhrase(v: TvView, s: Core): string {
  const session = s.session;
  v.screen = s.stage === 'phrase_ready' || s.stage === 'phrase_active' ? 'phrase' : s.stage === 'response_pending' ? 'response' : 'reveal';
  if (!session) return '';
  const attempt = currentAttempt(session);
  const total = session.phrases.length;

  if (s.stage === 'phrase_ready') {
    const pos = session.phraseIdx + 1;
    v.phrase = phraseInfo(s, null);
    v.title = `Phrase ${pos} of ${total}`;
    const priorStarted = attemptsAt(session, pos).some((a) => a.started);
    const blindNext = isHiddenPosition(pos) && !priorStarted;
    v.body = [COPY.phrase.ready];
    if (s.screenReader) v.body.push(speakScript(quietLeadMs(s), secondsWords(PHRASE_WINDOW_MS)));
    if (blindNext) v.body.push(COPY.phrase.blind);
    else if (priorStarted) v.body.push(COPY.phrase.retryNote);
    v.actions = [
      act('begin_phrase', COPY.phrase.begin, { hint: BEGIN_HINT, disabled: !measureReady(s) }),
      act('skip_phrase', COPY.phrase.skip),
      act('finish_early', COPY.phrase.finish),
      act('open_settings', COPY.home.settings),
    ];
    v.preferredAction = 'begin_phrase';
    return `${v.title}. ${v.phrase?.text ?? ''}. ${v.body.join(' ')}`;
  }

  if (s.stage === 'phrase_active' && s.win !== null) {
    const w = s.win;
    v.phrase = {
      position: w.position ?? session.phraseIdx + 1,
      total,
      text: session.phrases[(w.position ?? 1) - 1] ?? '',
      attemptNumber: w.attemptNumber,
    };
    v.title = `Phrase ${v.phrase.position} of ${total}`;
    const line = windowLine(w, COPY.phrase.running);
    v.body = [line, COPY.phrase.cancelHint];
    if (w.hidden) v.body.push(COPY.phrase.blind);
    v.timer = timerFor(s, w, COPY.vowel.timerLabel);
    // Blind windows never get a meter; meterFor enforces it from the window flag, not from level data.
    v.meter = meterFor(s, w);
    const c = captureActions(w, COPY.phrase.stop, COPY.phrase.cancel);
    v.actions = c.actions;
    v.preferredAction = c.preferred;
    return v.title;
  }

  if (!attempt) return '';
  v.phrase = phraseInfo(s, attempt);
  v.title = `Phrase ${attempt.position} of ${total}`;

  if (s.stage === 'response_pending') {
    // Static strings only: nothing here reads attempt.verdict, borderline or any level data.
    const needRating = attempt.hidden && attempt.rating === null;
    const waitingListener = session.familyMode && attempt.listener === null;
    const lines: string[] = [];
    if (needRating) lines.push(...COPY.response.ratingBody);
    if (waitingListener) lines.push(session.listenerOffered ? COPY.response.offerBody : COPY.response.waitingListener);
    v.body = lines;
    const actions: ViewAction[] = [];
    if (needRating) {
      actions.push(act('rate_felt_loud', COPY.response.feltLoud));
      actions.push(act('rate_felt_normal', COPY.response.feltNormal));
      actions.push(act('rate_skip', COPY.response.skipRating));
    }
    if (waitingListener && session.listenerOffered) {
      actions.push(act('keep_waiting', COPY.response.keepWaiting));
      actions.push(act('continue_without_listener', COPY.response.continueWithout));
      v.preferredAction = 'keep_waiting';
    }
    v.actions = actions;
    v.title = needRating ? COPY.response.title : session.listenerOffered ? COPY.response.offerTitle : COPY.response.waitingTitle;
    return `${v.title}. ${lines.join(' ')}`;
  }

  // reveal
  v.title = COPY.reveal.title;
  const result = resultForAttempt(s, attempt, session.familyMode);
  v.result = result;
  const body: string[] = [result.label];
  if (result.detail !== null) body.push(result.detail);
  if (result.speakerRating !== null) body.push(result.speakerRating);
  if (result.listener !== null) body.push(result.listener);
  v.body = body;
  const scored =
    attempt.verdict === 'reached' ||
    attempt.verdict === 'not_reached' ||
    attempt.reason === 'no_band' ||
    attempt.reason === 'listener_edition';
  const last = session.phraseIdx + 1 >= total;
  if (scored) {
    v.actions = [
      act('next_phrase', last ? COPY.phrase.seeSummary : COPY.phrase.next),
      act('try_again', COPY.phrase.tryAgain),
      act('finish_early', COPY.phrase.finish),
    ];
    v.preferredAction = 'next_phrase';
  } else {
    v.actions = [
      act('try_again', COPY.phrase.tryAgain),
      act('skip_phrase', COPY.phrase.skip),
      act('finish_early', COPY.phrase.finish),
    ];
    v.preferredAction = 'try_again';
  }
  return body.join('. ');
}

/* ---- paused / summary / history / resume ---- */

function projectPaused(v: TvView, s: Core): string {
  const p = s.paused;
  v.screen = 'paused_or_invalid';
  v.title = COPY.paused.title;
  const reason = p?.reason ?? 'interrupted';
  const text = pausedText(reason);
  v.body = [text, COPY.paused.retryHint];
  const open = measureReady(s);
  const from = p?.from ?? 'phrase';
  const retry = act('retry', COPY.paused.retry, { hint: COPY.paused.retryHint, disabled: !open });
  if (from === 'phrase') {
    v.phrase = phraseInfo(s, null);
    v.actions = [retry, act('skip_phrase', COPY.paused.skipPhrase), act('finish_early', COPY.paused.finish)];
  } else if (from === 'vowel') {
    v.actions = [retry, act('skip_vowel', COPY.paused.skipVowel)];
  } else {
    v.actions = [retry, act('cancel', COPY.paused.cancel)];
  }
  v.preferredAction = 'retry';
  return `${v.title}. ${text}`;
}

function pausedText(reason: string): string {
  switch (reason) {
    case 'link_lost':
      return COPY.paused.linkLost;
    case 'room_noisier':
      return COPY.paused.blocked;
    case 'mic':
      return COPY.paused.mic;
    case 'timeout':
      return COPY.paused.timeout;
    case 'no_start':
      return COPY.paused.noStart;
    case 'phone_reconnected':
      return COPY.paused.phoneReconnected;
    case 'interrupted':
      return COPY.paused.interrupted;
    default:
      return reasonText(reason);
  }
}

function projectSummary(v: TvView, s: Core): string {
  v.screen = 'summary';
  const session = s.session;
  if (!session) return '';
  const complete = session.ended === 'completed' && !session.resumed;
  const summary: SummaryView = deriveSummary({
    attempts: session.attempts,
    vowels: session.vowels,
    skipped: session.skipped,
    complete,
    calMarginDb: isListenerEdition(s) ? null : session.calMarginDb,
    familyMode: session.familyMode,
    listenerEdition: isListenerEdition(s),
  });
  v.summary = summary;
  v.title = complete ? COPY.summary.title : COPY.summary.titleIncomplete;
  v.body = [];
  v.actions = [act('done', COPY.summary.done), act('open_history', COPY.summary.history)];
  v.preferredAction = 'done';
  return `${v.title}. ${summary.lines[0] ?? ''}`;
}

function projectHistory(v: TvView, s: Core, env: Env): string {
  v.screen = 'history';
  v.title = COPY.history.title;
  v.body = [...COPY.history.body];
  const days: HistoryDayView[] = deriveHistory(s.records, safeLocalDate(env.localDate, s.now));
  v.history = days;
  v.actions = [act('done', COPY.history.done)];
  v.preferredAction = 'done';
  return v.title;
}

function projectResume(v: TvView, s: Core): string {
  v.screen = 'resume_or_discard';
  v.title = COPY.resume.title;
  const cp = s.checkpoint;
  const lines: string[] = [];
  if (cp) {
    const attempted = new Set(cp.record.attempts.filter((a) => a.started).map((a) => a.position)).size;
    lines.push(
      `A session from ${cp.record.localDate} was not finished. ${plural(attempted, 'phrase')} ${attempted === 1 ? 'was' : 'were'} attempted.`,
    );
    if (cp.record.attempts.some((a) => a.state === 'capturing' || a.state === 'capture_closed' || a.state === 'response_pending')) {
      lines.push(COPY.resume.interruptedNote);
    }
  }
  lines.push(COPY.resume.note);
  v.body = lines;
  // Resume first, Discard focused second (ADR-0005).
  v.actions = [act('resume_session', COPY.resume.resume), act('discard_session', COPY.resume.discard, { destructive: true })];
  v.preferredAction = 'resume_session';
  return `${v.title}. ${lines.join(' ')}`;
}

export type { ScreenId, TvStage };
