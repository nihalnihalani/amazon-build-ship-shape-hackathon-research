/**
 * Contract revision 3 (T16 N-03): the optional `phonePageOrigin` dependency. On AWS the phone page is served from
 * CloudFront while the relay is an execute-api host, so the QR payload and the link must use the page origin.
 */

import { describe, expect, it } from 'vitest';
import { phoneJoinUrl, validatePhonePageOrigin } from '../src/index.js';
import { PAIRING_CODE, allStrings, boot } from './helpers.js';

const CLOUDFRONT = 'https://d1234abcd.cloudfront.net';

async function pairingView(opts: Parameters<typeof boot>[0] = {}) {
  const h = await boot(opts);
  h.ui('start_session');
  h.transportState('connected');
  h.roomCreated();
  return h;
}

describe('validatePhonePageOrigin', () => {
  it('accepts an https origin, with an optional port, and lower-cases scheme and host', () => {
    expect(validatePhonePageOrigin(CLOUDFRONT)).toBe(CLOUDFRONT);
    expect(validatePhonePageOrigin('https://phone.example.test:8443')).toBe('https://phone.example.test:8443');
    expect(validatePhonePageOrigin('HTTPS://D1234ABCD.CloudFront.NET')).toBe(CLOUDFRONT);
    expect(validatePhonePageOrigin('https://localhost')).toBe('https://localhost');
    expect(validatePhonePageOrigin('https://192.168.1.20:5173')).toBe('https://192.168.1.20:5173');
    expect(validatePhonePageOrigin('https://[::1]:8443')).toBe('https://[::1]:8443');
    expect(validatePhonePageOrigin('https://a-b.c-d.example')).toBe('https://a-b.c-d.example');
  });

  it('rejects anything that is not exactly an https origin', () => {
    const bad: unknown[] = [
      '',
      ' ',
      'd1234abcd.cloudfront.net', // no scheme
      '//d1234abcd.cloudfront.net',
      'http://d1234abcd.cloudfront.net', // not https
      'wss://abc.execute-api.eu-west-1.amazonaws.com',
      'ftp://phone.example.test',
      'javascript:alert(1)',
      'https://', // no host
      'https:///path',
      `${CLOUDFRONT}/`, // a path, even a lone slash
      `${CLOUDFRONT}/phone`,
      `${CLOUDFRONT}/phone/`,
      `${CLOUDFRONT}?x=1`,
      `${CLOUDFRONT}/?x=1`,
      `${CLOUDFRONT}#code=ABC`,
      `${CLOUDFRONT}/#`,
      'https://user@d1234abcd.cloudfront.net', // user info
      'https://user:secret@d1234abcd.cloudfront.net',
      'https://d1234abcd.cloudfront.net:0',
      'https://d1234abcd.cloudfront.net:65536',
      'https://d1234abcd.cloudfront.net:80a',
      'https://d1234abcd.cloudfront.net:',
      'https://exa mple.test',
      ` ${CLOUDFRONT}`,
      `${CLOUDFRONT} `,
      `${CLOUDFRONT}\n`,
      'https://-bad.example',
      'https://bad-.example',
      'https://bad..example',
      'https://exam_ple.test',
      'https://exa%6Dple.test',
      'https://exa\\mple.test',
      'https://[zz]:1',
      'https://example.test:99999',
      null,
      undefined,
      42,
      {},
      ['https://d1234abcd.cloudfront.net'],
    ];
    for (const value of bad) expect(validatePhonePageOrigin(value), JSON.stringify(value)).toBeNull();
  });
});

describe('phoneJoinUrl', () => {
  it('uses the page origin when it is valid, the relay https origin when absent or invalid', () => {
    const relay = 'https://abc123.execute-api.eu-west-1.amazonaws.com/prod';
    expect(phoneJoinUrl(relay, 'ACDEFH', CLOUDFRONT)).toBe(`${CLOUDFRONT}/#code=ACDEFH`);
    expect(phoneJoinUrl(relay, 'ACDEFH')).toBe('https://abc123.execute-api.eu-west-1.amazonaws.com/#code=ACDEFH');
    expect(phoneJoinUrl(relay, 'ACDEFH', null)).toBe('https://abc123.execute-api.eu-west-1.amazonaws.com/#code=ACDEFH');
    expect(phoneJoinUrl(relay, 'ACDEFH', 'http://nope.example')).toBe('https://abc123.execute-api.eu-west-1.amazonaws.com/#code=ACDEFH');
    expect(phoneJoinUrl('wss://relay.example.test/ws', 'ACDEFH')).toBe('https://relay.example.test/#code=ACDEFH');
    expect(phoneJoinUrl('ws://localhost:8787', 'ACDEFH')).toBe('https://localhost:8787/#code=ACDEFH');
  });

  it('keeps the code in the fragment and encodes it', () => {
    expect(phoneJoinUrl('https://r.example/ws', 'A B/C', CLOUDFRONT)).toBe(`${CLOUDFRONT}/#code=A%20B%2FC`);
  });
});

