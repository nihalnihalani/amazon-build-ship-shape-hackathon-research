import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../src/view.js';
import { ATTEMPT2, flush, precheckStart, validPrecheck, validWindow, WINDOW2, windowStart } from './helpers/fakes.js';
import { type Harness, readyHarness } from './helpers/harness.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const silent = (purpose: 'quiet_check' | 'pre_window' = 'quiet_check') =>
  ({ ...validPrecheck(purpose), valid: false, invalid_reason: 'silent_input', floor_dbfs: -140 }) as never;

async function finishPrecheck(h: Harness, payload: ReturnType<typeof validPrecheck>, w?: string): Promise<void> {
  h.sockets.current.receive(w ? precheckStart('quiet_check', w, ATTEMPT2) : precheckStart('quiet_check'));
  h.audio.startedMeasuring();
  h.audio.finishPrecheck(payload);
  await flush();
}

describe('silent_input: "The microphone looks muted or blocked"', () => {
  it('a precheck with no signal sets the notice, shown on the page and announced', async () => {
    const h = await readyHarness();
    document.body.replaceChildren();
    const view = mountView(document.body.appendChild(document.createElement('div')), h.controller);
    await finishPrecheck(h, silent());
    expect(h.controller.getState().micNotice).toBe('silent_input');
    const notice = document.getElementById('mic-notice') as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('The microphone looks muted or blocked');
    expect(document.getElementById('status')?.textContent).toBe('The microphone looks muted or blocked.');
    view.destroy();
  });

  it('works for the pre-window check too, and clears after a good precheck', async () => {
    const h = await readyHarness();
    await finishPrecheck(h, silent('pre_window'));
    expect(h.controller.getState().micNotice).toBe('silent_input');
    await finishPrecheck(h, validPrecheck('quiet_check'), WINDOW2);
    expect(h.controller.getState().micNotice).toBeNull();
  });

  it('other precheck failures do not show it', async () => {
    const h = await readyHarness();
    await finishPrecheck(h, { ...validPrecheck(), valid: false, invalid_reason: 'too_loud', floor_dbfs: -20 });
    expect(h.controller.getState().micNotice).toBeNull();
  });

  it('is cleared when the microphone is turned off or restarted', async () => {
    const h = await readyHarness();
    await finishPrecheck(h, silent());
    h.controller.stopMic();
    await flush();
    expect(h.controller.getState().micNotice).toBeNull();
    h.audio.makeOpen();
    await finishPrecheck(h, silent(), WINDOW2);
    h.audio.setState('permission_pending');
    expect(h.controller.getState().micNotice).toBeNull();
  });

  it('only prechecks produce it: no window result ever sets it, and the phone still shows no verdict', async () => {
    const h = await readyHarness();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    h.audio.finishWindow({ ...validWindow(), valid: false, invalid_reason: 'no_voice' });
    await flush();
    expect(h.controller.getState().micNotice).toBeNull();
    expect(document.body.textContent).not.toMatch(/no voice|no_voice/i);
  });
});
