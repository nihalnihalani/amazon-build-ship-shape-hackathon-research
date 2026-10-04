import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  LIMITS,
  MAX_MESSAGE_BYTES,
  MESSAGE_TYPES,
  TYPE_SPECS,
  parseWireText,
  specOf,
  type MessageType,
} from '../src/core/index.js';
import { VALID_PAYLOADS } from './helpers/fixtures.js';

const NOW = 1_800_000_000_000;

function env(type: MessageType, over: Record<string, unknown> = {}, payload?: Record<string, unknown>): string {
  const spec = specOf(type);
  const req = (rule: string, v: string): string | null => (rule === 'req' ? v : null);
  return JSON.stringify({
    protocol_version: 1,
    type,
    message_id: 'm_abcdefghijklmnop',
    room_id: spec.room === 'req' ? 'r_abcdefghijklmnop' : null,
    session_id: req(spec.ids[0], 's_session0001'),
    window_id: req(spec.ids[1], 'w_window00001'),
    attempt_id: req(spec.ids[2], 'a_attempt0001'),
    sender_role: spec.senders[0],
    producer_generation: spec.auth === 'pre' ? 0 : 1,
    sequence: 0,
    event_timestamp: NOW,
    payload: payload ?? VALID_PAYLOADS[type] ?? {},
    ...over,
  });
}

