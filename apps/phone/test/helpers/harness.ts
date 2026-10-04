import { PhoneController } from '../../src/controller.js';
import { vi } from 'vitest';
import { PhoneMessageFactory } from '../../src/ports/wire.js';
import { WakeLockController } from '../../src/wake-lock.js';
import {
  authOk,
  CODE,
  FakeAudio,
  FakeVisibility,
  FakeWakeLockApi,
  flush,
  joinAccepted,
  joinPending,
  sessionBegin,
  SocketRegistry,
} from './fakes.js';

export interface Harness {
  controller: PhoneController;
  sockets: SocketRegistry;
  audio: FakeAudio;
  wakeApi: FakeWakeLockApi;
  visibility: FakeVisibility;
}

export function makeHarness(
  opts: { secureContext?: boolean; wakeSupported?: boolean; banner?: string | null; random?: () => number } = {},
): Harness {
  const sockets = new SocketRegistry();
  const audio = new FakeAudio();
  const wakeApi = new FakeWakeLockApi();
  const visibility = new FakeVisibility();
  let t = 1_700_000_000_000;
  let counter = 0;
  const factory = new PhoneMessageFactory({
    clock: () => (t += 1),
    randomBytes: (n: number) => {
      counter += 1;
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = i < 3 ? (counter >> (8 * i)) & 255 : 65 + (i % 26);
      return b;
    },
  });
  const controller = new PhoneController({
    audio,
    wakeLock: new WakeLockController(opts.wakeSupported === false ? undefined : wakeApi),
    createSocket: sockets.create,
    relayUrl: 'wss://relay.test/ws',
    secureContext: opts.secureContext ?? true,
    visibility,
    factory,
    defaultDeviceLabel: 'Android Chrome',
    banner: opts.banner ?? null,
    // 0.5 gives exactly the nominal backoff delay (jitter factor 1.0); jitter tests pass their own.
    random: opts.random ?? (() => 0.5),
  });
  return { controller, sockets, audio, wakeApi, visibility };
}

/** Join accepted by the relay, but the user has NOT yet answered "Did you just pick NN on your TV?". */
export async function acceptedHarness(opts: Parameters<typeof makeHarness>[0] = {}): Promise<Harness> {
  const h = makeHarness(opts);
  h.controller.setCode(CODE);
  h.controller.join();
  h.sockets.current.open();
  h.sockets.current.receive(joinPending());
  h.sockets.current.receive(joinAccepted());
  await flush();
  return h;
}

/** Joined, user confirmed ("Yes, that was me"), authenticated, mic closed. */
export async function pairedHarness(opts: Parameters<typeof makeHarness>[0] = {}): Promise<Harness> {
  const h = await acceptedHarness(opts);
  h.controller.confirmPairing();
  await flush();
  return h;
}

/** Reconnect helper: drop, advance timers, open the new socket and authenticate. */
export function resumeSocket(h: Harness): void {
  h.sockets.current.open();
  h.sockets.current.receive(authOk());
}

/** Confirmed, session begun, microphone open (observed). */
export async function readyHarness(opts: Parameters<typeof makeHarness>[0] = {}): Promise<Harness> {
  const h = await pairedHarness(opts);
  h.sockets.current.receive(sessionBegin());
  h.audio.makeOpen();
  await flush();
  return h;
}

/** Advances fake time like a live relay: answers every 10 s ping so the link never looks dead. */
export function advanceLive(h: Harness, ms: number, pong: () => string): void {
  let left = ms;
  while (left > 0) {
    const step = Math.min(left, 10_000);
    vi.advanceTimersByTime(step);
    left -= step;
    if (h.controller.getState().link === 'connected') h.sockets.current.receive(pong());
  }
}
