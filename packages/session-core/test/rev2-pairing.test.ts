/**
 * docs/adr/AMENDMENTS-REV2.md: A3-06 number matching, A3-07 phone supersede and credential rotation,
 * the vad_floor guard (protocol revision 4), and PK-09 (raw text frames only).
 */

import { describe, expect, it } from 'vitest';
import type { TvView } from '../src/index.js';
import { buildChoices } from '../src/matching.js';
import { Machine } from '../src/machine.js';
import { nfcSelfTest } from '../src/store.js';
import { CREDENTIAL, NEXT_CREDENTIAL, PAIRING_CODE, ROOM, T0, boot, seededBytes } from './helpers.js';
import type { Harness } from './helpers.js';

async function joinScreen(seed: number, digits = '47', label = 'Rohan phone'): Promise<{ h: Harness; view: TvView }> {
  const h = await boot({ randomSeed: seed });
  h.ui('start_session');
  h.transportState('connected');
  h.roomCreated();
  h.joinRequested(label, digits);
  return { h, view: h.view };
}

describe('A3-06 number matching', () => {
  it('shows three distinct two-digit choices (the real digits and two decoys), Reject preferred, no real-digit field', async () => {
    const { h, view } = await joinScreen(7);
    expect(view.screen).toBe('join_confirm');
    const join = view.pairing?.joinRequest;
    expect(join?.choices).toHaveLength(3);
    expect(new Set(join?.choices).size).toBe(3);
    expect(join?.choices.filter((c) => c === '47')).toHaveLength(1);
    expect(view.preferredAction).toBe('reject_join');
    expect(view.actions.map((a) => a.id)).toEqual(['pick_choice_1', 'pick_choice_2', 'pick_choice_3', 'reject_join']);
    expect(view.actions.slice(0, 3).map((a) => a.label)).toEqual(join?.choices);
    expect(Object.keys(join ?? {}).sort()).toEqual(['choices', 'deviceLabel']);
    expect(JSON.stringify(view)).not.toMatch(/confirm_?digits/i);
    expect(view.body.join(' ')).toContain('Pick the number shown on the phone');
    expect(view.body.join(' ')).toContain('Name the phone gave: Rohan phone');
    // remote OK on this screen is Reject: the default focus can never admit a phone
    h.ok();
    expect(h.last('join.confirm').payload).toEqual({ join_id: 'j_testjoin000001', decision: 'reject' });
  });

  it('the correct pick accepts; the phone then connects and pairing continues', async () => {
    const { h } = await joinScreen(11);
    h.acceptJoin();
    expect(h.last('join.confirm').payload).toEqual({ join_id: 'j_testjoin000001', decision: 'accept' });
    expect(h.of('join.confirm')).toHaveLength(1);
    h.peerState(true);
    expect(h.view.stage).toBe('permission_pending');
  });

  it('a wrong pick rejects, says so, burns the code and waits for the fresh pairing.code', async () => {
    const { h, view } = await joinScreen(13);
    const wrong = view.actions.findIndex((a, i) => i < 3 && a.label !== '47');
    expect(wrong).toBeGreaterThanOrEqual(0);
    h.ui(`pick_choice_${wrong + 1}` as 'pick_choice_1');
    expect(h.last('join.confirm').payload).toEqual({ join_id: 'j_testjoin000001', decision: 'reject' });
    expect(h.of('join.confirm')).toHaveLength(1);
    expect(h.view.screen).toBe('pairing');
    expect(h.view.banner?.text).toBe('That number did not match. Pair again.');
    // the dead code is not shown or offered in the QR while the relay issues a new one
    expect(h.view.pairing?.code).toBeNull();
    expect(h.view.pairing?.qrPayload).toBeNull();
    expect(h.view.body.join(' ')).toContain('Getting a new code');
    expect(JSON.stringify(h.view)).not.toContain(PAIRING_CODE);
    h.pairingCode('WXY347');
    expect(h.view.pairing?.code).toBe('WXY347');
    expect(h.view.pairing?.qrPayload).toBe('https://relay.example.test/#code=WXY347');
    // a later correct join works
    h.joinRequested('Rohan phone', '82', 'j_testjoin000002');
    h.acceptJoin();
    expect(h.last('join.confirm').payload).toEqual({ join_id: 'j_testjoin000002', decision: 'accept' });
  });

  it('an explicit Reject and Back both reject and burn the code', async () => {
    const a = await joinScreen(17);
    a.h.ui('reject_join');
    expect(a.h.last('join.confirm').payload).toMatchObject({ decision: 'reject' });
    expect(a.h.view.pairing?.code).toBeNull();
    const b = await joinScreen(19);
    b.h.back();
    expect(b.h.last('join.confirm').payload).toMatchObject({ decision: 'reject' });
    expect(b.h.view.pairing?.code).toBeNull();
  });

  it('the device label is untrusted text: shown literally in the "Name the phone gave" line only', async () => {
    const { view } = await joinScreen(23, '47', '<b>Mom</b> & "phone"');
    expect(view.pairing?.joinRequest?.deviceLabel).toBe('<b>Mom</b> & "phone"');
    expect(view.body).toContain('Name the phone gave: <b>Mom</b> & "phone"');
    expect(view.title).not.toContain('Mom');
    expect(view.announcement).toContain('Name the phone gave:');
  });

  it('choices: the right answer is uniformly placed and decoys are uniformly drawn across seeds', async () => {
    const position = [0, 0, 0];
    const decoys = new Map<string, number>();
    for (let seed = 1; seed <= 300; seed += 1) {
      const choices = buildChoices('47', seededBytes(seed));
      expect(new Set(choices).size).toBe(3);
      position[choices.indexOf('47')] = (position[choices.indexOf('47')] ?? 0) + 1;
      for (const c of choices) if (c !== '47') decoys.set(c, (decoys.get(c) ?? 0) + 1);
    }
    for (const n of position) expect(n).toBeGreaterThan(60); // expected 100 each
    expect(decoys.size).toBeGreaterThan(70); // 99 possible decoys, 600 draws
    expect(decoys.has('47')).toBe(false);
    for (const real of ['00', '07', '99', '10']) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const c = buildChoices(real, seededBytes(seed));
        expect(new Set(c).size).toBe(3);
        expect(c).toContain(real);
        for (const x of c) expect(x).toMatch(/^[0-9]{2}$/);
      }
    }
  });

  it('draws are unbiased: bytes at or above 200 are discarded, so every decoy value is equally likely', () => {
    // a byte source that offers 250..255 first would bias a modulo draw towards 50..55
    const queue = [250, 251, 252, 253, 254, 255, 17, 33, 1, 2, 0, 0, 0, 0, 0, 0];
    let i = 0;
    const source = (n: number): Uint8Array => {
      const out = new Uint8Array(n);
      for (let k = 0; k < n; k += 1) out[k] = queue[i++ % queue.length] as number;
      return out;
    };
    const choices = buildChoices('47', source);
    expect(choices).toContain('17');
    expect(choices).toContain('33');
    for (const biased of ['50', '51', '52', '53', '54', '55']) expect(choices).not.toContain(biased);
  });

  it('survives a degenerate byte source with distinct decoys and uses deps.randomBytes when provided', async () => {
    const zeros = (n: number) => new Uint8Array(n);
    const c = buildChoices('00', zeros);
    expect(new Set(c).size).toBe(3);
    expect(c).toContain('00');
    const empty = buildChoices('47', () => new Uint8Array(0));
    expect(new Set(empty).size).toBe(3);

    let calls = 0;
    const seeded = seededBytes(5);
    const h = await boot({
      randomBytes: (n) => {
        calls += 1;
        return seeded(n);
      },
    });
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    const before = calls;
    h.joinRequested();
    expect(calls).toBeGreaterThan(before); // number matching draws from deps.randomBytes
    expect(new Set(h.view.pairing?.joinRequest?.choices).size).toBe(3);
  });

  it('counts mismatches in diagnostics', async () => {
    const { h, view } = await joinScreen(29);
    const wrong = view.actions.findIndex((a, i) => i < 3 && a.label !== '47');
    h.ui(`pick_choice_${wrong + 1}` as 'pick_choice_1');
    h.ui('cancel'); // leave pairing for Home
    h.ui('open_settings');
    h.ui('open_diagnostics');
    expect(h.view.diagnostics?.join_mismatches).toBe('1');
  });
});