describe('the TV pairing view', () => {
  it('with phonePageOrigin set the QR payload is `${origin}/#code=<CODE>` on the page host, not the relay host', async () => {
    const h = await pairingView({ relayUrl: 'wss://abc123.execute-api.eu-west-1.amazonaws.com/prod', phonePageOrigin: CLOUDFRONT });
    expect(h.view.pairing?.code).toBe(PAIRING_CODE);
    expect(h.view.pairing?.qrPayload).toBe(`${CLOUDFRONT}/#code=${PAIRING_CODE}`);
    expect(JSON.stringify(h.view)).not.toContain('execute-api');
    // the socket still goes to the relay
    expect(h.transport.connects.at(-1)).toBe('wss://abc123.execute-api.eu-west-1.amazonaws.com/prod');
  });

  it('a refreshed code is built on the same page origin', async () => {
    const h = await pairingView({ phonePageOrigin: CLOUDFRONT });
    h.ui('refresh_code');
    h.pairingCode('WXY347');
    expect(h.view.pairing?.qrPayload).toBe(`${CLOUDFRONT}/#code=WXY347`);
  });

  it('without the option the QR payload is the relay URL https origin (unchanged)', async () => {
    const h = await pairingView({ relayUrl: 'wss://relay.example.test/ws' });
    expect(h.view.pairing?.qrPayload).toBe(`https://relay.example.test/#code=${PAIRING_CODE}`);
    expect(h.view.diagnostics).toBeNull();
  });

  it('an https relay URL without the option also keeps the relay origin', async () => {
    const h = await pairingView({ relayUrl: 'https://relay.example.test/ws' });
    expect(h.view.pairing?.qrPayload).toBe(`https://relay.example.test/#code=${PAIRING_CODE}`);
  });

  it('an invalid value is ignored: the relay origin is used, and the pairing screen shows nothing unusual', async () => {
    for (const bad of ['http://phone.example.test', `${CLOUDFRONT}/phone`, `${CLOUDFRONT}/`, 'phone.example.test', '', 'https://u:p@phone.example.test', 7]) {
      const h = await pairingView({ relayUrl: 'wss://relay.example.test/ws', phonePageOrigin: bad });
      expect(h.view.pairing?.qrPayload, String(bad)).toBe(`https://relay.example.test/#code=${PAIRING_CODE}`);
      expect(h.view.banner).toBeNull();
      expect(h.view.stage).toBe('pairing');
    }
  });

  it('an undefined option is the same as not setting it', async () => {
    const h = await pairingView({ relayUrl: 'wss://relay.example.test/ws', phonePageOrigin: undefined });
    expect(h.view.pairing?.qrPayload).toBe(`https://relay.example.test/#code=${PAIRING_CODE}`);
  });
});

describe('Diagnostics notes the origin source', () => {
  const diag = async (opts: Parameters<typeof boot>[0]) => {
    const h = await boot(opts);
    h.ui('open_settings');
    h.ui('open_diagnostics');
    return h.view.diagnostics ?? {};
  };

  it('not set: relay origin', async () => {
    expect((await diag({}))['phone_page_origin']).toBe('relay origin');
  });

  it('valid: the configured origin is shown', async () => {
    expect((await diag({ phonePageOrigin: CLOUDFRONT }))['phone_page_origin']).toBe(CLOUDFRONT);
  });

  it('invalid: ignored and said so, and the invalid value is never echoed', async () => {
    const secret = 'https://user:hunter2@phone.example.test/path?token=abc';
    const d = await diag({ phonePageOrigin: secret });
    expect(d['phone_page_origin']).toBe('relay origin (phonePageOrigin option invalid, ignored)');
    expect(allStrings(d).join('\n')).not.toMatch(/hunter2|token=abc|phone\.example\.test/);
  });

  it('a non-string value is invalid too', async () => {
    expect((await diag({ phonePageOrigin: 123 }))['phone_page_origin']).toContain('invalid, ignored');
  });
});
