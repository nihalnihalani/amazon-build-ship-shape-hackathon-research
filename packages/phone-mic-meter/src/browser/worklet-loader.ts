/**
 * Loads the frame processor into an AudioContext.
 *
 * Default: a Blob URL built from FRAME_PROCESSOR_SOURCE (the page CSP must then allow
 * `blob:` for scripts). Alternative: pass `moduleUrl` to load a static file that the phone
 * build wrote from FRAME_PROCESSOR_SOURCE (no `blob:` allowance needed).
 */

import { FRAME_PROCESSOR_SOURCE } from './worklet-source.js';

export interface WorkletTarget {
  audioWorklet: { addModule(moduleUrl: string): Promise<void> };
}

export interface WorkletLoadOptions {
  /** Load this module URL instead of a Blob URL. */
  moduleUrl?: string;
  /** Injection points for tests; default to the browser globals. */
  BlobCtor?: new (parts: string[], options?: { type?: string }) => unknown;
  urlApi?: {
    createObjectURL(blob: never): string;
    revokeObjectURL(url: string): void;
  };
}

export async function loadFrameProcessor(
  context: WorkletTarget,
  options: WorkletLoadOptions = {},
): Promise<void> {
  if (options.moduleUrl !== undefined) {
    await context.audioWorklet.addModule(options.moduleUrl);
    return;
  }
  const BlobCtor = options.BlobCtor ?? globalThis.Blob;
  const urlApi = options.urlApi ?? globalThis.URL;
  if (typeof BlobCtor !== 'function' || urlApi === undefined) {
    throw new Error('blob_url_unavailable');
  }
  const blob = new BlobCtor([FRAME_PROCESSOR_SOURCE], { type: 'text/javascript' });
  const url = urlApi.createObjectURL(blob as never);
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    urlApi.revokeObjectURL(url);
  }
}