describe('A3-07 phone supersede and credential rotation', () => {
  it('a new phone generation cancels an open window (unscored), shows "Phone reconnected" and makes the mic unknown', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    const start = h.last('window.start');
    expect(h.view.mic).toBe('open_not_measuring');
    h.peerState(true, 2); // the relay says a different connection now speaks for the phone
    expect(h.last('window.cancel')).toMatchObject({ window_id: start.window_id });
    expect(h.last('window.cancel').payload).toEqual({ reason: 'interrupted' });
    expect(h.view.stage).toBe('paused_or_invalid');
    expect(h.view.banner?.text).toBe('Phone reconnected.');
    expect(h.view.body.join(' ')).toContain('The phone reconnected, so the window was not scored.');
    expect(h.view.mic).toBe('unknown');
    expect(h.view.actions.find((a) => a.id === 'retry')?.disabled).toBe(true);
    h.answerWindow({ rel: 25 }, start); // a late result from the replaced connection
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    h.micState('open_idle');
    h.ui('retry');
    h.runPhrase({});
    expect(h.view.stage).toBe('reveal');
    h.ui('finish_early');
    expect(h.view.summary?.invalidReasons).toEqual({ interrupted: 1 });
  });

  it('with no window open it only announces the reconnect; the first join and a repeated generation are silent', async () => {
    const h = await boot();
    h.setupToPhrases();
    expect(h.view.banner?.text).not.toBe('Phone reconnected.');
    h.peerState(true, 1); // same generation again: nothing new
    expect(h.view.banner?.text).not.toBe('Phone reconnected.');
    h.peerState(true, 3);
    expect(h.view.banner?.text).toBe('Phone reconnected.');
    expect(h.view.stage).toBe('phrase_ready');
    expect(h.view.mic).toBe('unknown');
    h.micState('open_idle');
    // a normal drop and return with a new generation is also a reconnect
    h.peerState(false, 3);
    h.peerState(true, 4);
    expect(h.view.banner?.text).toBe('Phone reconnected.');
  });

  it('stores the rotated credential in memory and presents it on the next resume', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    h.joinRequested();
    h.acceptJoin();
    h.peerState(true);
    h.transportState('reconnecting');
    h.transportState('connected');
    expect(h.last('auth.resume').payload).toEqual({ room_id: ROOM, role: 'tv', credential: CREDENTIAL }); // from room.created
    h.authOk({ generation: 2, next: 'A'.repeat(43) });
    h.transportState('reconnecting');
    h.transportState('connected');
    expect(h.last('auth.resume').payload).toEqual({ room_id: ROOM, role: 'tv', credential: 'A'.repeat(43) });
    h.authOk({ generation: 3, next: 'B'.repeat(43) });
    h.transportState('reconnecting');
    h.transportState('connected');
    expect(h.last('auth.resume').payload.credential).toBe('B'.repeat(43));
    // never in a view, never in storage, never in any other message
    h.authOk({ generation: 4, next: 'C'.repeat(43) });
    for (const secret of [CREDENTIAL, 'A'.repeat(43), 'B'.repeat(43), 'C'.repeat(43), NEXT_CREDENTIAL]) {
      expect(JSON.stringify(h.views)).not.toContain(secret);
      expect(JSON.stringify(h.storage.dump())).not.toContain(secret);
      for (const m of h.transport.sent) if (m.type !== 'auth.resume') expect(m.raw).not.toContain(secret);
    }
    await h.flush();
    expect(JSON.stringify(h.storage.dump())).not.toContain('credential');
  });

  it('a revoked role (a consumed credential was presented) says the pairing may be compromised and goes back to pairing', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    const start = h.last('window.start');
    const sessionId = h.last('session.begin').session_id;
    h.relayError('revoked');
    expect(h.view.stage).toBe('pairing');
    expect(h.view.banner?.text).toBe('Pairing may be compromised. Pair again.');
    expect(h.view.banner?.kind).toBe('error');
    expect(h.view.mic).toBe('not_paired');
    expect(h.view.pairing?.code).toBeNull();
    expect(h.transport.closes).toContain('revoked');
    // the open window is unscored and the old floor and band are gone
    h.answerWindow({ rel: 25 }, start);
    expect(h.of('ack').filter((m) => (m.payload as { outcome: string }).outcome === 'applied').length).toBeGreaterThan(0);
    expect(h.transport.connects).toHaveLength(2);
    h.transportState('connected');
    expect(h.last('room.create').payload).toMatchObject({ client: { platform: 'test' } });
    h.roomCreated({ generation: 1 });
    h.joinRequested('New phone', '31', 'j_testjoin000009');
    h.acceptJoin();
    h.peerState(true);
    expect(h.view.stage).toBe('permission_pending');
    expect(h.last('session.begin').session_id).toBe(sessionId); // the same session continues with the new phone
    h.micState('open_idle');
    expect(h.view.stage).toBe('quiet_check'); // a new phone gets a new quiet check and band
    h.runQuiet();
    h.runCalibration(18);
    h.ui('continue');
    h.ui('skip_vowel');
    expect(h.view.phrase?.attemptNumber).toBeGreaterThanOrEqual(1);
  });

  it('with no session and not pairing, a lost pairing only reports it', async () => {
    const h = await boot();
    h.pairOnly();
    h.relayError('unauthorized');
    expect(h.view.screen).toBe('home');
    expect(h.view.banner?.text).toBe('The pairing with the relay was lost. Pair again.');
  });
});

