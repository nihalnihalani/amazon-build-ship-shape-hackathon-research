/**
 * DOM view for the phone page. Plain DOM APIs only: every piece of text (including
 * household phrases and the cue word) is inserted with `textContent`, never as markup.
 *
 * Rules that shape this file:
 *  - No level meter, verdict or result is ever shown on the phone; only "Measuring".
 *  - The aria-live region is not updated while measuring, so a screen reader on this phone
 *    cannot speak into the microphone during a window.
 *  - The microphone badge shows what the audio port observed, never what was requested.
 */

import { DEFAULT_CUE_WORD, LIMITS, PRIVACY_SENTENCE } from './config.js';
import type { AppState, PhoneController } from './controller.js';
import { micLabel, stageLabel, unpairedText } from './labels.js';
import { validateCue, validatePhrases } from './phrases.js';
import type { MicSettingsWire, WakeLockState } from './ports/wire.js';

type Props = {
  id?: string;
  className?: string;
  text?: string;
  hidden?: boolean;
  attrs?: Record<string, string>;
};

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Node[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.id) el.id = props.id;
  if (props.className) el.className = props.className;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.hidden) el.hidden = true;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(c);
  return el;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function tri(v: boolean | null): string {
  return v === null ? 'unknown' : v ? 'on' : 'off';
}

function wakeLockText(state: WakeLockState): string {
  switch (state) {
    case 'held':
      return 'Keep this screen on: the screen is being kept on.';
    case 'released':
      return 'Keep this screen on: the browser released it. Keep this page open and visible; the screen may turn off.';
    case 'unsupported':
      return 'Keep this screen on: not supported by this browser. Change the phone’s screen timeout so it stays on.';
    case 'rejected':
      return 'Keep this screen on: the browser refused (for example power saving). Change the phone’s screen timeout so it stays on.';
    case 'not_requested':
      return 'Keep this screen on: starts when the microphone is started.';
  }
}

function settingsLines(s: MicSettingsWire, supportsAgc: boolean | null, micOpen: boolean): string[] {
  const lines = [
    `Browser reports gain control: ${tri(s.auto_gain_control)}`,
    `Browser reports echo cancellation: ${tri(s.echo_cancellation)}`,
    `Browser reports noise suppression: ${tri(s.noise_suppression)}`,
    `Browser reports sample rate: ${s.sample_rate === null ? 'unknown' : `${Math.round(s.sample_rate)} Hz`}`,
  ];
  if (micOpen && supportsAgc === false) lines.push('This browser does not report support for turning gain control off.');
  if (micOpen && supportsAgc === null) lines.push('Whether this browser supports turning gain control off is unknown.');
  return lines;
}

export interface MountedView {
  destroy(): void;
}

