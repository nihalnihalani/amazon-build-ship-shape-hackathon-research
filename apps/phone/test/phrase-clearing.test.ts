import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountView, type MountedView } from '../src/view.js';
import { CODE, flush, joinAccepted, joinPending, lastMessageId, relayMsg, SESSION, SESSION2, sessionBegin, tvMsg } from './helpers/fakes.js';
import { acceptedHarness, advanceLive, type Harness, readyHarness } from './helpers/harness.js';

/**
 * N-07: the phone must not keep the household phrases after the pairing (or the TV's data) is
 * gone. State here, the editor and the "sent to the TV" list are all emptied in the same path that
 * clears the credential, and on a discarded session.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const SECRET = 'Pills at nine, call Dr. Okafor';
let view: MountedView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const type = (id: string, value: string): void => {
  $<HTMLInputElement>(id).value = value;
  $(id).dispatchEvent(new Event('input', { bubbles: true }));
};

/** Types and saves a phrase, has the TV acknowledge it, and leaves another draft in the editor. */
async function withPhrases(h: Harness): Promise<void> {
  document.body.replaceChildren();
  view = mountView(document.body.appendChild(document.createElement('div')), h.controller);
  type('phrase-1', SECRET);
  $('save-phrases').click();
  const sent = h.sockets.current.last('phrases.update');
  h.sockets.current.receive(tvMsg('ack', { acked_message_id: sent.message_id, outcome: 'applied', detail: '' }, {}));
  $('add-phrase').click();
  type('phrase-2', 'An unsent draft about Mum');
  await flush();
  expect(document.body.textContent).toContain(SECRET); // sanity: it is on the page now
  expect(h.controller.getState().phrases).toMatchObject({ status: 'saved', saved: [SECRET] });
}

const expectNothingKept = (h: Harness): void => {
  const s = h.controller.getState();
  expect(s.phrases).toEqual({ status: 'none', count: 0, saved: [] });
  expect(document.querySelectorAll('#phrase-list li')).toHaveLength(1); // one empty row, as on first load
  expect($<HTMLInputElement>('phrase-1').value).toBe('');
  expect(document.querySelectorAll('#phrase-saved li')).toHaveLength(0);
  expect($('phrase-status').textContent).toBe('');
  const everything = document.documentElement.outerHTML + JSON.stringify(s);
  expect(everything).not.toContain(SECRET);
  expect(everything).not.toContain('An unsent draft about Mum');
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input')].map((i) => i.value).join('|');
  expect(inputs).not.toContain('Mum');
};

describe('N-07: phrases are cleared with the credential', () => {
  it.each([
    ['tv_unpaired'],
    ['room_closed'],
    ['expired'],
  ] as const)('unpaired (%s): state, editor and saved list are emptied', async (reason) => {
    const h = await readyHarness();
    await withPhrases(h);
    h.sockets.current.receive(relayMsg('unpaired', { reason }));
    await flush();
    expect(h.controller.getState().screen).toBe('join');
    expectNothingKept(h);
  });

  it.each(['revoked', 'expired', 'superseded'] as const)('a definitive refusal on resume (%s) clears them too', async (code) => {
    const h = await readyHarness();
    await withPhrases(h);
    h.sockets.current.drop(1006);
    vi.advanceTimersByTime(500);
    h.sockets.current.open();
    h.sockets.current.receive(relayMsg('error', { code, ref_message_id: null, detail: '' }));
    await flush();
    expectNothingKept(h);
  });

  it('"No, cancel" clears whatever was typed (the credential is discarded in the same path)', async () => {
    const h = await acceptedHarness();
    document.body.replaceChildren();
    view = mountView(document.body.appendChild(document.createElement('div')), h.controller);
    type('phrase-1', SECRET); // typed into the (hidden) editor
    h.controller.rejectPairing();
    expectNothingKept(h);
  });

  it('a connection lost before Yes (credential discarded) clears them as well', async () => {
    const h = await acceptedHarness();
    document.body.replaceChildren();
    view = mountView(document.body.appendChild(document.createElement('div')), h.controller);
    type('phrase-1', SECRET);
    h.sockets.current.drop(1006);
    expectNothingKept(h);
  });

  it('nothing from the old pairing reaches the next one: a second pairing starts with an empty editor and a Save sends only new text', async () => {
    const h = await readyHarness();
    await withPhrases(h);
    h.sockets.current.receive(relayMsg('unpaired', { reason: 'tv_unpaired' }));
    await flush();
    h.controller.setCode(CODE);
    h.controller.join();
    h.sockets.current.open();
    h.sockets.current.receive(joinPending());
    h.sockets.current.receive(joinAccepted());
    h.controller.confirmPairing();
    await flush();
    type('phrase-1', 'New household phrase');
    $('save-phrases').click();
    expect(h.sockets.current.last('phrases.update').payload).toEqual({ phrases: ['New household phrase'] });
    expect(JSON.stringify(h.sockets.current.sent)).not.toContain('Okafor');
  });

  it('a save still waiting for its ack when the pairing ends is forgotten, and a late ack cannot bring the phrases back', async () => {
    const h = await readyHarness();
    document.body.replaceChildren();
    view = mountView(document.body.appendChild(document.createElement('div')), h.controller);
    type('phrase-1', SECRET);
    $('save-phrases').click();
    const pending = h.sockets.current.last('phrases.update');
    h.sockets.current.receive(relayMsg('unpaired', { reason: 'room_closed' }));
    await flush();
    expectNothingKept(h);
    // an ack for the old save arrives on the old (closed) connection
    h.sockets.current.receive(tvMsg('ack', { acked_message_id: pending.message_id, outcome: 'applied', detail: '' }, {}));
    expectNothingKept(h);
    expect(h.controller.savePhrases([SECRET]).sent).toBe(false); // no connection, nothing goes out
  });
});

