/**
 * Origin handling (A3-08, SEC-A11) and the production configuration (A3-12). Runs on both stores.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { CLOSE, RelayConfigError, RelayCore, MemoryRoomStore, type OriginState } from '../src/core/index.js';
import { FOREIGN_ORIGIN, PHONE_ORIGIN, Rig, TV_PREVIEW_ORIGIN, assertAllRigsNoLeaks, type Client } from './helpers/rig.js';

afterAll(() => assertAllRigsNoLeaks());

const ORIGINS: [OriginState, string | null][] = [
  ['phone_origin', PHONE_ORIGIN],
  ['tv_preview_origin', TV_PREVIEW_ORIGIN],
  ['absent', null],
];

describe('origin_state is stored per connection at connect (A3-08)', () => {
  it.each(ORIGINS)('classifies %s', async (state, origin) => {
    const rig = new Rig();
    const c = await rig.connect(origin);
    expect(c.closed).toBeNull();
    expect((await rig.store.getConnection(c.id))?.originState).toBe(state);
  });

  it.each([
    ['the literal "null" origin (sandboxed iframe, file page)', 'null'],
    ['an empty origin header', ''],
    ['a foreign origin', FOREIGN_ORIGIN],
    ['the phone origin with a trailing slash', `${PHONE_ORIGIN}/`],
    ['the phone origin in a different case', PHONE_ORIGIN.toUpperCase()],
    ['a path-bearing origin', `${PHONE_ORIGIN}/app`],
  ])('is present and rejected at connect: %s', async (_name, origin) => {
    const rig = new Rig();
    const c = await rig.connect(origin);
    expect(c.closed?.code).toBe(CLOSE.ORIGIN);
    expect(await rig.connectionCount()).toBe(0);
  });
});

describe('operations by origin state (A3-08, SEC-A11)', () => {
  const create = async (rig: Rig, origin: string | null): Promise<Client> => {
    const c = await rig.connect(origin);
    c.role = 'tv';
    await rig.send(c, 'room.create');
    return c;
  };

  it.each([
    ['absent', null, true],
    ['tv_preview_origin', TV_PREVIEW_ORIGIN, true],
    ['phone_origin', PHONE_ORIGIN, false],
  ] as const)('room.create from %s is %s', async (_n, origin, allowed) => {
    const rig = new Rig();
    const c = await create(rig, origin);
    if (allowed) {
      expect(c.of('room.created')).toHaveLength(1);
    } else {
      expect(c.lastError().payload.code).toBe('origin_rejected');
      expect(c.closed?.code).toBe(CLOSE.ORIGIN);
      expect(c.of('room.created')).toHaveLength(0);
    }
  });

  it.each([
    ['phone_origin', PHONE_ORIGIN, true],
    ['tv_preview_origin', TV_PREVIEW_ORIGIN, false],
    ['absent', null, false],
  ] as const)('join.request from %s is %s', async (_n, origin, allowed) => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const code = tv.last('room.created').payload.pairing_code as string;
    const c = await rig.connect(origin);
    c.role = 'phone';
    await rig.send(c, 'join.request', { payload: { pairing_code: code, device_label: 'x' } });
    if (allowed) expect(c.of('join.pending')).toHaveLength(1);
    else {
      expect(c.lastError().payload.code).toBe('origin_rejected');
      expect(c.closed?.code).toBe(CLOSE.ORIGIN);
      expect(tv.of('join.requested')).toHaveLength(0);
    }
  });

  it.each([
    ['absent', null, true],
    ['tv_preview_origin', TV_PREVIEW_ORIGIN, true],
    ['phone_origin', PHONE_ORIGIN, false],
  ] as const)('auth.resume as tv from %s is %s', async (_n, origin, allowed) => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    await rig.exec(await rig.core.onDisconnect(tv.id, rig.now));
    const c = await rig.resume(tv.roomId as string, 'tv', tv.credential as string, { origin });
    if (allowed) expect(c.of('auth.ok')).toHaveLength(1);
    else {
      expect(c.lastError().payload.code).toBe('origin_rejected');
      expect(c.closed?.code).toBe(CLOSE.ORIGIN);
      // a refused origin does not consume the credential
      const retry = await rig.resume(tv.roomId as string, 'tv', tv.credential as string, { origin: null });
      expect(retry.of('auth.ok')).toHaveLength(1);
    }
  });

  it.each([
    ['phone_origin', PHONE_ORIGIN, true],
    ['tv_preview_origin', TV_PREVIEW_ORIGIN, false],
    ['absent', null, false],
  ] as const)('auth.resume as phone from %s is %s', async (_n, origin, allowed) => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.exec(await rig.core.onDisconnect(phone.id, rig.now));
    const c = await rig.resume(tv.roomId as string, 'phone', phone.credential as string, { origin });
    if (allowed) expect(c.of('auth.ok')).toHaveLength(1);
    else {
      expect(c.lastError().payload.code).toBe('origin_rejected');
      expect(c.closed?.code).toBe(CLOSE.ORIGIN);
      expect(c.of('auth.ok')).toHaveLength(0);
    }
  });

  it.each(ORIGINS)('ping works from %s (it carries no authority)', async (_n, origin) => {
    const rig = new Rig();
    const c = await rig.connect(origin);
    c.role = 'tv';
    await rig.send(c, 'ping');
    expect(c.of('pong')).toHaveLength(1);
  });

  it('the preview origin cannot act as a phone and the phone origin cannot act as a TV, in either direction', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate(TV_PREVIEW_ORIGIN); // a preview TV
    const phone = await rig.pair(tv);
    expect(phone.credential).toBeTruthy();
    await rig.exec(await rig.core.onDisconnect(tv.id, rig.now));
    await rig.exec(await rig.core.onDisconnect(phone.id, rig.now));
    const asPhone = await rig.resume(tv.roomId as string, 'phone', phone.credential as string, { origin: TV_PREVIEW_ORIGIN });
    expect(asPhone.lastError().payload.code).toBe('origin_rejected');
    const asTv = await rig.resume(tv.roomId as string, 'tv', tv.credential as string, { origin: PHONE_ORIGIN });
    expect(asTv.lastError().payload.code).toBe('origin_rejected');
  });
});

describe('the production configuration (A3-08, A3-12, SEC-I07)', () => {
  const secret = 'production-test-secret-123';

  it('refuses to be built with a TV preview origin, with an origin that is both kinds, or with a missing or short secret', () => {
    const store = new MemoryRoomStore();
    expect(
      () => new RelayCore({ store, config: { phoneOrigins: [PHONE_ORIGIN], tvPreviewOrigins: [TV_PREVIEW_ORIGIN], hashSecret: secret, environment: 'production' } }),
    ).toThrow(RelayConfigError);
    expect(
      () => new RelayCore({ store, config: { phoneOrigins: [PHONE_ORIGIN], tvPreviewOrigins: [], hashSecret: secret, environment: 'production' } }),
    ).not.toThrow();
    for (const environment of ['development', 'staging'] as const) {
      expect(() => new RelayCore({ store, config: { phoneOrigins: [PHONE_ORIGIN], tvPreviewOrigins: [TV_PREVIEW_ORIGIN], hashSecret: secret, environment } })).not.toThrow();
    }
    expect(() => new RelayCore({ store, config: { phoneOrigins: [PHONE_ORIGIN], tvPreviewOrigins: [PHONE_ORIGIN], hashSecret: secret } })).toThrow(/both/);
    expect(() => new RelayCore({ store, config: { phoneOrigins: [PHONE_ORIGIN], hashSecret: '' } })).toThrow(RelayConfigError);
    expect(() => new RelayCore({ store, config: { phoneOrigins: [PHONE_ORIGIN], hashSecret: 'short' } })).toThrow(RelayConfigError);
  });

  it('rejects client.platform "test" in production, accepts it in development and staging, and never trusts the value', async () => {
    const payload = (platform: string) => ({ client: { app_version: '0.1.0', platform } });
    for (const environment of ['development', 'staging'] as const) {
      const rig = new Rig({ environment });
      const c = await rig.connect(null);
      c.role = 'tv';
      await rig.send(c, 'room.create', { payload: payload('test') });
      expect(c.of('room.created'), environment).toHaveLength(1);
    }
    const prod = new Rig({ environment: 'production', tvPreviewOrigins: [] });
    const t = await prod.connect(null);
    t.role = 'tv';
    await prod.send(t, 'room.create', { payload: payload('test') });
    expect(t.lastError().payload).toMatchObject({ code: 'unauthorized', detail: 'platform_not_allowed' });
    expect(t.of('room.created')).toHaveLength(0);
    for (const platform of ['vega', 'web_preview']) {
      const c = await prod.connect(null);
      c.role = 'tv';
      await prod.send(c, 'room.create', { payload: payload(platform) });
      expect(c.of('room.created'), platform).toHaveLength(1);
    }
    // platform changes nothing else: a vega TV and a test TV get identical treatment in development
    const dev = new Rig();
    const a = await dev.tvCreate();
    expect(a.of('room.created')).toHaveLength(1);
  });

  it('does not count a refused platform against the room.create budget', async () => {
    const rig = new Rig({ environment: 'production', tvPreviewOrigins: [] });
    for (let i = 0; i < 3; i += 1) {
      const c = await rig.connect(null, '203.0.113.5');
      c.role = 'tv';
      await rig.send(c, 'room.create', { payload: { client: { app_version: '0.1.0', platform: 'test' } } });
      await rig.exec(await rig.core.onDisconnect(c.id, rig.now));
    }
    expect(rig.metrics.some((m) => m.name === 'rooms_created')).toBe(false);
  });
});
