/// <reference types="vite/client" />

/** Compile-time flag set by vite.config.ts: true only for the test-audio build (dist-test). */
declare const __ATR_TEST_AUDIO__: boolean;

interface ImportMetaEnv {
  /** The validated build-time relay URL (a wss:// URL), or '' for same origin. Set by vite.config.ts. */
  readonly VITE_ATR_RELAY_URL?: string;
}

/** Same-origin URL of the AudioWorklet module written by the build (frame-processor.js plus a content hash query). */
declare const __ATR_WORKLET_URL__: string;
