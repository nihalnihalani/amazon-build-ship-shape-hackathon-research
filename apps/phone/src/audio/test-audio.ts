/**
 * TEST BUILD ONLY (dist-test). Never reachable from the production graph: main.ts imports
 * this module behind the compile-time flag, and a test asserts the production bundle contains
 * none of its strings.
 *
 * Synthetic audio stands in for a microphone so automated tests can drive the full phone flow
 * in desktop Chrome without a real input device:
 *   OscillatorNode -> GainNode -> MediaStreamAudioDestinationNode  (stream handed to the audio port)
 * `window.__atrTestAudio.setLevelDbfs(x)` sets the sine so its RMS is x dBFS.
 */

export const TEST_AUDIO_BANNER = 'Synthetic test audio — not a microphone';

/** A sine of amplitude A has RMS A / sqrt(2), so A = sqrt(2) * 10^(dbfs / 20). */
export function gainForDbfs(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return 0;
  return Math.SQRT2 * Math.pow(10, dbfs / 20);
}

interface Hooks {
  setLevelDbfs(dbfs: number): void;
  setSilence(): void;
  getState(): { levelDbfs: number | null; streamOpen: boolean };
}

declare global {
  interface Window {
    __atrTestAudio?: Hooks;
  }
}

export interface TestAudioHandle {
  createStream(): Promise<MediaStream>;
  hooks: Hooks;
}

export function installTestAudio(target: Window & typeof globalThis): TestAudioHandle {
  let levelDbfs: number | null = null; // null = silence
  let gain: GainNode | null = null;
  let ctx: AudioContext | null = null;

  const apply = (): void => {
    if (gain && ctx) gain.gain.setValueAtTime(levelDbfs === null ? 0 : gainForDbfs(levelDbfs), ctx.currentTime);
  };

  const hooks: Hooks = {
    setLevelDbfs(dbfs: number): void {
      if (typeof dbfs !== 'number' || !Number.isFinite(dbfs)) throw new TypeError('dbfs must be a finite number');
      levelDbfs = dbfs;
      apply();
    },
    setSilence(): void {
      levelDbfs = null;
      apply();
    },
    getState: () => ({ levelDbfs, streamOpen: ctx !== null && ctx.state !== 'closed' }),
  };

  const createStream = async (): Promise<MediaStream> => {
    // Fresh graph per open: the previous stream's track was stopped by the port.
    if (ctx) void ctx.close().catch(() => undefined);
    ctx = new target.AudioContext();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 220;
    gain = ctx.createGain();
    gain.gain.value = 0;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    if (ctx.state === 'suspended') await ctx.resume();
    apply();
    return dest.stream;
  };

  target.__atrTestAudio = hooks;
  return { createStream, hooks };
}
