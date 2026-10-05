import './styles.css';
import { browserAudioDeps, detectMicMode } from './audio/browser.js';
import { BUILD_RELAY_URL, defaultDeviceLabel, resolveRelayUrl } from './config.js';
import { createAudioPort } from './ports/audio.js';
import { PhoneController, type VisibilitySource } from './controller.js';
import { consumeHashCode } from './pairing.js';
import { type SocketLike } from './transport.js';
import { mountView } from './view.js';
import { WakeLockController, type WakeLockApi } from './wake-lock.js';

const visibility: VisibilitySource = {
  get: () => (document.visibilityState === 'hidden' ? 'hidden' : 'visible'),
  subscribe: (listener) => {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;

  // Test build only: synthetic audio replaces the microphone. In the production build this
  // branch is removed at compile time, so none of the test strings or hooks ship.
  let inputOverride: (() => Promise<MediaStream>) | undefined;
  let banner: string | null = null;
  if (__ATR_TEST_AUDIO__) {
    const test = await import('./audio/test-audio.js');
    inputOverride = test.installTestAudio(window).createStream;
    banner = test.TEST_AUDIO_BANNER;
  }

  const synthetic = inputOverride !== undefined;
  const audio = createAudioPort(
    browserAudioDeps({
      mode: detectMicMode(location.hostname, synthetic),
      ...(inputOverride ? { inputOverride } : {}),
    }),
  );
  const wakeApi = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  const controller = new PhoneController({
    audio,
    wakeLock: new WakeLockController(wakeApi),
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    relayUrl: resolveRelayUrl(location, __ATR_TEST_AUDIO__, BUILD_RELAY_URL),
    secureContext: window.isSecureContext === true,
    visibility,
    defaultDeviceLabel: defaultDeviceLabel(navigator.userAgent),
    banner,
  });

  // `#code=XXXXXX`: the fragment is never sent to a server. Read it once, then clear it.
  const code = consumeHashCode({ location, history });
  if (code) controller.setCode(code);

  mountView(root, controller);
  window.addEventListener('pagehide', () => controller.dispose());
}

void boot();
