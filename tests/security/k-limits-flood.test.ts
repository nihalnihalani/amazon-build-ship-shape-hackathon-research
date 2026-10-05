/**
 * T16 gate, part K: message-rate limits, the cue cap, and a mutation fuzz of the receiver validator.
 *
 *   SEC-V07  phone 40/s (burst 60) and TV 20/s (burst 40) per connection: rate_limited, then close 4429 after the strike limit
 *   SEC-T08  relay cue cap (3 per session, tied to the session the TV announced); a cue for another session is not delivered
 *   SEC-V08  mutation fuzz of parseWireMessage: never throws, bounded time, no prototype pollution, no echo of input in `detail`
 *
 * Evidence class: automated (local relay over TLS with raw sockets; the validator in-process).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MESSAGE_TYPES, parseWireMessage, type MessageType } from '@atr/protocol';
import { RawClient, envelope, mid, pairRaw, samplePayload, sleep, startSecRelay, type Msg, type SecRelay } from './helpers.js';

let relay: SecRelay;
beforeAll(async () => {
  relay = await startSecRelay();
}, 60_000);
afterAll(async () => {
  await relay?.stop();
});

const errors = (c: RawClient): Msg[] => c.inbox.filter((m) => m.type === 'error');

describe('SEC-V07 per-connection message rate', () => {
  it('a phone that floods 400 pings in a burst is answered for about the first 60, then refused with rate_limited, and is closed with 4429 after the strike limit; the TV is unaffected', async () => {
    const p = await pairRaw(relay, 'flooding phone');
    for (let i = 0; i < 400; i += 1) p.phone.send('ping');
    const closed = await p.phone.client.waitClosed(15_000);
    expect(closed.code).toBe(4429);
    const limited = errors(p.phone.client).filter((m) => m.payload['code'] === 'rate_limited');
    const pongs = p.phone.client.inbox.filter((m) => m.type === 'pong').length;
    expect(limited.length).toBeGreaterThanOrEqual(100);
    expect(pongs).toBeGreaterThanOrEqual(40);
    expect(pongs).toBeLessThanOrEqual(70);
    // the answer to a flood is the same generic text and carries no state about the peer
    expect(JSON.stringify(limited[0]?.payload)).not.toMatch(/credential|room|code":"unauth/);
    // the TV neither lost its connection nor received anything the phone flooded
    expect(p.tv.client.isOpen).toBe(true);
    expect(p.tv.client.inbox.filter((m) => m.type === 'ping' || m.type === 'pong')).toHaveLength(0);
    p.tv.client.close();
  }, 60_000);

  it('the TV has the lower budget: its burst limit is 40 per second', async () => {
    const p = await pairRaw(relay, 'tv flood');
    for (let i = 0; i < 90; i += 1) p.tv.send('ping');
    await sleep(1500);
    const pongs = p.tv.client.inbox.filter((m) => m.type === 'pong').length;
    const limited = errors(p.tv.client).filter((m) => m.payload['code'] === 'rate_limited').length;
    expect(pongs).toBeGreaterThanOrEqual(30);
    expect(pongs).toBeLessThanOrEqual(45);
    expect(limited).toBeGreaterThanOrEqual(40);
    expect(pongs + limited).toBe(90);
    p.tv.client.close();
    p.phone.client.close();
  }, 60_000);
});

describe('SEC-T08 relay cue cap', () => {
  it('three cues per announced session reach the TV; the fourth is refused with cue_limit and not delivered; a cue for another session id is not delivered either', async () => {
    const p = await pairRaw(relay, 'cue phone');
    const session = 's_seccuesession1';
    // the TV announces the session (the relay learns the active session id from it)
    p.tv.send('session.begin', { family_mode: false, phrase_count: 3, cues_max: 3 }, { session_id: session });
    await p.phone.client.next('session.begin');
    const cueIds: string[] = [];
    for (let i = 0; i < 4; i += 1) cueIds.push(p.phone.send('cue', { text: `cue ${i + 1}` }, { session_id: session }));
    await p.phone.client.waitUntil(() => errors(p.phone.client).length >= 1, 5000, 'cue_limit error');
    const err = errors(p.phone.client)[0] as Msg;
    expect(err.payload['code']).toBe('cue_limit');
    await sleep(400);
    const delivered = p.tv.client.inbox.filter((m) => m.type === 'cue');
    expect(delivered.map((m) => m.payload['text'])).toEqual(['cue 1', 'cue 2', 'cue 3']);

    // a made-up session id is not the announced one: nothing is delivered and the cap is not reset by it
    const before = p.tv.client.inbox.length;
    const errBefore = errors(p.phone.client).length;
    p.phone.send('cue', { text: 'cue under another session' }, { session_id: 's_secinvented001' });
    await p.phone.client.waitUntil(() => errors(p.phone.client).length > errBefore, 5000, 'error for the invented session');
    expect(p.tv.client.inbox.slice(before).filter((m) => m.type === 'cue')).toHaveLength(0);
    // after the announced session is replaced, a new session has a fresh budget of its own
    p.tv.send('session.begin', { family_mode: false, phrase_count: 3, cues_max: 3 }, { session_id: 's_seccuesession2' });
    await p.phone.client.waitUntil(() => p.phone.client.inbox.filter((m) => m.type === 'session.begin').length >= 2, 5000, 'second session.begin');
    p.phone.send('cue', { text: 'fresh budget' }, { session_id: 's_seccuesession2' });
    await p.tv.client.waitUntil(() => p.tv.client.inbox.some((m) => m.type === 'cue' && m.payload['text'] === 'fresh budget'), 5000, 'cue in the new session');
    expect(cueIds).toHaveLength(4);
    p.tv.client.close();
    p.phone.client.close();
  }, 60_000);
});

describe('SEC-V08 mutation fuzz of the receiver validator', () => {
  const MARKER = 'ZQMARKERZQ7731';
  const BASES = MESSAGE_TYPES.map((type) => {
    const env = envelope(type as MessageType, { role: 'phone', roomId: 'r_' + 'a'.repeat(21) });
    // plant a marker in every string leaf of the payload so an echo in `detail` would be visible
    const planted = JSON.parse(JSON.stringify(env, (k, v) => (k === 'payload' ? v : v))) as Record<string, unknown>;
    const payload = planted['payload'] as Record<string, unknown>;
    for (const key of Object.keys(payload)) if (typeof payload[key] === 'string' && key !== 'role') payload[key] = `${MARKER}${String(payload[key])}`;
    return JSON.stringify(planted);
  });
  const SNIPPETS = ['__proto__', '{"__proto__":{"polluted":1}}', 'constructor', '"prototype"', '1e999', '-0', '[[[[[[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]]]]]', '\\u0000', '\\ud800', '\\u202e', 'null', 'true', '{}', '[]', '9007199254740993', '"' + 'x'.repeat(300) + '"', ',,', '":', '{"a":'];

  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  function mutate(base: string, r: () => number): string {
    let s = base;
    const rounds = 1 + Math.floor(r() * 4);
    for (let k = 0; k < rounds; k += 1) {
      const pos = Math.floor(r() * (s.length + 1));
      switch (Math.floor(r() * 8)) {
        case 0:
          s = s.slice(0, pos) + s.slice(pos + 1 + Math.floor(r() * 4));
          break;
        case 1:
          s = s.slice(0, pos) + String.fromCharCode(Math.floor(r() * 0xffff)) + s.slice(pos);
          break;
        case 2:
          s = s.slice(0, pos);
          break;
        case 3:
          s = s.slice(0, pos) + (SNIPPETS[Math.floor(r() * SNIPPETS.length)] as string) + s.slice(pos);
          break;
        case 4: {
          const a = Math.floor(r() * s.length);
          const b = Math.min(s.length, a + 1 + Math.floor(r() * 40));
          s = s.slice(0, b) + s.slice(a, b) + s.slice(b);
          break;
        }
        case 5:
          s = s.slice(0, pos) + String(Math.floor(r() * 2 ** 32) - 2 ** 31) + s.slice(pos);
          break;
        case 6:
          s = s.replace(/"([a-z_]+)":/, `"$1":${r() < 0.5 ? '[' : '{"x":'}`);
          break;
        default:
          s = s.slice(0, pos) + s.charAt(Math.floor(r() * s.length)) + s.slice(pos);
      }
    }
    return s;
  }

  it('1,000,000 mutated frames: no exception, no parse over 25 ms, nothing polluted, no input echoed in `detail`, accepted frames still satisfy the size limit', () => {
    const r = rng(20261005);
    const total = 1_000_000;
    let accepted = 0;
    let slowest = 0;
    let slowestAt = '';
    const outcomes = new Map<string, number>();
    for (let i = 0; i < total; i += 1) {
      const frame = mutate(BASES[Math.floor(r() * BASES.length)] as string, r);
      const t0 = performance.now();
      const res = parseWireMessage(frame);
      const dt = performance.now() - t0;
      if (dt > slowest) {
        slowest = dt;
        slowestAt = frame.slice(0, 120);
      }
      if (res.ok) {
        accepted += 1;
        expect(Buffer.byteLength(JSON.stringify(res.message))).toBeLessThanOrEqual(8192);
      } else {
        outcomes.set(res.code, (outcomes.get(res.code) ?? 0) + 1);
        if (res.detail.includes(MARKER) || res.detail.includes('__proto__') || res.detail.length > 120) throw new Error(`detail echoes input or is long: ${JSON.stringify(res.detail)} for ${frame.slice(0, 160)}`);
        if (res.ref_message_id !== null && !/^m_[A-Za-z0-9_-]{16,}$/.test(res.ref_message_id)) throw new Error(`ref_message_id echoes input: ${res.ref_message_id}`);
      }
      if (dt > 25) throw new Error(`parse took ${dt.toFixed(1)} ms for ${frame.slice(0, 160)}`);
    }
    console.log('SEC-V08 fuzz:', JSON.stringify({ total, accepted, slowest_ms: Number(slowest.toFixed(3)), slowest_frame_prefix: slowestAt, outcomes: Object.fromEntries(outcomes) }));
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(total);
  }, 600_000);
});

void samplePayload;
void mid;
