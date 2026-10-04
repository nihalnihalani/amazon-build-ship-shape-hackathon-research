/// <reference types="vite/client" />

/** Compile-time flag set by vite.config.ts: true only for the test-audio build (dist-test). */
declare const __ATR_TEST_AUDIO__: boolean;

/** Same-origin URL of the AudioWorklet module written by the build (frame-processor.js plus a content hash query). */
declare const __ATR_WORKLET_URL__: string;
