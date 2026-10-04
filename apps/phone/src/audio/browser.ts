import type { AudioPortDeps } from '../ports/audio.js';
import type { MicMode } from '../ports/wire.js';

/**
 * The only place the real browser audio globals are touched. The worklet module is a same-origin
 * file written by the build (vite.config.ts), so the CSP stays `script-src 'self'`.
 */
export function browserAudioDeps(options: {
  mode: MicMode;
  inputOverride?: () => Promise<MediaStream>;
}): AudioPortDeps {
  const deps: AudioPortDeps = {
    mediaDevices: typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined,
    AudioContextCtor: typeof AudioContext !== 'undefined' ? AudioContext : undefined,
    workletModuleUrl: __ATR_WORKLET_URL__,
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext === true,
    mode: options.mode,
  };
  if (typeof AudioWorkletNode !== 'undefined') deps.AudioWorkletNodeCtor = AudioWorkletNode;
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
