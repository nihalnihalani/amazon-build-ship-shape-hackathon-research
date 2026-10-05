import { describe, expect, it } from 'vitest';
import { createRedactingLogger, formatLogLine, sanitizeLogEvent, LOG_EVENTS } from '../src/core/index.js';

describe('redacting logger (ADR-0002)', () => {
  it('keeps only allowlisted fields with allowlisted values', () => {
    const e = sanitizeLogEvent({
      event: 'message_forwarded',
      type: 'cue',
      bytes: 321,
      role: 'phone',
      room: 'deadbeef',
      latency_ms: 1.23456,
      code: 'cue_limit',
      payload: { text: 'secret phrase' },
      credential: 'A'.repeat(43),
      pairing_code: 'ACDEFH',
      ip: '203.0.113.5',
      origin: 'https://phone.example.test',
      text: 'cue text',
    });
    expect(e).toEqual({
      event: 'message_forwarded',
      type: 'cue',
      bytes: 321,
      role: 'phone',
      room: 'deadbeef',
      latency_ms: 1.23,
      code: 'cue_limit',
    });
  });

  it('drops values outside the closed vocabularies instead of emitting them', () => {
    const e = sanitizeLogEvent({
      event: 'connect',
      type: 'free text from a client',
      code: 'ACDEFH',
      role: 'admin',
      room: 'r_AAAAAAAAAAAAAAAAAAAAAA',
      bytes: -5,
      latency_ms: Number.NaN,
    });
    expect(e).toEqual({ event: 'connect' });
  });

  it('refuses events that are not on the event list', () => {
    expect(sanitizeLogEvent({ event: 'dump_body' })).toBeNull();
    expect(sanitizeLogEvent({})).toBeNull();
    expect(sanitizeLogEvent(null)).toBeNull();
    expect(sanitizeLogEvent('x')).toBeNull();
  });

  it('writes one JSON line per event with a fixed key set', () => {
    const lines: string[] = [];
    const log = createRedactingLogger((l) => lines.push(l));
    log.log({ event: 'room_created', role: 'tv', room: '0123abcd', tv_credential: 'x'.repeat(43) });
    log.log({ event: 'not_an_event' });
    expect(lines).toEqual(['{"event":"room_created","role":"tv","room":"0123abcd"}']);
    expect(formatLogLine({ event: 'connect' })).toBe('{"event":"connect"}');
  });

  it('has no event name that implies content', () => {
    for (const name of LOG_EVENTS) expect(name).not.toMatch(/body|payload|phrase|cue_text|credential_value|code_value|address/);
  });
});
