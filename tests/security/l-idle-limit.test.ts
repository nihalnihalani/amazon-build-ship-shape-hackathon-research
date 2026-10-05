/**
 * T16 gate, part L: the phone's idle microphone limit (N-12), black box on the real page with the page clock.
 *
 * `page.clock` (Playwright) fast-forwards the page's timers, so the 10-minute limit is exercised in seconds of real time.
 * The relay and the raw TV run on the real clock; only the phone page's timers jump.
 *
 *   - the microphone stays open for 9 minutes without a TV command and is switched off after 10, with the plain message
 *   - a command that starts a measurement (precheck.start, window.start) restarts the 10 minutes
 *   - R26 (closed): session.state and other housekeeping commands do not, so a TV that sends one harmless command
 *     every 9 minutes can no longer keep the microphone open
 *
 * Evidence class: automated (desktop Chrome, synthetic audio build, local relay, raw TV socket).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { buildArtifacts, startPhone, type PhoneEnv } from '../src/e2e-env.js';
import { Peer, ROOT, createRoom, sleep, startSecRelay, type Msg, type SecRelay } from './helpers.js';

const SESSION = 's_secidle000001';
const IDLE_TEXT = 'The microphone was turned off after 10 minutes without a request from the TV. Tap Start microphone to use it again.';

let relay: SecRelay;
let phone: PhoneEnv;
let tv: Peer;
let stopPing: () => void = () => undefined;

beforeAll(async () => {
  buildArtifacts();
  relay = await startSecRelay({ staticDir: path.join(ROOT, 'apps/phone/dist-test') });
  phone = await startPhone();
  const { page } = phone;
  await page.clock.install(); // before the page loads, so every timer of the page is on the fake clock
  const room = await createRoom(relay);
  tv = room.tv;
  const h = setInterval(() => {
    if (tv.client.isOpen) tv.send('ping');
  }, 8000);
  stopPing = () => clearInterval(h);
  const accept = (async () => {
    const req = await tv.client.next('join.requested', 30_000);
    tv.send('join.confirm', { join_id: String(req.payload['join_id']), decision: 'accept' });
  })();
  await page.goto(`${relay.origin}/#code=${room.code}`);
  await page.click('#join');
  await accept;
  await page.waitForSelector('#confirm-yes', { state: 'visible', timeout: 15_000 });
  await page.click('#confirm-yes');
  await page.waitForSelector('#start-mic', { state: 'visible' });
  await page.click('#start-mic');
  await page.waitForFunction(() => document.querySelector('#mic-badge')?.textContent?.includes('Mic open, not measuring'));
  tv.send('session.begin', { family_mode: false, phrase_count: 3, cues_max: 3 }, { session_id: SESSION });
  await sleep(500);
}, 300_000);

afterAll(async () => {
  stopPing();
  tv?.client.close();
  await phone?.close();
  await relay?.stop();
});

/** Fast-forwards the page clock in 10 s steps (the page's own heartbeat keeps running) and waits a moment for traffic. */
async function forward(minutes: number): Promise<void> {
  const steps = Math.round((minutes * 60) / 10);
  for (let i = 0; i < steps; i += 1) {
    await phone.page.clock.fastForward(10_000);
    await sleep(40);
  }
  await sleep(300);
}
const badge = (): Promise<string> => phone.page.textContent('#mic-badge').then((t) => t ?? '');

async function tvCommand(): Promise<Msg> {
  const from = tv.client.inbox.length;
  const id = tv.send('session.state', { stage: 'idle', phrase_position: 0, cues_used: 0, listener_open_attempt: null }, { session_id: SESSION });
  await tv.client.waitUntil(() => tv.client.inbox.slice(from).some((m) => m.type === 'ack' && m.payload['acked_message_id'] === id), 8000, 'ack for the TV command');
  return tv.client.inbox.slice(from).find((m) => m.type === 'ack' && m.payload['acked_message_id'] === id) as Msg;
}

let measurementCounter = 0;
/** A measurement the phone accepts: window.start, then window.cancel straight away so nothing keeps running. */
async function startMeasurement(): Promise<Msg> {
  measurementCounter += 1;
  const tag = String(measurementCounter).padStart(4, '0');
  const ids = { session_id: SESSION, window_id: `w_secidle${tag}`, attempt_id: `a_secidle${tag}` };
  const from = tv.client.inbox.length;
  const id = tv.send('window.start', { kind: 'vowel', phrase_position: null, max_duration_ms: 20_000, vad_floor_dbfs: -60 }, ids);
  await tv.client.waitUntil(() => tv.client.inbox.slice(from).some((m) => m.type === 'ack' && m.payload['acked_message_id'] === id), 8000, 'ack for the window.start');
  const ack = tv.client.inbox.slice(from).find((m) => m.type === 'ack' && m.payload['acked_message_id'] === id) as Msg;
  tv.send('window.cancel', { reason: 'user_cancel' }, ids);
  await sleep(300);
  return ack;
}

describe('N-12 idle microphone limit (page clock)', () => {
  it('the microphone is still open after 9 minutes without a TV command, and is switched off by 10 with the message; the link and the pairing stay', async () => {
    await forward(9);
    expect(await badge()).toMatch(/Mic open/);
    await forward(1.5);
    expect(await badge()).toBe('Mic off');
    const text = (await phone.page.innerText('body')).replace(/\s+/g, ' ');
    expect(text).toContain(IDLE_TEXT);
    expect(await phone.page.isVisible('#view-setup')).toBe(true); // still paired
    expect(await phone.page.textContent('#link')).toMatch(/Connected/);
    expect(await phone.page.isVisible('#start-mic')).toBe(true); // and the person can start it again
  });

  it('a measurement command the phone accepts restarts the 10 minutes: a window.start at minute 9 keeps it open at minute 18 and it goes off by minute 20', async () => {
    await phone.page.click('#start-mic');
    await phone.page.waitForFunction(() => document.querySelector('#mic-badge')?.textContent?.includes('Mic open'));
    expect((await phone.page.innerText('body')).replace(/\s+/g, ' ')).not.toContain(IDLE_TEXT); // starting it again clears the message
    await forward(9);
    expect((await startMeasurement()).payload['outcome']).toBe('applied');
    await forward(9);
    expect(await badge()).toMatch(/Mic open/);
    await forward(1.5);
    expect(await badge()).toBe('Mic off');
  });

  it('R26 (closed): a TV that sends one session.state every 9 minutes does not keep the microphone open: it is off by minute 10', async () => {
    await phone.page.click('#start-mic');
    await phone.page.waitForFunction(() => document.querySelector('#mic-badge')?.textContent?.includes('Mic open'));
    await forward(9);
    expect((await tvCommand()).payload['outcome']).toBeDefined(); // acknowledged, but it is housekeeping
    expect(await badge()).toMatch(/Mic open/);
    await forward(1.5); // 10.5 minutes since the microphone opened
    expect(await badge()).toBe('Mic off');
    expect((await phone.page.innerText('body')).replace(/\s+/g, ' ')).toContain(IDLE_TEXT);
  });
});
