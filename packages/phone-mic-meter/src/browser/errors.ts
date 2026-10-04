/**
 * Classification of getUserMedia failures into PROTOCOL.md MicStatePayload.state values.
 * `detail` is a short machine-readable code (≤ 64 characters of [A-Za-z0-9_]) that fits the
 * protocol's `detail: string(0..64)` fields; it never contains user or device text.
 */

import type { MicStateName } from '../types.js';

export interface MicErrorClass {
  state: MicStateName;
  detail: string | null;
}

function sanitizeDetail(text: string): string {
  return text.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
}

export function classifyMicError(err: unknown): MicErrorClass {
  const name =
    typeof err === 'object' && err !== null && typeof (err as { name?: unknown }).name === 'string'
      ? ((err as { name: string }).name)
      : '';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return { state: 'permission_denied', detail: null };
    case 'SecurityError':
      return { state: 'error', detail: 'insecure_context' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { state: 'no_input', detail: null };
    case 'OverconstrainedError': {
      const constraint = (err as { constraint?: unknown }).constraint;
      if (constraint === 'deviceId') return { state: 'no_input', detail: 'device_unavailable' };
      return {
        state: 'constraints_unsupported',
        detail: typeof constraint === 'string' ? sanitizeDetail(constraint) : null,
      };
    }
    case 'NotReadableError':
    case 'AbortError':
    case 'TrackStartError':
      return { state: 'input_busy', detail: null };
    case 'TypeError':
      return { state: 'error', detail: 'type_error' };
    default:
      return { state: 'error', detail: name === '' ? 'unknown_error' : sanitizeDetail(`unknown_${name}`) };
  }
}
