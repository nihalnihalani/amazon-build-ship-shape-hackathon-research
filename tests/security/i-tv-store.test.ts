/**
 * T16 gate, part I: the TV session core as a security boundary, driven through the real headless TV against a real
 * relay and a raw phone.
 *
 *   A3-06   number matching: three distinct choices, Reject preferred, no Accept; a wrong pick rejects and burns the code
 *   PK-09   a decoded object is not a wire frame
 *   TM-G3   a frame claiming sender_role tv, or a relay-only type claimed by the phone role, changes nothing
 *
 * Evidence class: automated (headless TV session core, local relay, raw sockets).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTv, type TvHarness } from '../src/tv-driver.js';
import { RawClient, envelope, requestJoin, sleep, startSecRelay, type Msg, type SecRelay } from './helpers.js';

let relay: SecRelay;
let tv: TvHarness;

beforeAll(async () => {
  relay = await startSecRelay();
  tv = await startTv({ relayUrl: relay.wsUrl, ca: relay.ca });
  if (tv.view().screen === 'onboarding') tv.act('continue');
  await tv.waitFor((v) => v.screen === 'home', 'home');
  tv.act('start_session');
  await tv.waitFor((v) => v.screen === 'pairing' && !!v.pairing?.code, 'pairing code');
}, 120_000);

afterAll(async () => {
  tv?.dispose();
  await relay?.stop();
});

const tvRoomId = (): string => {
  const created = tv.transport.received.map((t) => JSON.parse(t) as Msg).find((m) => m.type === 'room.created');
  return String(created?.payload['room_id']);
};

describe('PK-09 / TM-G3: what the TV store accepts as an inbound frame', () => {
  it('ignores a decoded object, a frame whose sender_role is tv, and a relay-only type claimed by the phone role; the screen does not change', async () => {
    const before = JSON.stringify(tv.view());
    const room = tvRoomId();
    const joinRequested = envelope('join.requested', { role: 'relay', roomId: room, payload: { join_id: 'j_secforged00001', device_label: 'forged', confirm_digits: '42', expires_at: Date.now() + 60_000 } });
    // 1. the same message as a decoded object (not a string)
    tv.store.dispatch({ kind: 'wire', message: joinRequested as never });
    // 2. as text, but claiming to be the TV itself
    tv.store.dispatch({ kind: 'wire', message: JSON.stringify({ ...joinRequested, sender_role: 'tv', producer_generation: 0 }) });
    // 3. as text, a relay-only type claimed by the phone role
    tv.store.dispatch({
      kind: 'wire',
      message: JSON.stringify(envelope('room.created', { role: 'phone', roomId: room })),
    });
    // 4. as text from the phone role: join.requested is relay-originated, a phone may not send it
    tv.store.dispatch({ kind: 'wire', message: JSON.stringify({ ...joinRequested, sender_role: 'phone' }) });
    // 5. malformed text, a binary-looking value, null
    tv.store.dispatch({ kind: 'wire', message: '{"not":"a message' });
    tv.store.dispatch({ kind: 'wire', message: new Uint8Array([1, 2, 3]) as never });
    tv.store.dispatch({ kind: 'wire', message: null as never });
    await sleep(300);
    const after = tv.view();
    expect(after.screen).toBe('pairing');
    expect(after.pairing?.joinRequest ?? null).toBeNull();
    expect(JSON.stringify(after.body)).not.toContain('forged');
    // the code shown is unchanged (nothing re-keyed the room)
    expect(JSON.parse(before).pairing.code).toBe(after.pairing?.code);
  });
});

describe('A3-06: number matching on the real TV store with a real relay', () => {
  it('three distinct choices include the real number; Reject is preferred and no Accept exists; a wrong pick rejects the phone and burns the code; the right pick pairs', async () => {
    const decoySets: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      const pairing = await tv.waitFor((v) => v.screen === 'pairing' && !!v.pairing?.code, `pairing code, round ${round}`, 15_000);
      const code = pairing.pairing!.code!;
      const j = await requestJoin(relay, code, `matching round ${round}`);
      const confirm = await tv.waitFor((v) => v.screen === 'join_confirm' && !!v.pairing?.joinRequest, 'join confirm');
      const choices = confirm.pairing!.joinRequest!.choices;
      expect(choices).toHaveLength(3);
      expect(new Set(choices).size).toBe(3);
      expect(choices).toContain(j.digits);
      expect(confirm.preferredAction).toBe('reject_join');
      const ids = confirm.actions.map((a) => a.id);
      expect(ids).not.toContain('accept_join');
      expect(ids).toEqual(expect.arrayContaining(['pick_choice_1', 'pick_choice_2', 'pick_choice_3', 'reject_join']));
      expect(JSON.stringify(confirm.pairing)).toContain(`matching round ${round}`);
      decoySets.push(choices.filter((c) => c !== j.digits).sort().join('/'));
      const wrong = choices.findIndex((c) => c !== j.digits);
      tv.act(`pick_choice_${wrong + 1}` as never);
      const rej = await j.client.next('join.rejected');
      expect(rej.payload['reason']).toBe('rejected');
      await tv.waitFor((v) => v.screen === 'pairing' && !!v.pairing?.code && v.pairing.code !== code, 'a fresh code after the wrong pick', 15_000);
      // the burned code no longer joins
      const old = await RawClient.open(relay, relay.phoneOrigin);
      old.send(JSON.stringify(envelope('join.request', { role: 'phone', payload: { pairing_code: code, device_label: 'replay of a burned code' } })));
      expect((await old.nextError()).code).toMatch(/not_found|rate_limited/);
      old.close();
      j.client.close();
      await sleep(2300); // the failure delay after a wrong code (A3-03) is short here; stay clear of it
    }
    expect(new Set(decoySets).size, 'decoys are drawn afresh each time').toBeGreaterThan(1);
    // the right pick
    const pairing = await tv.waitFor((v) => v.screen === 'pairing' && !!v.pairing?.code, 'pairing code', 15_000);
    const j = await requestJoin(relay, pairing.pairing!.code!, 'the right phone');
    const confirm = await tv.waitFor((v) => v.screen === 'join_confirm' && !!v.pairing?.joinRequest, 'join confirm');
    tv.act(`pick_choice_${confirm.pairing!.joinRequest!.choices.indexOf(j.digits) + 1}` as never);
    const accepted = await j.client.next('join.accepted');
    expect(String(accepted.payload['phone_credential'])).toMatch(/^[A-Za-z0-9_-]{43}$/);
    j.client.close();
  }, 120_000);
});
