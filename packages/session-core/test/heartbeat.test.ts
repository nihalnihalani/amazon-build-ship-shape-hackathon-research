import { HEARTBEAT_INTERVAL_MS, PEER_UNKNOWN_AFTER_MS, parseWireMessage, validateMessageObject } from '@atr/protocol';
import { describe, expect, it } from 'vitest';
import { PAIRING_CODE, ROOM, boot } from './helpers.js';

describe('relay heartbeat', () => {
  it('uses the protocol interval, safely inside the relay idle limit', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(10_000);
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThan(PEER_UNKNOWN_AFTER_MS);
  });

  it('sends a ping after exactly 10 s without traffic, then every 10 s', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    h.clearSent();
    h.advance(9_999);
    expect(h.of('ping')).toHaveLength(0);
    h.advance(1);
    expect(h.of('ping')).toHaveLength(1);
    const ping = h.last('ping');
    expect(ping.payload).toEqual({});
    expect(ping).toMatchObject({ sender_role: 'tv', room_id: ROOM, producer_generation: 1, session_id: null });
    h.advance(9_999);
    expect(h.of('ping')).toHaveLength(1);
    h.advance(1);
    expect(h.of('ping')).toHaveLength(2);
    expect(h.of('ping')[1]?.sequence).toBe((h.of('ping')[0]?.sequence as number) + 1);
    // a quiet TV for a long stretch is never silent for 25 s
    h.clearSent();
    for (let i = 0; i < 30; i += 1) h.advance(1_000);
    expect(h.of('ping')).toHaveLength(3);
  });

  it('every ping passes the shared validators, as a text frame and as an object', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.advance(10_000); // room.create still unanswered: pre-authentication ping
    h.roomCreated();
    h.advance(10_000); // authenticated ping
    const pings = h.of('ping');
    expect(pings).toHaveLength(2);
    for (const p of pings) {
      const now = h.clock.now();
      const parsed = parseWireMessage(p.raw, { now });
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
      expect(validateMessageObject(JSON.parse(p.raw), { now }).ok).toBe(true);
    }
  });

  it('is not sent while other traffic is flowing', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    h.clearSent();
    for (let i = 0; i < 12; i += 1) {
      h.advance(9_000);
      h.ui('refresh_code'); // any message the TV sends resets the idle clock
    }
    expect(h.of('pairing.refresh')).toHaveLength(12);
    expect(h.of('ping')).toHaveLength(0);
    h.advance(10_000);
    expect(h.of('ping')).toHaveLength(1);
  });

  it('a long vowel window (30 s) no longer starves the connection', async () => {
    const h = await boot();
    h.startAndPair();
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.beginAndLead('begin_vowel');
    h.answerPrecheck(); // window.start was just sent
    h.phoneStartsMeasuring(); // the capture has started
    h.clearSent();
    h.advance(9_999);
    expect(h.of('ping')).toHaveLength(0);
    h.advance(1);
    expect(h.of('ping')).toHaveLength(1);
    h.advance(10_000);
    h.advance(10_000);
    expect(h.of('ping')).toHaveLength(3);
    expect(h.view.stage).toBe('vowel_active');
    expect(h.view.link).toBe('connected');
  });

  it('is not sent while disconnected, connecting, failed or never connected', async () => {
    const idle = await boot();
    for (let i = 0; i < 10; i += 1) idle.advance(10_000);
    expect(idle.transport.sent).toHaveLength(0);

    const h = await boot();
    h.ui('start_session'); // link: connecting
    for (let i = 0; i < 5; i += 1) h.advance(10_000);
    expect(h.of('ping')).toHaveLength(0);
    h.transportState('connected');
    h.roomCreated();
    h.clearSent();
    for (const state of ['reconnecting', 'offline', 'failed', 'connecting'] as const) {
      h.transportState(state);
      for (let i = 0; i < 4; i += 1) h.advance(10_000);
      expect(h.of('ping'), state).toHaveLength(0);
    }
    // after reconnecting, the idle clock restarts from the auth.resume that the TV just sent
    h.transportState('connected');
    expect(h.of('auth.resume')).toHaveLength(1);
    h.advance(9_999);
    expect(h.of('ping')).toHaveLength(0);
    h.advance(1);
    expect(h.of('ping')).toHaveLength(1);
  });

  it('a pong changes nothing but a diagnostics counter', async () => {
    const h = await boot();
    h.setupToPhrases();
    const stage = h.view.stage;
    const mic = h.view.mic;
    h.advance(10_000);
    h.wire(h.relay('pong', { server_time: 1_700_000_000_000 }));
    expect(h.view.stage).toBe(stage);
    expect(h.view.mic).toBe(mic);
    expect(h.view.link).toBe('connected');
    h.ui('open_settings');
    h.ui('open_diagnostics');
    expect(h.view.diagnostics?.heartbeats_sent).toBe('1');
    expect(h.view.diagnostics?.heartbeats_answered).toBe('1');
  });
});

describe('wire inputs are raw text frames only (PK-09)', () => {
  it('accepts a raw string and refuses every other kind of input, counting it as unparseable', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.wire(h.relay('room.created', {
      room_id: ROOM,
      pairing_code: PAIRING_CODE,
      code_expires_at: h.clock.now() + 600_000,
      tv_credential: 'C'.repeat(43),
      credential_expires_at: h.clock.now() + 3_600_000,
      generation: 1,
    })); // string: what a WebSocket adapter dispatches from event.data
    expect(h.view.pairing?.code).toBe(PAIRING_CODE);
    const frame = h.relay('pairing.code', { pairing_code: 'WXY347', code_expires_at: h.clock.now() + 600_000 });
    // a decoded object, a null-prototype object, a binary frame and other values are refused, never applied
    h.wire(JSON.parse(frame));
    h.wire(Object.assign(Object.create(null) as object, JSON.parse(frame)));
    h.wire(new ArrayBuffer(8));
    h.wire(new Uint8Array([1, 2, 3]));
    h.wire(42);
    h.wire(null);
    h.wire(undefined);
    expect(h.view.pairing?.code).toBe(PAIRING_CODE);
    h.wire(frame);
    expect(h.view.pairing?.code).toBe('WXY347');
    h.ui('cancel');
    h.ui('open_settings');
    h.ui('open_diagnostics');
    expect(Number(h.view.diagnostics?.messages_unparseable)).toBe(7);
  });
});