export function mountView(root: HTMLElement, controller: PhoneController): MountedView {
  // ----- static skeleton ---------------------------------------------------
  const banner = h('p', { id: 'test-banner', className: 'banner banner-test', hidden: true, attrs: { role: 'note' } });
  const insecure = h('p', {
    id: 'insecure-banner',
    className: 'banner banner-warn',
    hidden: true,
    text: 'This page is not on a secure (HTTPS) address, so the browser will not let it use the microphone. Pairing can still work, but measuring cannot. Open the HTTPS link shown by the TV or the relay on this phone.',
    attrs: { role: 'note' },
  });
  const status = h('div', {
    id: 'status',
    className: 'status',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });

  // Join
  const codeInput = h('input', {
    id: 'code',
    className: 'field code-field',
    attrs: {
      type: 'text',
      inputmode: 'text',
      autocomplete: 'off',
      autocapitalize: 'characters',
      autocorrect: 'off',
      spellcheck: 'false',
      maxlength: '12',
      'aria-describedby': 'code-msg',
    },
  });
  const codeMsg = h('p', { id: 'code-msg', className: 'field-msg' });
  const labelInput = h('input', {
    id: 'device-label',
    className: 'field',
    attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'label-msg' },
  });
  const labelMsg = h('p', { id: 'label-msg', className: 'field-msg' });
  const joinBtn = h('button', { id: 'join', className: 'btn btn-primary', text: 'Join', attrs: { type: 'submit' } });
  const joinMsg = h('p', { id: 'join-msg', className: 'field-msg' });
  const joinForm = h(
    'form',
    { id: 'join-form', attrs: { novalidate: '' } },
    h('label', { text: 'Code from the TV', attrs: { for: 'code' } }),
    codeInput,
    codeMsg,
    h('label', { text: 'Name for this phone', attrs: { for: 'device-label' } }),
    labelInput,
    labelMsg,
    joinBtn,
    joinMsg,
  );
  const pendingHeading = h('h2', { id: 'pending-heading', attrs: { tabindex: '-1' } });
  const cancelJoinBtn = h('button', { id: 'cancel-join', className: 'btn', text: 'Cancel', attrs: { type: 'button' } });
  const pending = h(
    'div',
    { id: 'pending', hidden: true },
    pendingHeading,
    h('p', {
      text: 'Your TV shows three numbers. Pick the number shown above, using the TV remote. If your TV is not asking you to pick a number, tap Cancel.',
    }),
    cancelJoinBtn,
  );
  // A3-01: the relay said "accepted", but the phone cannot tell whose room it is. Ask the person.
  const confirmHeading = h('h2', { id: 'confirm-heading', attrs: { tabindex: '-1' } });
  const confirmYesBtn = h('button', {
    id: 'confirm-yes',
    className: 'btn',
    text: 'Yes, that was me',
    attrs: { type: 'button' },
  });
  const confirmNoBtn = h('button', {
    id: 'confirm-no',
    className: 'btn',
    text: 'No, cancel',
    attrs: { type: 'button' },
  });
  const confirmSelf = h(
    'div',
    { id: 'confirm-self', hidden: true },
    confirmHeading,
    h('p', {
      text: 'Tap Yes only if you picked that number on your own TV just now. Until you do, this phone shares nothing with that TV: no microphone status and no phrases.',
    }),
    h('div', { className: 'btn-col' }, confirmYesBtn, confirmNoBtn),
  );
  const unpairedHeading = h('h2', {
    id: 'unpaired-heading',
    text: 'This phone is no longer paired',
    attrs: { tabindex: '-1' },
  });
  const unpairedReason = h('p', { id: 'unpaired-reason' });
  const unpairedNotice = h(
    'div',
    { id: 'unpaired-notice', className: 'notice', hidden: true },
    unpairedHeading,
    unpairedReason,
    h('p', { text: 'The microphone is off. To pair again, enter a new code from the TV below.' }),
  );
  const joinHeading = h('h2', { id: 'join-heading', text: 'Join the TV', attrs: { tabindex: '-1' } });
  const joinSection = h(
    'section',
    { id: 'view-join', attrs: { 'aria-labelledby': 'join-heading' } },
    unpairedNotice,
    joinHeading,
    h('p', { text: 'Enter the 6-character code shown on the TV.' }),
    joinForm,
    pending,
    confirmSelf,
  );

  // Setup
  const setupHeading = h('h2', { id: 'setup-heading', text: 'Paired with the TV', attrs: { tabindex: '-1' } });
  const linkLine = h('p', { id: 'link' });
  const retryBtn = h('button', {
    id: 'retry',
    className: 'btn',
    text: 'Retry now',
    hidden: true,
    attrs: { type: 'button' },
  });
  const micBadge = h('p', { id: 'mic-badge', className: 'badge' });
  const micHelp = h('p', { id: 'mic-help' });
  const modeLine = h('p', { id: 'mic-mode', hidden: true });
  const micNotice = h('p', { id: 'mic-notice', className: 'notice', hidden: true });
  const dndTip = h('p', {
    id: 'dnd-tip',
    className: 'small',
    text: 'Tip: turn on Do Not Disturb on this phone so a call or notification sound does not interrupt a measurement. This page never plays a sound and never buzzes the phone.',
  });
  const startBtn = h('button', {
    id: 'start-mic',
    className: 'btn btn-primary',
    text: 'Start microphone',
    attrs: { type: 'button' },
  });
  const relaxedBtn = h('button', {
    id: 'start-mic-defaults',
    className: 'btn',
    text: 'Try browser default settings',
    hidden: true,
    attrs: { type: 'button' },
  });
  const cancelMicBtn = h('button', {
    id: 'cancel-mic',
    className: 'btn',
    text: 'Cancel',
    hidden: true,
    attrs: { type: 'button' },
  });
  const stopBtn = h('button', {
    id: 'stop-mic',
    className: 'btn',
    text: 'Turn microphone off',
    hidden: true,
    attrs: { type: 'button' },
  });
  const settingsList = h('ul', { id: 'mic-settings', className: 'plain-list' });
  const wakeLine = h('p', { id: 'wake-lock' });
  const sessionLine = h('p', { id: 'session' });
  const micSection = h(
    'section',
    { id: 'mic-section', attrs: { 'aria-labelledby': 'mic-heading' } },
    h('h2', { id: 'mic-heading', text: 'Microphone' }),
    micBadge,
    micHelp,
    micNotice,
    dndTip,
    modeLine,
    h('div', { className: 'btn-row' }, startBtn, relaxedBtn, cancelMicBtn, stopBtn),
    h('h3', { text: 'What the browser reports' }),
    settingsList,
    h('p', {
      className: 'small',
      text: 'These are settings the browser says it applied. They do not prove the audio is unprocessed: the phone itself may still adjust it.',
    }),
    wakeLine,
  );

  const heardBtn = h('button', {
    id: 'heard',
    className: 'btn btn-listener',
    text: 'Heard',
    attrs: { type: 'button' },
  });
  const notHeardBtn = h('button', {
    id: 'not-heard',
    className: 'btn btn-listener',
    text: 'Not heard',
    attrs: { type: 'button' },
  });
  const cueBtn = h('button', { id: 'cue', className: 'btn btn-listener', attrs: { type: 'button' } });
  const cueCount = h('p', { id: 'cue-count' });
  const cueFeedback = h('p', { id: 'cue-feedback', className: 'field-msg' });
  const listenerState = h('p', { id: 'listener-state' });
  const listenerSection = h(
    'section',
    { id: 'listener-section', attrs: { 'aria-labelledby': 'listener-heading' } },
    h('h2', { id: 'listener-heading', text: 'Listener' }),
    sessionLine,
    listenerState,
    h('div', { className: 'btn-col' }, heardBtn, notHeardBtn, cueBtn),
    cueCount,
    cueFeedback,
  );

  // Phrase editor
  const phraseList = h('ol', { id: 'phrase-list', className: 'plain-list' });
  const addPhraseBtn = h('button', {
    id: 'add-phrase',
    className: 'btn',
    text: 'Add phrase',
    attrs: { type: 'button' },
  });
  const savePhrasesBtn = h('button', {
    id: 'save-phrases',
    className: 'btn btn-primary',
    text: 'Save phrases',
    attrs: { type: 'button' },
  });
  const phraseMsg = h('p', { id: 'phrase-msg', className: 'field-msg' });
  const phraseStatus = h('p', { id: 'phrase-status' });
  const phraseSaved = h('ol', { id: 'phrase-saved', className: 'plain-list saved-list', attrs: { 'aria-label': 'Phrases sent to the TV' } });
  const phraseSection = h(
    'section',
    { id: 'phrase-section', attrs: { 'aria-labelledby': 'phrase-heading' } },
    h('h2', { id: 'phrase-heading', text: 'Household phrases' }),
    h('p', {
      text: `Type 1 to ${LIMITS.phrasesMax} phrases, up to ${LIMITS.phraseMaxCodePoints} characters each. The TV shows them exactly as typed.`,
    }),
    phraseList,
    h('div', { className: 'btn-row' }, addPhraseBtn, savePhrasesBtn),
    phraseMsg,
    phraseStatus,
    phraseSaved,
  );

  // Cue settings
  const cueInput = h('input', {
    id: 'cue-word',
    className: 'field',
    attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'cue-msg' },
  });
  cueInput.value = DEFAULT_CUE_WORD;
  const cueMsg = h('p', { id: 'cue-msg', className: 'field-msg' });
  const saveCueBtn = h('button', {
    id: 'save-cue',
    className: 'btn',
    text: 'Use this cue word',
    attrs: { type: 'button' },
  });
  const cueSettings = h(
    'details',
    { id: 'cue-settings' },
    h('summary', { text: 'Cue word settings' }),
    h('label', { text: `Cue word (1 to ${LIMITS.cueMaxCodePoints} characters)`, attrs: { for: 'cue-word' } }),
    cueInput,
    cueMsg,
    saveCueBtn,
    h('p', { className: 'small', text: 'Kept only on this page. It is not saved after you close it.' }),
  );

  const setupSection = h(
    'div',
    { id: 'view-setup', hidden: true },
    setupHeading,
    linkLine,
    retryBtn,
    micSection,
    listenerSection,
    phraseSection,
    cueSettings,
  );

  const privacy = h('p', { id: 'privacy', className: 'privacy', text: PRIVACY_SENTENCE });

  const main = h(
    'main',
    { id: 'main' },
    h('h1', { text: 'Across the Room: phone' }),
    banner,
    insecure,
    status,
    joinSection,
    setupSection,
    h('footer', {}, privacy),
  );
  root.replaceChildren(main);

  // ----- phrase editor rows ----------------------------------------------------
  interface Row {
    li: HTMLLIElement;
    input: HTMLInputElement;
    msg: HTMLParagraphElement;
    remove: HTMLButtonElement;
    label: HTMLLabelElement;
    touched: boolean;
  }
  const rows: Row[] = [];
  let lastState: AppState = controller.getState();

  const addRow = (value = ''): void => {
    const n = rows.length + 1;
    const input = h('input', {
      id: `phrase-${n}`,
      className: 'field',
      attrs: { type: 'text', autocomplete: 'off', spellcheck: 'true', 'aria-describedby': `phrase-msg-${n}` },
    });
    input.value = value;
    const msg = h('p', { id: `phrase-msg-${n}`, className: 'field-msg' });
    const label = h('label', { text: `Phrase ${n}`, attrs: { for: `phrase-${n}` } });
    const remove = h('button', {
      className: 'btn btn-small',
      text: 'Remove',
      attrs: { type: 'button', 'aria-label': `Remove phrase ${n}` },
    });
    const li = h('li', { className: 'phrase-row' }, label, input, msg, remove);
    const row: Row = { li, input, msg, remove, label, touched: false };
    input.addEventListener('input', () => {
      row.touched = true;
      renderPhrases(lastState);
    });
    remove.addEventListener('click', () => {
      if (rows.length <= 1) return;
      const i = rows.indexOf(row);
      rows.splice(i, 1);
      li.remove();
      renumber();
      renderPhrases(lastState);
    });
    rows.push(row);
    phraseList.appendChild(li);
  };

  const renumber = (): void => {
    rows.forEach((r, i) => {
      const n = i + 1;
      r.input.id = `phrase-${n}`;
      r.msg.id = `phrase-msg-${n}`;
      r.input.setAttribute('aria-describedby', r.msg.id);
      r.label.htmlFor = r.input.id;
      setText(r.label, `Phrase ${n}`);
      r.remove.setAttribute('aria-label', `Remove phrase ${n}`);
    });
  };

  const renderPhrases = (s: AppState): void => {
    const validation = validatePhrases(rows.map((r) => r.input.value));
    rows.forEach((r, i) => {
      const issue = validation.issues.find((x) => x.index === i);
      const show = issue !== undefined && (r.touched || r.input.value !== '');
      setText(r.msg, show && issue ? issue.message : '');
      if (show) r.input.setAttribute('aria-invalid', 'true');
      else r.input.removeAttribute('aria-invalid');
      r.input.disabled = s.phrasesLocked;
      r.remove.disabled = s.phrasesLocked || rows.length <= 1;
    });
    addPhraseBtn.disabled = s.phrasesLocked || rows.length >= LIMITS.phrasesMax;
    savePhrasesBtn.disabled = s.phrasesLocked || !validation.ok;
    const touchedAny = rows.some((r) => r.touched || r.input.value !== '');
    setText(phraseMsg, validation.listMessage !== null && touchedAny ? validation.listMessage : '');
    let statusText = '';
    const plural = `${s.phrases.count} phrase${s.phrases.count === 1 ? '' : 's'}`;
    if (s.phrasesLocked) statusText = 'Editing is paused while measuring.';
    else if (s.phrases.status === 'sending') statusText = `Sent ${plural}. Waiting for the TV to confirm.`;
    else if (s.phrases.status === 'saved') statusText = `The TV saved ${plural}.`;
    else if (s.phrases.status === 'rejected') statusText = 'The TV could not save the phrases right now. It saves them after the current phrase window: press Save again then.';
    else if (s.phrases.status === 'not_sent') statusText = 'Not sent: not connected to the TV right now. Try again when it reconnects.';
    setText(phraseStatus, statusText);
    // Exactly what was sent, rendered as plain text (never as markup).
    const sig = s.phrases.saved.join('\u0000');
    if (phraseSaved.dataset['sig'] !== sig) {
      phraseSaved.dataset['sig'] = sig;
      phraseSaved.replaceChildren(...s.phrases.saved.map((t) => h('li', { text: t })));
    }
  };

  addRow();
  addPhraseBtn.addEventListener('click', () => {
    if (rows.length >= LIMITS.phrasesMax) return;
    addRow();
    renderPhrases(lastState);
    rows[rows.length - 1]?.input.focus();
  });
  savePhrasesBtn.addEventListener('click', () => {
    controller.savePhrases(rows.map((r) => r.input.value));
    // Show the normalized text that was actually sent.
    const v = validatePhrases(rows.map((r) => r.input.value));
    if (v.ok) rows.forEach((r, i) => { r.input.value = v.phrases[i] ?? r.input.value; });
  });

  // ----- event wiring ---------------------------------------------------------
  codeInput.addEventListener('input', () => controller.setCode(codeInput.value));
  labelInput.value = lastState.join.deviceLabel;
  labelInput.addEventListener('input', () => controller.setDeviceLabel(labelInput.value));
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    controller.join();
  });
  cancelJoinBtn.addEventListener('click', () => controller.cancelJoin());
  // The ONLY path to getUserMedia: an explicit tap on this button.
  startBtn.addEventListener('click', () => controller.startMic());
  relaxedBtn.addEventListener('click', () => controller.startMic({ relaxConstraints: true }));
  cancelMicBtn.addEventListener('click', () => controller.cancelMicRequest());
  stopBtn.addEventListener('click', () => controller.stopMic());
  heardBtn.addEventListener('click', () => controller.answer('heard'));
  notHeardBtn.addEventListener('click', () => controller.answer('not_heard'));
  cueBtn.addEventListener('click', () => controller.sendCue());
  saveCueBtn.addEventListener('click', () => controller.setCueWord(cueInput.value));
  const renderCueInput = (): void => {
    const v = validateCue(cueInput.value);
    setText(cueMsg, v.ok ? '' : (v.message ?? ''));
    if (v.ok) cueInput.removeAttribute('aria-invalid');
    else cueInput.setAttribute('aria-invalid', 'true');
    saveCueBtn.disabled = !v.ok;
  };
  cueInput.addEventListener('input', renderCueInput);
  renderCueInput();
  confirmYesBtn.addEventListener('click', () => controller.confirmPairing());
  confirmNoBtn.addEventListener('click', () => controller.rejectPairing());
  retryBtn.addEventListener('click', () => controller.retryNow());

  // ----- rendering -------------------------------------------------------------
  let lastScreen: AppState['screen'] | null = null;
  let lastPhase: AppState['join']['phase'] | null = null;
  let announced = '';

  const statusMessage = (s: AppState): string => {
    if (s.screen === 'join') {
      if (s.join.phase === 'pending' && s.join.confirmDigits) return `On your TV, pick ${s.join.confirmDigits}`;
      if (s.join.phase === 'confirming' && s.join.confirmDigits) return `Did you just pick ${s.join.confirmDigits} on your TV?`;
      if (s.join.phase === 'connecting') return 'Connecting to the relay.';
      if (s.unpairedReason) return `This phone is no longer paired. ${unpairedText(s.unpairedReason)}`;
      return s.join.message ?? '';
    }
    if (s.link === 'reconnecting' || s.link === 'failed') {
      return s.link === 'failed'
        ? 'Cannot connect to the relay. Automatic retries stopped. Tap Retry now.'
        : 'Connection to the TV lost. Reconnecting.';
    }
    if (s.notice) return s.notice;
    if (s.micNotice === 'silent_input') return 'The microphone looks muted or blocked.';
    if (s.canAnswer) return 'Listener controls are open. Choose Heard or Not heard.';
    return micLabel(s.mic.state, s.mic.detail).badge;
  };

  /** Sets "<before><strong>digits</strong><after>" without markup parsing. */
  const setDigitsHeading = (el: HTMLElement, before: string, digits: string, after: string): void => {
    const full = `${before}${digits}${after}`;
    if (el.textContent === full) return;
    el.textContent = '';
    const strong = document.createElement('strong');
    strong.className = 'digits';
    strong.textContent = digits;
    el.append(before, strong, after);
  };

  const render = (s: AppState): void => {
    lastState = s;
    const measuring = s.mic.state === 'measuring' || s.run !== null;

    // banners
    if (s.banner) {
      setText(banner, s.banner);
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
    insecure.hidden = s.secureContext;

    // screens
    joinSection.hidden = s.screen !== 'join';
    setupSection.hidden = s.screen !== 'setup';

    // join
    if (codeInput.value !== s.join.code) codeInput.value = s.join.code;
    setText(codeMsg, s.join.codeMessage ?? '');
    if (s.join.codeMessage) codeInput.setAttribute('aria-invalid', 'true');
    else codeInput.removeAttribute('aria-invalid');
    setText(labelMsg, s.join.deviceLabelMessage ?? '');
    setText(joinMsg, s.join.message ?? '');
    const joining = s.join.phase !== 'idle';
    const awaitingPick = s.join.phase === 'pending';
    const awaitingYes = s.join.phase === 'confirming';
    joinForm.hidden = awaitingPick || awaitingYes;
    joinBtn.disabled = joining;
    codeInput.disabled = joining;
    labelInput.disabled = joining;
    setText(joinBtn, s.join.phase === 'connecting' ? 'Connecting\u2026' : 'Join');
    pending.hidden = !awaitingPick;
    confirmSelf.hidden = !awaitingYes;
    if (s.join.confirmDigits) {
      setDigitsHeading(pendingHeading, 'On your TV, pick ', s.join.confirmDigits, '');
      setDigitsHeading(confirmHeading, 'Did you just pick ', s.join.confirmDigits, ' on your TV?');
    }
    unpairedNotice.hidden = !(s.unpairedReason !== null && s.join.phase === 'idle');
    setText(unpairedReason, s.unpairedReason ? unpairedText(s.unpairedReason) : '');

    // setup: link
    const tv = s.tvConnected === null ? 'TV connection unknown' : s.tvConnected ? 'TV connected' : 'TV not connected';
    let link = '';
    switch (s.link) {
      case 'connected':
        link = `Connected to the relay. ${tv}.`;
        break;
      case 'reconnecting':
        link = `Connection to the TV unknown: reconnecting (attempt ${s.reconnectAttempt}).`;
        break;
      case 'failed':
        link = 'Cannot reach the relay. Automatic retries stopped after 2 minutes. Tap Retry now.';
        break;
      default:
        link = 'Connecting…';
    }
    setText(linkLine, link);
    retryBtn.hidden = !(s.link === 'reconnecting' || s.link === 'failed');

    // setup: microphone
    const label = micLabel(s.mic.state, s.mic.detail);
    setText(micBadge, label.badge);
    micBadge.dataset['state'] = s.mic.state;
    setText(micHelp, !s.secureContext && s.mic.mode !== 'fixture_replay'
      ? 'This page is not on a secure (HTTPS) address, so the microphone cannot work here. Open the HTTPS link instead.'
      : label.help);
    const micOpen = s.mic.state === 'open_idle' || s.mic.state === 'measuring';
    startBtn.disabled = !s.canStartMic;
    startBtn.hidden = micOpen || s.mic.state === 'permission_pending';
    relaxedBtn.hidden = s.mic.state !== 'constraints_unsupported';
    relaxedBtn.disabled = !s.canStartMic;
    cancelMicBtn.hidden = s.mic.state !== 'permission_pending';
    stopBtn.hidden = !micOpen;
    stopBtn.disabled = !s.canStopMic;
    if (s.mic.mode === 'same_host') {
      setText(modeLine, 'Same-Mac microphone mode: this is the microphone of the computer showing this page, not a phone.');
      modeLine.hidden = false;
    } else {
      modeLine.hidden = true;
    }
    const lines = settingsLines(s.mic.settings, s.mic.supported.auto_gain_control, micOpen);
    const joined = lines.join('\n');
    if (settingsList.dataset['sig'] !== joined) {
      settingsList.dataset['sig'] = joined;
      settingsList.replaceChildren(...lines.map((t) => h('li', { text: t })));
    }
    if (s.micNotice === 'silent_input') {
      setText(micNotice, 'The microphone looks muted or blocked. Check that nothing covers it and that it is not muted, then ask the TV to check again.');
      micNotice.hidden = false;
    } else {
      micNotice.hidden = true;
    }
    setText(wakeLine, wakeLockText(s.wakeLock));

    // setup: session + listener
    setText(
      sessionLine,
      s.session === null
        ? 'Waiting for the TV to start a session.'
        : `TV step: ${s.session.stage ? stageLabel(s.session.stage) : 'Starting'}.`,
    );
    setText(cueCount, `Cues used: ${s.cue.used} of ${s.cue.max}`);
    setText(cueFeedback, s.cue.feedback ?? '');
    setText(cueBtn, `Cue: ${s.cue.word}`);
    cueBtn.setAttribute('aria-label', `Send the cue word: ${s.cue.word}`);
    heardBtn.disabled = !s.canAnswer;
    notHeardBtn.disabled = !s.canAnswer;
    cueBtn.disabled = !s.canCue;
    let ls = 'Listener buttons are off until the TV opens them after a phrase.';
    if (s.listener.feedback !== null && s.listener.open) {
      ls = s.listener.feedback;
    } else if (s.listener.open && s.listener.answered !== null) {
      ls = `Sent: ${s.listener.answered === 'heard' ? 'Heard' : 'Not heard'}.`;
    } else if (s.canAnswer) {
      ls = 'Choose Heard or Not heard.';
    } else if (s.listener.open) {
      ls = 'Waiting for the connection to the TV.';
    }
    setText(listenerState, ls);

    // phrases
    renderPhrases(s);

    // focus management on view changes
    if (lastScreen !== null && s.screen !== lastScreen) {
      if (s.screen === 'setup') setupHeading.focus();
      else if (s.unpairedReason !== null) unpairedHeading.focus();
      else joinHeading.focus();
    } else if (lastPhase !== null && s.join.phase !== lastPhase && s.screen === 'join') {
      if (s.join.phase === 'pending') pendingHeading.focus();
      else if (s.join.phase === 'confirming') confirmHeading.focus();
      else if (s.join.phase === 'idle' && (lastPhase === 'pending' || lastPhase === 'confirming')) joinHeading.focus();
    }
    lastScreen = s.screen;
    lastPhase = s.join.phase;

    // live region: never updated while measuring (a screen reader must not speak into the mic)
    const message = statusMessage(s);
    if (!measuring && message !== announced) {
      announced = message;
      setText(status, message);
    }
  };

  const unsubscribe = controller.subscribe(render);
  render(controller.getState());
  return {
    destroy(): void {
      unsubscribe();
      root.replaceChildren();
    },
  };
}
