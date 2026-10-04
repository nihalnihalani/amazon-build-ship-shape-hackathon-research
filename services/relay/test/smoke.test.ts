import { describe, expect, it } from 'vitest';
import { Rig } from './helpers/rig.js';

describe('smoke', () => {
  it('pairs and forwards', async () => {
    const rig = new Rig();
    const tv = await rig.tvCreate();
    const phone = await rig.pair(tv);
    await rig.startSession(tv);
    await rig.send(phone, 'level');
    expect(tv.of('level')).toHaveLength(1);
    expect(tv.errors()).toEqual([]);
    expect(phone.errors()).toEqual([]);
    rig.assertNoLeaks();
  });
});