describe('vad floor guard (protocol revision 4: window.start.vad_floor_dbfs is -110 .. -30)', () => {
  function readyMachine(): Machine {
    const t = T0;
    const m = new Machine({
      now: () => t,
      localDate: (ms) => new Date(ms).toISOString().slice(0, 10),
      newId: (prefix) => `${prefix}${String(Math.floor(Math.random() * 1e15)).padStart(16, '0')}`,
      randomBytes: seededBytes(1),
      nfcSelfTest: () => true,
      relayUrl: 'https://relay.example.test/ws',
      appVersion: 't',
      platform: 'test',
      fixtureMode: false,
    });
    m.handle({ kind: 'internal', event: { type: 'loaded', data: {
      status: 'ok', futureVersion: null, settings: { familyMode: false, cueWord: null, measurementMode: 'relative_band', onboarded: true, qualification: 'not_run', quietLeadMs: null, quietLeadScreenReaderMs: null },
      phrases: null, records: [], active: null, prunedSessions: 0, migratedFrom: null, corruptKeys: 0, staleCheckpointDiscarded: false, pruneFailed: false, finishedCheckpointDropped: false,
    } } });
    const s = m.s;
    (s as { session: unknown }).session = (m as unknown as { newSession(p: string[], f: boolean): unknown }).newSession(['One.', 'Two.'], false);
    (s.session as { beginAcked: boolean }).beginAcked = true; // the phone acked this session's session.begin
    s.link = 'connected';
    s.authed = true;
    s.roomId = ROOM;
    s.peerConnected = true;
    s.phonePaired = true;
    s.mic = { state: 'open_idle', mode: 'physical_phone' };
    s.stage = 'calibration';
    s.sub = 'ready';
    return m;
  }

  it.each([-115, -110.1, -29.9, 0, null])('refuses to start a calibration window with a floor of %s and shows the silent-input copy', (floor) => {
    const m = readyMachine();
    (m.s.session as { floorDbfs: number | null }).floorDbfs = floor as number | null;
    const sent: string[] = [];
    const collect = (fx: ReturnType<Machine['handle']>) => {
      for (const e of fx) if (e.kind === 'send') sent.push(e.message.type);
    };
    collect(m.handle({ kind: 'ui', action: 'begin_calibration' }));
    collect(m.handle({ kind: 'timer', now: m.s.now + 1500 }));
    expect(sent).not.toContain('window.start');
    expect(m.s.win).toBeNull();
    expect(m.s.stage).toBe('paused_or_invalid');
    expect(m.view().body.join(' ')).toContain('The phone microphone looks muted or blocked.');
  });

  it('accepts the exact limits -110 and -30', () => {
    for (const floor of [-110, -30]) {
      const m = readyMachine();
      (m.s.session as { floorDbfs: number | null }).floorDbfs = floor;
      const sent: unknown[] = [];
      m.handle({ kind: 'ui', action: 'begin_calibration' });
      for (const e of m.handle({ kind: 'timer', now: m.s.now + 1500 })) if (e.kind === 'send') sent.push(e.message);
      expect(sent).toEqual([expect.objectContaining({ type: 'window.start', payload: expect.objectContaining({ vad_floor_dbfs: floor }) })]);
    }
  });
});

