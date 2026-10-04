import workletUrl from './frame-reducer.worklet.js?url';
import type { AudioContextLike, CaptureDeps, WorkletNodeLike } from './capture.js';
import type { MicMode } from '../ports/wire.js';

/** The only place the real browser audio globals are touched. */
export function browserCaptureDeps(options: {
  mode: MicMode;
  inputOverride?: () => Promise<MediaStream>;
}): CaptureDeps {
  const deps: CaptureDeps = {
    mediaDevices: typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined,
    createAudioContext: () => new AudioContext({ latencyHint: 'interactive' }) as unknown as AudioContextLike,
    createWorkletNode: (context) =>
      new AudioWorkletNode(context as unknown as AudioContext, 'atr-frame-reducer', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        outputChannelCount: [1],
      }) as unknown as WorkletNodeLike,
    workletUrl,
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext === true,
    mode: options.mode,
  };
  if (options.inputOverride) deps.inputOverride = options.inputOverride;
  return deps;
}

/** Self-reported context only (PROTOCOL.md): localhost means this is the Mac's own microphone. */
export function detectMicMode(hostname: string, synthetic: boolean): MicMode {
  if (synthetic) return 'fixture_replay';
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost')
    ? 'same_host'
    : 'physical_phone';
}
