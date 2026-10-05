/**
 * Pins the number of DynamoDB and SQS operations behind each relay step, so the cost model (docs/operations/COST.md)
 * cannot drift from the code. The counts are call counts against the strict DynamoDB model (the same expressions the
 * real adapter sends), converted to units the way DynamoDB bills small items: a strongly consistent read is 1 RRU, a
 * write 1 WRU, a transactional write 2 WRU per item. They are not billing measurements.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { LambdaRig, PHONE_ORIGIN, type LambdaClient } from './helpers/lambda-rig.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

interface ModelAssumptions {
  pairingInbound: number;
  pairingOutbound: number;
  connectInvocations: number;
  wruPerInbound: number;
  wruTouchPerInbound: number;
  wruPerRelayReply: number;
  wruPerConnectOrDisconnect: number;
  rruPerInbound: number;
  pairingExtraRru: number;
  deadlineMessages: number;
  sqsRequestsPerDeadlineMessage: number;
  deadlineRru: number;
}

interface Units {
  wru: number;
  rru: number;
}
const units = (rig: LambdaRig, from: number): Units => {
  let wru = 0;
  let rru = 0;
  for (const c of (rig.fake?.calls ?? []).slice(from)) {
    if (c.op === 'get' || c.op === 'query') rru += 1;
    else if (c.op === 'transact') wru += 2 * (c.items ?? 0);
    else wru += 1; // put, update, delete
  }
  return { wru, rru };
};
const mark = (rig: LambdaRig): number => rig.fake?.calls.length ?? 0;
const add = (a: Units, b: Units): Units => ({ wru: a.wru + b.wru, rru: a.rru + b.rru });

async function measure() {
  const rig = new LambdaRig();
  const out: Record<string, Units> = {};
  const step = async (name: string, f: () => Promise<unknown>) => {
    const n = mark(rig);
    await f();
    out[name] = units(rig, n);
  };
  await step('tv $connect', () => rig.connect('tv-x', null));
  const tvc = { role: 'tv' as const, roomId: null, generation: 0, nextSeq: 0 };
  await step('room.create', () => rig.message('tv-x', rig.build(tvc, 'room.create')));
  const created = rig.api.of('tv-x', 'room.created')[0];
  if (!created) throw new Error('no room.created');
  const tv: LambdaClient = Object.assign(new (class {})(), {
    id: 'tv-x', role: 'tv' as const, roomId: created.payload.room_id as string, generation: 1, nextSeq: 0, credential: null,
  }) as LambdaClient;
  await step('phone $connect', () => rig.connect('ph-x', PHONE_ORIGIN));
  const pc = { role: 'phone' as const, roomId: null, generation: 0, nextSeq: 0 };
  await step('join.request', () =>
    rig.message('ph-x', rig.build(pc, 'join.request', { payload: { pairing_code: created.payload.pairing_code as string, device_label: 'P' } })),
  );
  const joinId = rig.api.of('tv-x', 'join.requested')[0]?.payload.join_id as string;
  await step('join.confirm', () => rig.message('tv-x', rig.build(tv, 'join.confirm', { payload: { join_id: joinId, decision: 'accept' } })));
  const accepted = rig.api.of('ph-x', 'join.accepted')[0];
  const phone = { role: 'phone' as const, roomId: created.payload.room_id as string, generation: accepted?.payload.generation as number, nextSeq: 0 };
  await rig.message('tv-x', rig.build(tv, 'session.begin'));
  rig.now += 6_000;
  await rig.message('ph-x', rig.build(phone, 'level')); // the first message after a pause also touches the connection
  rig.now += 50;
  await step('level frame (steady state)', () => rig.message('ph-x', rig.build(phone, 'level')));
  rig.now += 50;
  await step('level frame (steady state, again)', () => rig.message('ph-x', rig.build(phone, 'level')));
  const scheduled = rig.scheduler.history.map((h) => `${h.delaySeconds}`);
  await step('deadline check (authenticated: no-op)', () => rig.deliverDeadlines());
  await step('phone $disconnect', () => rig.disconnect('ph-x'));
  await step('tv $disconnect', () => rig.disconnect('tv-x'));
  return { out, scheduled };
}

describe('operation budget per relay step (the inputs of docs/operations/COST.md)', () => {
  it('pins the units of every step', async () => {
    const { out } = await measure();
    expect(out).toEqual({
      'tv $connect': { wru: 3, rru: 0 },
      'room.create': { wru: 8, rru: 2 }, // includes the per-connection id marker of a pre-authentication message (DEF-006)
      'phone $connect': { wru: 3, rru: 0 },
      'join.request': { wru: 6, rru: 5 }, // likewise
      'join.confirm': { wru: 15, rru: 7 },
      'level frame (steady state)': { wru: 4, rru: 2 },
      'level frame (steady state, again)': { wru: 4, rru: 2 },
      'deadline check (authenticated: no-op)': { wru: 0, rru: 3 }, // three queued checks (TV, phone, join), one read each
      'phone $disconnect': { wru: 3, rru: 1 },
      'tv $disconnect': { wru: 3, rru: 1 },
    });
  });

  it('queues exactly the three deadline messages a pairing needs: 5 s, 5 s and 65 s', async () => {
    const { scheduled } = await measure();
    expect(scheduled).toEqual(['5', '5', '65']);
  });

  it('keeps the cost model at least as pessimistic as what the code does (writes) and equal on reads', async () => {
    const mod = (await import(/* @vite-ignore */ `${repo}docs/operations/cost-model.mjs`)) as { ASSUMPTIONS: ModelAssumptions };
    const a = mod.ASSUMPTIONS;
    const { out } = await measure();
    const pairing = ['tv $connect', 'room.create', 'phone $connect', 'join.request', 'join.confirm', 'phone $disconnect', 'tv $disconnect']
      .map((k) => out[k] as Units)
      .reduce(add, { wru: 0, rru: 0 });
    expect(pairing).toEqual({ wru: 41, rru: 16 });
    const modelWru = a.pairingInbound * (a.wruPerInbound + a.wruTouchPerInbound) + a.pairingOutbound * a.wruPerRelayReply + a.connectInvocations * a.wruPerConnectOrDisconnect;
    const modelRru = a.pairingInbound * a.rruPerInbound + a.pairingExtraRru;
    expect(modelWru).toBeGreaterThanOrEqual(pairing.wru);
    expect(modelRru).toBe(pairing.rru);
    const level = out['level frame (steady state)'] as Units;
    expect(level.rru).toBe(a.rruPerInbound);
    expect(level.wru).toBe(a.wruPerInbound);
    expect((out['tv $connect'] as Units).wru).toBe(a.wruPerConnectOrDisconnect);
    expect((out['phone $disconnect'] as Units).wru).toBe(a.wruPerConnectOrDisconnect);
    expect(a.deadlineMessages).toBe(3);
    expect(a.sqsRequestsPerDeadlineMessage).toBe(3);
    expect(a.deadlineRru).toBe(1);
  });
});
