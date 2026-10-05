/**
 * T16 gate, slow opt-in check of the phone's session capture budget (N-12), in real time: about 5.5 minutes.
 * Run with: npx vitest run --config security/vitest.slow.config.ts   (from tests/)
 *
 * The phone refuses a window that would take a session past 5 minutes of cumulative capture (detail `budget`). The
 * unit tests of the phone package prove this with a fake clock; this drives the real page with real audio frames.
 *
 * It also records the limit of that control (R26): the budget belongs to the session id the TV announces, so a TV that
 * announces a new session id starts a new budget. The budget bounds a runaway session, not a hostile paired TV.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { buildArtifacts, startPhone, type PhoneEnv } from '../../src/e2e-env.js';
import { Peer, ROOT, createRoom, sleep, startSecRelay, type Msg, type SecRelay } from '../helpers.js';

let relay: SecRelay;
let phone: PhoneEnv;

beforeAll(async () => {
  buildArtifacts();
  relay = await startSecRelay({ staticDir: path.join(ROOT, 'apps/phone/dist-test') });
  phone = await startPhone();
}, 240_000);
afterAll(async () => {
  await phone?.close();
  await relay?.stop();
});

function keepAlive(tv: Peer): () => void {
  const h = setInterval(() => {
    if (tv.client.isOpen) tv.send('ping');
  }, 8000);
  return () => clearInterval(h);
}

describe('N-12 budget in real time (slow, opt-in)', () => {
  it('ten vowel windows of 30 s use the 5 minutes; the next command is refused with `budget` and the person is told once; a TV-announced new session id starts a new budget (R26)', async () => {
    const { page } = phone;
    const { tv, code } = await createRoom(relay);
    const stopPing = keepAlive(tv);
    const accept = (async () => {
      const req = await tv.client.next('join.requested', 30_000);
      tv.send('join.confirm', { join_id: String(req.payload['join_id']), decision: 'accept' });
    })();
    await page.goto(`${relay.origin}/#code=${code}`);
    await page.click('#join');
    await accept;
    await page.waitForSelector('#confirm-yes', { state: 'visible', timeout: 15_000 });
    await page.click('#confirm-yes');
    await page.waitForSelector('#start-mic', { state: 'visible' });
    await page.click('#start-mic');
    await page.waitForFunction(() => document.querySelector('#mic-badge')?.textContent?.includes('Mic open, not measuring'));
    const sessionA = 's_secbudgeta001';
    tv.send('session.begin', { family_mode: false, phrase_count: 3, cues_max: 3 }, { session_id: sessionA });
    await sleep(500);

    const outcomes: string[] = [];
    const results: number[] = [];
    let refusedAt = -1;
    for (let i = 0; i < 13 && refusedAt < 0; i += 1) {
      const ids = { session_id: sessionA, window_id: `w_secbudg${String(i).padStart(4, '0')}`, attempt_id: `a_secbudg${String(i).padStart(4, '0')}` };
      const from = tv.client.inbox.length;
      const startId = tv.send('window.start', { kind: 'vowel', phrase_position: null, max_duration_ms: 30_000, vad_floor_dbfs: -60 }, ids);
      await tv.client.waitUntil(() => tv.client.inbox.slice(from).some((m) => m.type === 'ack' && m.payload['acked_message_id'] === startId), 8000, `ack for window ${i}`);
      const ack = tv.client.inbox.slice(from).find((m) => m.type === 'ack' && m.payload['acked_message_id'] === startId) as Msg;
      outcomes.push(`${String(ack.payload['outcome'])}:${String(ack.payload['detail'])}`);
      if (ack.payload['outcome'] !== 'applied') {
        refusedAt = i;
        break;
      }
      const result = await tv.client.next('window.result', 45_000, from);
      results.push(Number(result.payload['duration_ms']));
      await sleep(1200); // stay clear of the 1 s cooldown
    }
    console.log('N-12 budget (real time): outcomes', JSON.stringify(outcomes), 'window durations (ms)', JSON.stringify(results));
    expect(refusedAt, 'a window must be refused for budget within 12 attempts').toBeGreaterThanOrEqual(9);
    expect(outcomes[refusedAt]).toBe('rejected:budget');
    expect(outcomes.slice(0, refusedAt).every((o) => o === 'applied:')).toBe(true);
    expect(results.reduce((a, b) => a + b, 0)).toBeGreaterThan(270_000); // it really was minutes of capture
    expect(await page.innerText('body')).toMatch(/5 minutes of listening/);
    // refused windows measured nothing, and prechecks count against the same budget
    const preId = tv.send('precheck.start', { purpose: 'quiet_check', duration_ms: 5000 }, { session_id: sessionA, window_id: 'w_secbudgpre01', attempt_id: 'a_secbudgpre01' });
    await tv.client.waitUntil(() => tv.client.inbox.some((m) => m.type === 'ack' && m.payload['acked_message_id'] === preId), 8000, 'ack for the precheck');
    const preAck = tv.client.inbox.find((m) => m.type === 'ack' && m.payload['acked_message_id'] === preId) as Msg;
    expect(`${String(preAck.payload['outcome'])}:${String(preAck.payload['detail'])}`).toBe('rejected:budget');

    // R26: the TV announces a different session id and the phone starts a new budget.
    const sessionB = 's_secbudgetb001';
    tv.send('session.begin', { family_mode: false, phrase_count: 3, cues_max: 3 }, { session_id: sessionB });
    await sleep(500);
    const from = tv.client.inbox.length;
    const again = tv.send('window.start', { kind: 'vowel', phrase_position: null, max_duration_ms: 1000, vad_floor_dbfs: -60 }, { session_id: sessionB, window_id: 'w_secbudgb0001', attempt_id: 'a_secbudgb0001' });
    await tv.client.waitUntil(() => tv.client.inbox.slice(from).some((m) => m.type === 'ack' && m.payload['acked_message_id'] === again), 8000, 'ack in the new session');
    const ack2 = tv.client.inbox.slice(from).find((m) => m.type === 'ack' && m.payload['acked_message_id'] === again) as Msg;
    console.log('R26: first window of a TV-announced new session after the budget was used up:', JSON.stringify(ack2.payload));
    expect(ack2.payload['outcome']).toBe('applied');
    stopPing();
    tv.client.close();
  }, 480_000);
});