describe('N-07: a discarded session clears them, other endings keep them', () => {
  const endWith = async (h: Harness, reason: string): Promise<void> => {
    h.sockets.current.receive(tvMsg('session.end', { reason }, { s: SESSION }));
    await flush();
  };

  it('session.end discarded: the TV deleted its data, so the phone drops the phrases (and stays paired)', async () => {
    const h = await readyHarness();
    await withPhrases(h);
    const tokenBefore = h.controller.getState().phrasesResetToken;
    await endWith(h, 'discarded');
    expect(h.controller.getState().screen).toBe('setup'); // still paired
    expect(h.controller.getState().phrasesResetToken).toBe(tokenBefore + 1);
    expectNothingKept(h);
  });

  it.each(['completed', 'user_exit', 'error'])('session.end %s keeps the phrases (the household bank outlives a session)', async (reason) => {
    const h = await readyHarness();
    await withPhrases(h);
    await endWith(h, reason);
    expect(h.controller.getState().phrases).toMatchObject({ status: 'saved', saved: [SECRET] });
    expect($<HTMLInputElement>('phrase-1').value).toBe(SECRET);
    expect($<HTMLInputElement>('phrase-2').value).toBe('An unsent draft about Mum');
    expect(document.querySelectorAll('#phrase-saved li')).toHaveLength(1);
  });

  it('a discarded end for a session the phone does not know changes nothing', async () => {
    const h = await readyHarness();
    await withPhrases(h);
    h.sockets.current.receive(tvMsg('session.end', { reason: 'discarded' }, { s: SESSION2 }));
    await flush();
    expect(h.controller.getState().phrases.saved).toEqual([SECRET]);
  });

  it('the TV acknowledges nothing here: the phone clears on its own, even if the ack for session.end could not be sent', async () => {
    const h = await readyHarness();
    await withPhrases(h);
    const end = tvMsg('session.end', { reason: 'discarded' }, { s: SESSION });
    h.sockets.current.receive(end);
    await flush();
    const ack = h.sockets.current.messages('ack').find((a) => a.payload['acked_message_id'] === lastMessageId(end));
    expect(ack?.payload['outcome']).toBe('applied');
    expect(h.controller.getState().phrases.saved).toEqual([]);
  });

  it('the reset only empties the editor once per clear: typing afterwards is not wiped by the next render', async () => {
    const h = await readyHarness();
    await withPhrases(h);
    await endWith(h, 'discarded');
    type('phrase-1', 'Typed after the reset');
    h.audio.setState('permission_denied'); // an unrelated state change re-renders the page
    advanceLive(h, 1000, () => relayMsg('pong', { server_time: 1 }));
    expect($<HTMLInputElement>('phrase-1').value).toBe('Typed after the reset');
    h.sockets.current.receive(sessionBegin());
  });
});
