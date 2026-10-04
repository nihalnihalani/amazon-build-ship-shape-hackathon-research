import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountView, type MountedView } from '../src/view.js';
import type { MicState } from '../src/ports/audio.js';
import {
  ATTEMPT,
  attemptReveal,
  CODE,
  flush,
  joinAccepted,
  joinPending,
  listenerOpen,
  relayMsg,
  sessionBegin,
  validWindow,
  windowStart,
  windowStop,
} from './helpers/fakes.js';
import { type Harness, makeHarness, pairedHarness } from './helpers/harness.js';

/** The ADR-0002 sentence, typed independently of src/config.ts. */
const SRC = join(import.meta.dirname ?? process.cwd() + '/test', '..', 'src');
const ADR_0002_SENTENCE =
  'Audio stays on this phone and is never saved or uploaded. Only levels, typed phrases, listener responses, and connection details are sent to the relay and TV.';

let root: HTMLElement;
let view: MountedView | null = null;
let h: Harness;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};
const text = (id: string): string => $(id).textContent ?? '';
const click = (id: string): void => $(id).click();
const type = (id: string, value: string): void => {
  const el = $<HTMLInputElement>(id);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

function mount(harness: Harness): void {
  h = harness;
  root = document.createElement('div');
  document.body.appendChild(root);
  view = mountView(root, harness.controller);
}

beforeEach(() => {
  document.body.replaceChildren();
});
afterEach(() => {
  view?.destroy();
  view = null;
  h?.controller.dispose();
  vi.useRealTimers();
});

describe('structure and accessibility', () => {
  it('has landmarks, labelled fields, a polite status region and the exact ADR-0002 sentence', () => {
    mount(makeHarness());
    expect(document.querySelector('main')).not.toBeNull();
    const status = $('status');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(text('privacy')).toBe(ADR_0002_SENTENCE);
    expect(document.querySelector('label[for="code"]')?.textContent).toBe('Code from the TV');
    expect(document.querySelector('label[for="device-label"]')).not.toBeNull();
    expect(document.querySelector('html')?.getAttribute('lang') ?? 'en').toBeTruthy();
    // every control is a real button or input, never a clickable div
    for (const el of document.querySelectorAll('[onclick]')) throw new Error(`inline handler on ${el.tagName}`);
    for (const b of document.querySelectorAll('button')) expect(b.getAttribute('type')).toBeTruthy();
  });

  it('the privacy sentence is on every screen (join, setup, unpaired)', async () => {
    mount(makeHarness());
    expect($('privacy').hidden).toBe(false);
    expect($('privacy').closest('[hidden]')).toBeNull();
  });

  it('tap targets: buttons are at least 64 px tall and the listener buttons are larger', () => {
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
    const block = (selector: string): string => {
      const m = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
      if (!m) throw new Error(`no rule for ${selector}`);
      return m[1] ?? '';
    };
    const minHeight = (selector: string): number => Number(/min-height:\s*(\d+)px/.exec(block(selector))?.[1] ?? 0);
    expect(minHeight('.btn')).toBeGreaterThanOrEqual(64);
    expect(minHeight('.btn-listener')).toBeGreaterThanOrEqual(64);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it('does not use inline styles or any innerHTML-style insertion in the source', () => {
    for (const file of ['view.ts', 'controller.ts', 'main.ts']) {
      const src = readFileSync(join(SRC, file), 'utf8');
      expect(src, file).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
    }
  });
});

describe('join view', () => {
  it('shows the join form first; setup and unpaired are hidden', () => {
    mount(makeHarness());
    expect($('view-join').hidden).toBe(false);
    expect($('view-setup').hidden).toBe(true);
    expect($('view-unpaired').hidden).toBe(true);
    expect($<HTMLInputElement>('device-label').value).toBe('Android Chrome');
  });

  it('upper-cases the code as typed and explains characters that are not used', () => {
    mount(makeHarness());
    type('code', 'acdefh');
    expect($<HTMLInputElement>('code').value).toBe('ACDEFH');
    type('code', 'ACDEF0');
    expect(text('code-msg')).toContain('"0"');
    expect($('code').getAttribute('aria-invalid')).toBe('true');
  });

  it('a code placed by the page (from the #code= fragment) appears in the field', () => {
    const harness = makeHarness();
    harness.controller.setCode('ACDEFH'); // what main.ts does with the fragment
    mount(harness);
    expect($<HTMLInputElement>('code').value).toBe('ACDEFH');
  });

  it('Join dials the relay; join.pending shows "Check the TV: does it show NN?"', async () => {
    mount(makeHarness());
    type('code', CODE);
    click('join');
    expect(h.sockets.current.url).toBe('wss://relay.test/ws');
    h.sockets.current.open();
    h.sockets.current.receive(joinPending('47'));
    expect($('pending').hidden).toBe(false);
    expect($('join-form').hidden).toBe(true);
    expect(text('pending-heading')).toBe('Check the TV: does it show 47?');
    expect(text('status')).toBe('Check the TV: does it show 47?');
    expect(document.activeElement?.id).toBe('pending-heading');
  });

  it('shows the reason when the TV rejects, and the form is usable again', () => {
    mount(makeHarness());
    type('code', CODE);
    click('join');
    h.sockets.current.open();
    h.sockets.current.receive(joinPending());
    h.sockets.current.receive(relayMsg('join.rejected', { reason: 'expired' }));
    expect($('join-form').hidden).toBe(false);
    expect(text('join-msg')).toMatch(/expired/);
    expect($<HTMLButtonElement>('join').disabled).toBe(false);
  });

  it('a connection failure is explained', () => {
    mount(makeHarness());
    type('code', CODE);
    click('join');
    h.sockets.current.drop(1006);
    expect(text('join-msg')).toMatch(/Could not reach the relay/);
  });

  it('cancelling a pending join returns to the form', () => {
    mount(makeHarness());
    type('code', CODE);
    click('join');
    h.sockets.current.open();
    h.sockets.current.receive(joinPending());
    click('cancel-join');
    expect($('pending').hidden).toBe(true);
    expect($('join-form').hidden).toBe(false);
  });

  it('after joining, the setup view replaces the join view and takes focus', () => {
    mount(makeHarness());
    type('code', CODE);
    click('join');
    h.sockets.current.open();
    h.sockets.current.receive(joinPending());
    h.sockets.current.receive(joinAccepted());
    expect($('view-join').hidden).toBe(true);
    expect($('view-setup').hidden).toBe(false);
    expect(document.activeElement?.id).toBe('setup-heading');
    expect(text('setup-heading')).toBe('Paired with the TV');
  });
});

describe('secure context', () => {
  it('an insecure page says the microphone cannot work here and cannot start it', async () => {
    mount(await pairedHarness({ secureContext: false }));
    expect($('insecure-banner').hidden).toBe(false);
    expect(text('insecure-banner')).toMatch(/not on a secure \(HTTPS\) address/);
    expect(text('mic-help')).toMatch(/secure/);
    expect($<HTMLButtonElement>('start-mic').disabled).toBe(true);
    click('start-mic');
    expect(h.audio.openCalls).toHaveLength(0);
  });

  it('a secure page shows no warning', async () => {
    mount(await pairedHarness());
    expect($('insecure-banner').hidden).toBe(true);
  });
});

describe('test banner', () => {
  it('is shown persistently when the build supplies text, and absent otherwise', async () => {
    mount(makeHarness({ banner: 'Banner supplied by the test build' }));
    expect($('test-banner').hidden).toBe(false);
    expect(text('test-banner')).toBe('Banner supplied by the test build');
    view?.destroy();
    mount(makeHarness());
    expect($('test-banner').hidden).toBe(true);
  });
});

describe('microphone states', () => {
  const cases: Array<[MicState, string | null, string, RegExp]> = [
    ['off', null, 'Mic off', /not open/],
    ['permission_pending', null, 'Waiting for permission', /Allow/],
    ['permission_denied', null, 'Permission denied', /site settings/],
    ['no_input', null, 'No microphone found', /No microphone was found/],
    ['input_busy', null, 'Microphone busy', /another app/i],
    ['input_busy', 'track_muted', 'Microphone muted', /muted/],
    ['constraints_unsupported', null, 'Settings not supported', /requested settings/],
    ['open_idle', null, 'Mic open, not measuring', /nothing is being measured/],
    ['measuring', null, 'Measuring', /stay quiet/],
    ['error', 'insecure_context', 'Microphone unavailable here', /HTTPS/],
    ['error', 'no_media_devices', 'Microphone unavailable here', /does not offer microphone/],
    ['error', 'track_ended', 'Microphone stopped', /stopped unexpectedly/],
    ['error', 'context_suspended', 'Audio paused', /paused/],
    ['error', 'audio_graph_failed', 'Microphone problem', /went wrong/],
  ];

  it.each(cases)('%s (%s) shows "%s" with guidance', async (state, detail, badge, help) => {
    mount(await pairedHarness());
    h.audio.setState(state, { detail });
    expect(text('mic-badge')).toBe(badge);
    expect(text('mic-help')).toMatch(help);
    expect($('mic-badge').dataset['state']).toBe(state);
  });

  it('only the observed measuring state ever says "Measuring"', async () => {
    mount(await pairedHarness());
    for (const [state, , badge] of cases) {
      h.audio.setState(state, { detail: null });
      expect(text('mic-badge').includes('Measuring'), `state ${state} -> ${badge}`).toBe(state === 'measuring');
    }
  });

  it('a window the TV started does not show Measuring until the port observes samples', async () => {
    mount(await pairedHarness());
    h.sockets.current.receive(sessionBegin());
    h.audio.makeOpen();
    expect(text('mic-badge')).toBe('Mic open, not measuring');
    h.sockets.current.receive(windowStart('phrase'));
    expect(h.controller.getState().run).not.toBeNull(); // the window is open on the phone ...
    expect(text('mic-badge')).toBe('Mic open, not measuring'); // ... but no sample has arrived yet
    h.audio.frame(0);
    expect(text('mic-badge')).toBe('Measuring');
    h.sockets.current.receive(windowStop());
    await flush();
    expect(text('mic-badge')).toBe('Mic open, not measuring');
  });

  it('Start microphone is the only way in: nothing opens before the tap, one tap opens once', async () => {
    mount(await pairedHarness());
    h.sockets.current.receive(sessionBegin());
    await flush();
    expect(h.audio.openCalls).toHaveLength(0);
    click('start-mic');
    expect(h.audio.openCalls).toEqual([{}]);
  });

  it('while waiting for permission there is a Cancel, and Start is hidden', async () => {
    mount(await pairedHarness());
    h.audio.setState('permission_pending');
    expect($('start-mic').hidden).toBe(true);
    expect($('cancel-mic').hidden).toBe(false);
    click('cancel-mic');
    expect(h.audio.cancelCalls).toBeGreaterThan(0);
    expect(text('mic-badge')).toBe('Mic off');
    expect($('start-mic').hidden).toBe(false);
  });

  it('unsupported settings offers the browser defaults as an explicit choice', async () => {
    mount(await pairedHarness());
    expect($('start-mic-defaults').hidden).toBe(true);
    h.audio.setState('constraints_unsupported');
    expect($('start-mic-defaults').hidden).toBe(false);
    click('start-mic-defaults');
    expect(h.audio.openCalls).toEqual([{ relaxConstraints: true }]);
  });

  it('shows browser-reported settings as reports, with unknown when not reported, and never claims unprocessed audio', async () => {
    mount(await pairedHarness());
    expect(text('mic-settings')).toContain('Browser reports gain control: unknown');
    h.audio.makeOpen();
    const t = text('mic-settings');
    expect(t).toContain('Browser reports gain control: off');
    expect(t).toContain('Browser reports echo cancellation: off');
    expect(t).toContain('Browser reports noise suppression: off');
    expect(t).toContain('Browser reports sample rate: 48000 Hz');
    h.audio.setState('open_idle', { settings: { auto_gain_control: true, echo_cancellation: null, noise_suppression: false, sample_rate: null, channel_count: null } });
    expect(text('mic-settings')).toContain('Browser reports gain control: on');
    expect(text('mic-settings')).toContain('Browser reports echo cancellation: unknown');
    expect(document.body.textContent).not.toMatch(/unprocessed audio is|raw audio is|clean audio/i);
    expect(document.body.textContent).toMatch(/do not prove the audio is unprocessed/);
  });

  it('turn-off button appears only while the microphone is open and stops it', async () => {
    mount(await pairedHarness());
    expect($('stop-mic').hidden).toBe(true);
    h.audio.makeOpen();
    expect($('stop-mic').hidden).toBe(false);
    click('stop-mic');
    await flush();
    expect(h.audio.getSnapshot().state).toBe('off');
    expect(text('mic-badge')).toBe('Mic off');
  });

  it('shows the keep-screen-on state and the link state (unknown while reconnecting)', async () => {
    vi.useFakeTimers();
    mount(await pairedHarness());
    h.audio.makeOpen();
    await flush();
    expect(text('wake-lock')).toMatch(/being kept on/);
    expect(text('link')).toMatch(/Connected to the relay/);
    h.sockets.current.drop(1006);
    expect(text('link')).toMatch(/Connection to the TV unknown: reconnecting \(attempt 1\)/);
  });
});

describe('no meter and no verdict on the phone', () => {
  it('level numbers never reach the DOM, and there is no meter-like element', async () => {
    mount(await pairedHarness());
    h.sockets.current.receive(sessionBegin());
    h.audio.makeOpen();
    h.sockets.current.receive(windowStart('phrase'));
    for (let i = 0; i < 20; i++) h.audio.frame(i, -23.4 - i);
    const body = document.body.textContent ?? '';
    expect(body).toMatch(/Measuring/);
    expect(body).not.toMatch(/dB|dBFS/i);
    expect(body).not.toMatch(/-23|-24|-30/);
    expect(document.querySelector('meter, progress, canvas, svg, img, audio, video, [role="meter"], [role="progressbar"], [role="img"]')).toBeNull();
    // and the accessible names carry no level or verdict either
    for (const el of document.querySelectorAll('[aria-label]')) {
      expect(el.getAttribute('aria-label')).not.toMatch(/dB|reached|below|band|loud/i);
    }
  });

  it('after the window closes the phone shows no result or verdict', async () => {
    mount(await pairedHarness());
    h.sockets.current.receive(sessionBegin());
    h.audio.makeOpen();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    h.audio.finishWindow({ ...validWindow(), p95_active_dbfs: -12.5, peak_dbfs: -9 });
    await flush();
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/-12\.5|reached today|below today|loud enough/i);
    expect(body).not.toMatch(/p95|peak/i);
  });

  it('the live region is not updated while measuring (no speech into the microphone) and catches up afterwards', async () => {
    mount(await pairedHarness());
    h.sockets.current.receive(sessionBegin());
    h.audio.makeOpen();
    expect(text('status')).toBe('Mic open, not measuring');
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    expect(text('mic-badge')).toBe('Measuring');
    expect(text('status')).toBe('Mic open, not measuring'); // unchanged: nothing announced during the window
    h.audio.finishWindow(validWindow());
    await flush();
    h.sockets.current.receive(listenerOpen());
    expect(text('status')).toBe('Listener controls are open. Choose Heard or Not heard.');
  });
});

describe('listener controls', () => {
  async function afterWindow(): Promise<void> {
    mount(await pairedHarness());
    h.sockets.current.receive(sessionBegin());
    h.audio.makeOpen();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    h.audio.finishWindow(validWindow());
    await flush();
  }
  const enabled = (): boolean[] => ['heard', 'not-heard', 'cue'].map((id) => !$<HTMLButtonElement>(id).disabled);

  it('are off until the TV opens them, on for that attempt, off again at reveal', async () => {
    await afterWindow();
    expect(enabled()).toEqual([false, false, false]);
    h.sockets.current.receive(listenerOpen());
    expect(enabled()).toEqual([true, true, true]);
    expect(text('listener-state')).toBe('Choose Heard or Not heard.');
    click('heard');
    const m = h.sockets.current.last('listener.response');
    expect(m).toMatchObject({ attempt_id: ATTEMPT, payload: { response: 'heard' } });
    expect(enabled()).toEqual([false, false, true]);
    expect(text('listener-state')).toBe('Sent: Heard.');
    h.sockets.current.receive(attemptReveal());
    expect(enabled()).toEqual([false, false, false]);
    click('heard');
    click('not-heard');
    click('cue');
    expect(h.sockets.current.messages('listener.response')).toHaveLength(1);
    expect(h.sockets.current.messages('cue')).toHaveLength(0);
  });

  it('shows the cue word on the Cue button and the count, and disables Cue at three', async () => {
    await afterWindow();
    expect(text('cue')).toBe('Cue: Volume');
    expect(text('cue-count')).toBe('Cues used: 0 of 3');
    h.sockets.current.receive(listenerOpen());
    click('cue');
    click('cue');
    expect(text('cue-count')).toBe('Cues used: 2 of 3');
    expect($<HTMLButtonElement>('cue').disabled).toBe(false);
    click('cue');
    expect(text('cue-count')).toBe('Cues used: 3 of 3');
    expect($<HTMLButtonElement>('cue').disabled).toBe(true);
    click('cue');
    expect(h.sockets.current.messages('cue')).toHaveLength(3);
  });

  it('are disabled while the connection is down even if they were open', async () => {
    vi.useFakeTimers();
    await afterWindow();
    h.sockets.current.receive(listenerOpen());
    h.sockets.current.drop(1006);
    expect(enabled()).toEqual([false, false, false]);
    expect(text('listener-state')).toBe('Waiting for the connection to the TV.');
  });

  it('the cue word is editable in the settings panel, with live validation, and rendered literally', async () => {
    await afterWindow();
    type('cue-word', 'a'.repeat(13));
    expect(text('cue-msg')).toBe('The cue word is 13 characters; the limit is 12.');
    expect($<HTMLButtonElement>('save-cue').disabled).toBe(true);
    type('cue-word', '  Hush ');
    expect(text('cue-msg')).toBe('');
    click('save-cue');
    expect(text('cue')).toBe('Cue: Hush');
    type('cue-word', '<b>x</b>');
    click('save-cue');
    expect(text('cue')).toBe('Cue: <b>x</b>');
    expect($('cue').querySelector('b')).toBeNull();
  });
});

describe('phrase editor', () => {
  const XSS = '<img src=x onerror=alert(1)>';

  async function setup(): Promise<void> {
    mount(await pairedHarness());
  }

  it('starts with one empty row, nothing to save and no scolding message', async () => {
    await setup();
    expect(document.querySelectorAll('#phrase-list li')).toHaveLength(1);
    expect($<HTMLButtonElement>('save-phrases').disabled).toBe(true);
    expect(text('phrase-msg-1')).toBe('');
    expect($<HTMLButtonElement>('add-phrase').disabled).toBe(false);
  });

  it('validates live: 60 characters pass, 61 do not', async () => {
    await setup();
    type('phrase-1', 'a'.repeat(60));
    expect($<HTMLButtonElement>('save-phrases').disabled).toBe(false);
    expect(text('phrase-msg-1')).toBe('');
    type('phrase-1', 'a'.repeat(61));
    expect($<HTMLButtonElement>('save-phrases').disabled).toBe(true);
    expect(text('phrase-msg-1')).toBe('Phrase 1 is 61 characters; the limit is 60.');
    expect($('phrase-1').getAttribute('aria-invalid')).toBe('true');
  });

  it('counts emoji and decomposed letters the way the protocol does', async () => {
    await setup();
    type('phrase-1', '😀'.repeat(60));
    expect($<HTMLButtonElement>('save-phrases').disabled).toBe(false);
    type('phrase-1', 'é'.repeat(60));
    expect($<HTMLButtonElement>('save-phrases').disabled).toBe(false);
    type('phrase-1', 'é'.repeat(61));
    expect($<HTMLButtonElement>('save-phrases').disabled).toBe(true);
  });

  it('rejects control characters with a message', async () => {
    await setup();
    type('phrase-1', 'tab\there');
    expect(text('phrase-msg-1')).toMatch(/control character/);
    expect($<HTMLButtonElement>('save-phrases').disabled).toBe(true);
  });

  it('allows at most 10 rows and at least 1', async () => {
    await setup();
    for (let i = 0; i < 9; i++) click('add-phrase');
    expect(document.querySelectorAll('#phrase-list li')).toHaveLength(10);
    expect($<HTMLButtonElement>('add-phrase').disabled).toBe(true);
    click('add-phrase');
    expect(document.querySelectorAll('#phrase-list li')).toHaveLength(10);
    const removeButtons = document.querySelectorAll<HTMLButtonElement>('#phrase-list button');
    expect(removeButtons[0]?.disabled).toBe(false);
    removeButtons[0]?.click();
    expect(document.querySelectorAll('#phrase-list li')).toHaveLength(9);
    expect($<HTMLButtonElement>('add-phrase').disabled).toBe(false);
    // down to one: the last Remove is disabled and labels renumber
    while (document.querySelectorAll('#phrase-list li').length > 1) {
      document.querySelector<HTMLButtonElement>('#phrase-list button')?.click();
    }
    expect(document.querySelector<HTMLButtonElement>('#phrase-list button')?.disabled).toBe(true);
    expect(document.querySelector('#phrase-list label')?.textContent).toBe('Phrase 1');
  });

  it('flags an empty row among filled ones and refuses to save', async () => {
    await setup();
    type('phrase-1', 'Good morning');
    click('add-phrase');
    type('phrase-2', '   ');
    expect(text('phrase-msg-2')).toMatch(/Phrase 2 is empty/);
    expect($<HTMLButtonElement>('save-phrases').disabled).toBe(true);
  });

  it('Save sends phrases.update with the normalized text and shows exactly what was sent', async () => {
    await setup();
    type('phrase-1', '  é test  ');
    click('add-phrase');
    type('phrase-2', 'Second');
    click('save-phrases');
    const m = h.sockets.current.last('phrases.update');
    expect(m.payload).toEqual({ phrases: ['é test', 'Second'] });
    expect(text('phrase-status')).toBe('Sent 2 phrases to the TV.');
    const items = [...document.querySelectorAll('#phrase-saved li')].map((li) => li.textContent);
    expect(items).toEqual(['é test', 'Second']);
  });

  it('renders markup-looking phrases as plain text and never executes them', async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    try {
      await setup();
      type('phrase-1', XSS);
      click('save-phrases');
      expect(h.sockets.current.last('phrases.update').payload).toEqual({ phrases: [XSS] });
      const li = document.querySelector('#phrase-saved li');
      expect(li?.textContent).toBe(XSS);
      expect(li?.innerHTML).toBe('&lt;img src=x onerror=alert(1)&gt;');
      expect(document.querySelector('img')).toBeNull();
      expect(document.querySelectorAll('[onerror]')).toHaveLength(0);
      expect(alertSpy).not.toHaveBeenCalled();
      expect($<HTMLInputElement>('phrase-1').value).toBe(XSS);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('editing is disabled while measuring, with the reason shown, and enabled again afterwards', async () => {
    await setup();
    type('phrase-1', 'Hello');
    h.sockets.current.receive(sessionBegin());
    h.audio.makeOpen();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    expect($<HTMLInputElement>('phrase-1').disabled).toBe(true);
    expect($<HTMLButtonElement>('save-phrases').disabled).toBe(true);
    expect($<HTMLButtonElement>('add-phrase').disabled).toBe(true);
    expect(text('phrase-status')).toBe('Editing is paused while measuring.');
    h.sockets.current.receive(windowStop());
    await flush();
    expect($<HTMLInputElement>('phrase-1').disabled).toBe(false);
    expect($<HTMLButtonElement>('save-phrases').disabled).toBe(false);
  });

  it('when the connection is down Save explains that nothing was sent', async () => {
    vi.useFakeTimers();
    await setup();
    type('phrase-1', 'Hello');
    h.sockets.current.drop(1006);
    click('save-phrases');
    expect(text('phrase-status')).toMatch(/Not sent/);
    expect(h.sockets.current.messages('phrases.update')).toHaveLength(0);
  });
});

describe('unpaired view', () => {
  it('says the phone is no longer paired, that the mic is off, and offers pairing again', async () => {
    mount(await pairedHarness());
    h.audio.makeOpen();
    h.sockets.current.receive(relayMsg('unpaired', { reason: 'tv_unpaired' }));
    await flush();
    expect($('view-unpaired').hidden).toBe(false);
    expect($('view-setup').hidden).toBe(true);
    expect(text('unpaired-heading')).toBe('This phone is no longer paired');
    expect(text('unpaired-reason')).toBe('The TV removed this phone.');
    expect(text('status')).toBe('This phone is no longer paired.');
    expect(document.activeElement?.id).toBe('unpaired-heading');
    expect(h.audio.getSnapshot().state).toBe('off');
    click('pair-again');
    expect($('view-join').hidden).toBe(false);
  });

  it.each([
    ['room_closed', 'The TV closed this pairing.'],
    ['expired', 'The pairing expired.'],
  ] as const)('wording for %s', async (reason, expected) => {
    mount(await pairedHarness());
    h.sockets.current.receive(relayMsg('unpaired', { reason }));
    await flush();
    expect(text('unpaired-reason')).toBe(expected);
  });
});