describe('PK-12 NFC self-test', () => {
  it('passes on a normal runtime and the result is in Diagnostics', async () => {
    expect(nfcSelfTest()).toBe(true);
    const h = await boot();
    h.ui('open_settings');
    h.ui('open_diagnostics');
    expect(h.view.diagnostics?.nfc_self_test).toBe('pass');
    expect(h.view.banner?.text ?? '').not.toContain('normalisation');
  });

  it('fails visibly when String.prototype.normalize is missing', async () => {
    const original = String.prototype.normalize;
    try {
      (String.prototype as { normalize?: unknown }).normalize = undefined;
      expect(nfcSelfTest()).toBe(false);
      const h = await boot();
      expect(h.view.banner).toMatchObject({ kind: 'warning' });
      expect(h.view.banner?.text).toContain('Text normalisation is unavailable');
      h.ui('open_settings');
      h.ui('open_diagnostics');
      expect(h.view.diagnostics?.nfc_self_test).toBe('FAIL');
    } finally {
      String.prototype.normalize = original;
    }
    expect(nfcSelfTest()).toBe(true);
  });

  it('fails when normalize returns something else', () => {
    const original = String.prototype.normalize;
    try {
      String.prototype.normalize = function () {
        return String(this);
      };
      expect(nfcSelfTest()).toBe(false);
    } finally {
      String.prototype.normalize = original;
    }
  });
});