describe('PROTOCOL.md conformance of the port', () => {
  const doc = readFileSync(new URL('../../../docs/PROTOCOL.md', import.meta.url), 'utf8');
  const catalogue = doc.slice(doc.indexOf('## 3. Message catalogue'), doc.indexOf('### 3.4 Error codes'));
  const rows = [...catalogue.matchAll(/^\| `([a-z.]+)` \| ([^|]+) \| ([^|]+) \|/gm)].map((m) => ({
    type: m[1] as string,
    dir: (m[2] as string).trim(),
    auth: (m[3] as string).trim(),
  }));

  it('lists exactly the message types of PROTOCOL.md section 3', () => {
    expect([...MESSAGE_TYPES].sort()).toEqual(rows.map((r) => r.type).sort());
    expect(rows.length).toBeGreaterThanOrEqual(36);
  });

  it('matches the direction and auth columns of the catalogue tables', () => {
    for (const r of rows) {
      const spec = TYPE_SPECS[r.type as MessageType];
      const tv = /T→/.test(r.dir) || /any→/.test(r.dir);
      const phone = /P→/.test(r.dir) || /any→/.test(r.dir);
      const relay = /R→/.test(r.dir);
      expect(spec.senders.includes('tv'), `${r.type} tv`).toBe(tv);
      expect(spec.senders.includes('phone'), `${r.type} phone`).toBe(phone);
      expect(spec.senders.includes('relay'), `${r.type} relay`).toBe(relay);
      if (r.auth === 'pre') expect(spec.auth, r.type).toBe('pre');
      else if (r.auth === 'auth') expect(spec.auth, r.type).toBe('auth');
      else if (r.auth.startsWith('pre/auth')) expect(spec.auth, r.type).toBe('any');
    }
  });

  it('declares the error codes of section 3.4', () => {
    const line = /### 3\.4 Error codes\s+([^\n]+\n)/.exec(doc)?.[1] ?? '';
    const documented = [...line.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    expect([...ERROR_CODES].sort()).toEqual([...documented].sort());
  });

  it('uses the documented limits', () => {
    expect(MAX_MESSAGE_BYTES).toBe(8192);
    expect(LIMITS.maxCuesPerSession).toBe(3);
    expect(LIMITS.heartbeatWindowMs).toBe(25_000);
    expect(LIMITS.authDeadlineMs).toBe(5_000);
    expect(LIMITS.authDeadlineWhileJoinPendingMs).toBe(65_000);
    expect(LIMITS.maxUnauthenticatedMessages).toBe(5);
    expect(LIMITS.pairingCodeTtlMs).toBe(600_000);
    expect(LIMITS.joinTtlMs).toBe(60_000);
    expect(LIMITS.credentialTtlMs).toBe(12 * 3_600_000);
    expect(LIMITS.roomIdleCloseMs).toBe(30 * 60_000);
    expect(LIMITS.dedupeWindow).toBe(1024);
  });
});

describe('parseWireText', () => {
  it('accepts a valid fixture for every client-sendable type', () => {
    for (const t of MESSAGE_TYPES) {
      if (specOf(t).senders.includes('relay')) continue;
      if (t === 'join.request') {
        const r = parseWireText(env(t, {}, { pairing_code: 'ACDEFH', device_label: 'Phone' }), NOW);
        expect(r.ok, t).toBe(true);
      } else if (t === 'auth.resume') {
        const r = parseWireText(
          env(t, {}, { room_id: 'r_abcdefghijklmnop', role: 'tv', credential: 'A'.repeat(43) }),
          NOW,
        );
        expect(r.ok, t).toBe(true);
      } else {
        const r = parseWireText(env(t), NOW);
        expect(r.ok, `${t}: ${JSON.stringify(r)}`).toBe(true);
      }
    }
  });

  it('applies identity-binding rules from the S/W/A columns', () => {
    const level = (over: Record<string, unknown>) => parseWireText(env('level', over), NOW);
    expect(level({}).ok).toBe(true);
    expect(level({ session_id: null }).ok).toBe(false);
    expect(level({ window_id: null }).ok).toBe(false);
    expect(level({ attempt_id: null }).ok).toBe(false);
    // mic.state: session optional, window/attempt must be null
    const mic = (over: Record<string, unknown>) => parseWireText(env('mic.state', over), NOW);
    expect(mic({ session_id: null }).ok).toBe(true);
    expect(mic({ session_id: 's_session0001' }).ok).toBe(true);
    expect(mic({ window_id: 'w_window00001' }).ok).toBe(false);
    // phrases.update: all null
    expect(parseWireText(env('phrases.update', { session_id: 's_session0001' }), NOW).ok).toBe(false);
    // pre-auth types: room_id null, generation 0
    expect(parseWireText(env('room.create', { room_id: 'r_abcdefghijklmnop' }), NOW).ok).toBe(false);
    expect(parseWireText(env('room.create', { producer_generation: 1 }), NOW).ok).toBe(false);
    // ping: room optional
    expect(parseWireText(env('ping', { room_id: 'r_abcdefghijklmnop' }), NOW).ok).toBe(true);
    expect(parseWireText(env('ping', { room_id: null }), NOW).ok).toBe(true);
    // authenticated types require a room
    expect(parseWireText(env('level', { room_id: null }), NOW).ok).toBe(false);
  });

  it('reports failures with constant detail strings that never echo input', () => {
    const secret = 'SuperSecretValue123';
    const r = parseWireText(env('cue', {}, { text: `${'x'.repeat(13)}${secret}` }), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('bad_schema');
      expect(r.detail.includes(secret)).toBe(false);
      expect(r.detail.length).toBeLessThanOrEqual(64);
    }
    const unknownKey = parseWireText(env('cue', {}, { text: 'ok', [secret]: 1 }), NOW);
    expect(unknownKey.ok).toBe(false);
    if (!unknownKey.ok) expect(unknownKey.detail.includes(secret)).toBe(false);
  });

  it('carries the offending message_id back for correlation when it is well formed', () => {
    const bad = parseWireText(env('cue', {}, { text: '' }), NOW);
    expect(!bad.ok && bad.refMessageId).toBe('m_abcdefghijklmnop');
    const worse = parseWireText(env('cue', { message_id: 'nope' }), NOW);
    expect(!worse.ok && worse.refMessageId).toBeNull();
  });

  it('normalises to NFC and trims before counting code points (but forwards the original)', () => {
    const decomposed = 'é'.repeat(12); // 24 code points raw, 12 after NFC
    const r = parseWireText(env('cue', {}, { text: decomposed }), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message.raw).toContain(decomposed);
    expect(parseWireText(env('cue', {}, { text: `  ${'a'.repeat(12)}  ` }), NOW).ok).toBe(true);
    expect(parseWireText(env('cue', {}, { text: 'é'.repeat(13) }), NOW).ok).toBe(false);
  });

  it('rejects timestamps more than 24 hours from receiver time and accepts the boundary', () => {
    const day = 24 * 3_600_000;
    expect(parseWireText(env('ping', { event_timestamp: NOW + day }), NOW).ok).toBe(true);
    expect(parseWireText(env('ping', { event_timestamp: NOW - day }), NOW).ok).toBe(true);
    expect(parseWireText(env('ping', { event_timestamp: NOW + day + 1 }), NOW).ok).toBe(false);
    expect(parseWireText(env('ping', { event_timestamp: NOW - day - 1 }), NOW).ok).toBe(false);
    expect(parseWireText(env('ping', { event_timestamp: '1800000000000' }), NOW).ok).toBe(false);
  });

  it('rejects out-of-range generation and sequence', () => {
    expect(parseWireText(env('level', { producer_generation: 2 ** 31 }), NOW).ok).toBe(false);
    expect(parseWireText(env('level', { producer_generation: 2 ** 31 - 1 }), NOW).ok).toBe(true);
    expect(parseWireText(env('level', { sequence: 2 ** 53 }), NOW).ok).toBe(false);
    expect(parseWireText(env('level', { sequence: Number.MAX_SAFE_INTEGER }), NOW).ok).toBe(true);
  });

  it('uses UTF-8 byte length for the size limit', () => {
    const big = env('ping', { room_id: null }).replace('{', `{${' '.repeat(MAX_MESSAGE_BYTES)}`);
    const r = parseWireText(big, NOW);
    expect(!r.ok && r.code).toBe('payload_too_large');
  });

  it('orders checks as PROTOCOL.md section 4: type before audio guard before formats before payload', () => {
    // unknown type wins over everything below it
    expect(
      (parseWireText(env('level', { type: 'nope', message_id: 'bad' }), NOW) as { code: string }).code,
    ).toBe('unknown_type');
    // audio guard wins over envelope formats and payload schema
    const both = parseWireText(
      env('level', { room_id: 'bad' }, { ...(VALID_PAYLOADS.level as object), audio: 'x' }),
      NOW,
    );
    expect(!both.ok && both.code).toBe('audio_rejected');
    // envelope formats win over payload schema
    const fmt = parseWireText(env('level', { room_id: 'bad' }, { nonsense: true }), NOW);
    expect(!fmt.ok && fmt.detail).toBe('envelope.room_id');
  });

  it('validates window.start and precheck.start cross-field rules', () => {
    const ps = (p: Record<string, unknown>) => parseWireText(env('precheck.start', {}, p), NOW).ok;
    expect(ps({ purpose: 'quiet_check', duration_ms: 5000 })).toBe(true);
    expect(ps({ purpose: 'pre_window', duration_ms: 2000 })).toBe(true);
    expect(ps({ purpose: 'quiet_check', duration_ms: 2000 })).toBe(false);
    expect(ps({ purpose: 'pre_window', duration_ms: 5000 })).toBe(false);
  });
});
