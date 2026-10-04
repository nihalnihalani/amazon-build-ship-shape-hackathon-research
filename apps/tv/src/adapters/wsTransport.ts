import type { TransportPort, TvInput } from '@atr/session-core';

/**
 * TransportPort over the global WebSocket (ADR-0006).
 *
 * It only moves strings: every text frame is handed to the session store as `{ kind: 'wire', message }`
 * and validation (size, schema, role, window binding) is the store's job. Connection state changes are
 * emitted as `{ kind: 'transport', state }`.
 *
 * Reconnect: exponential backoff 0.5, 1, 2, 4, 8 s, capped at 8 s, reset by a successful open. Retries
 * continue indefinitely at the cap; after FAILED_AFTER consecutive failures the state is reported as
 * 'failed' (once) so the UI can say so while retries go on quietly. The adapter never replays anything:
 * a window that was open when the link dropped is cancelled by the store, and a fresh explicit Start is
 * required after reconnect.
 *
 * Details never contain the URL (it may be configured with a path the owner considers private).
 */

export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;
export const FAILED_AFTER = 6;
const WS_OPEN = 1;

export function backoffDelayMs(consecutiveFailures: number): number {
  const index = Math.min(Math.max(consecutiveFailures, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[index] ?? 8000;
}

export interface WebSocketLike {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface WsTransportOptions {
  createSocket?: (url: string) => WebSocketLike;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface WsTransport extends TransportPort {
  /** Connect the adapter to the session store (called once after the store is created). */
  attach(emit: (input: TvInput) => void): void;
}

export function createWsTransport(options: WsTransportOptions = {}): WsTransport {
  const createSocket =
    options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
  const setTimer = options.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let emit: (input: TvInput) => void = () => undefined;
  let socket: WebSocketLike | null = null;
  let currentUrl: string | null = null;
  let generation = 0;
  let failures = 0;
  let reportedFailed = false;
  let retryTimer: unknown = null;
  let intentionalClose = false;

  function emitState(state: 'offline' | 'connecting' | 'connected' | 'reconnecting' | 'failed', detail?: string): void {
    emit(detail === undefined ? { kind: 'transport', state } : { kind: 'transport', state, detail });
  }

  function detachSocket(target: WebSocketLike | null): void {
    if (target === null) return;
    target.onopen = null;
    target.onmessage = null;
    target.onclose = null;
    target.onerror = null;
    try {
      target.close(1000, 'client_closing');
    } catch {
      // Closing an already dead socket is not an error worth surfacing.
    }
  }

  function open(url: string, isRetry: boolean): void {
    generation += 1;
    const mine = generation;
    detachSocket(socket);
    socket = null;
    if (!isRetry) emitState('connecting');
    let created: WebSocketLike;
    try {
      created = createSocket(url);
    } catch {
      handleDrop(mine, 'socket_error');
      return;
    }
    socket = created;
    created.onopen = () => {
      if (mine !== generation) return;
      failures = 0;
      reportedFailed = false;
      emitState('connected');
    };
    created.onmessage = (event) => {
      if (mine !== generation) return;
      if (typeof event.data === 'string') emit({ kind: 'wire', message: event.data });
    };
    created.onerror = () => handleDrop(mine, 'socket_error');
    created.onclose = () => handleDrop(mine, 'socket_closed');
  }

  function handleDrop(mine: number, detail: string): void {
    if (mine !== generation || intentionalClose || retryTimer !== null) return;
    failures += 1;
    detachSocket(socket);
    socket = null;
    if (failures >= FAILED_AFTER && !reportedFailed) {
      reportedFailed = true;
      emitState('failed', 'relay_unreachable');
    } else if (!reportedFailed) {
      emitState('reconnecting', detail);
    }
    const url = currentUrl;
    if (url === null) return;
    retryTimer = setTimer(() => {
      retryTimer = null;
      if (intentionalClose || currentUrl !== url) return;
      open(url, true);
    }, backoffDelayMs(failures));
  }

  return {
    attach(next) {
      emit = next;
    },
    connect(url) {
      intentionalClose = false;
      if (retryTimer !== null) {
        clearTimer(retryTimer);
        retryTimer = null;
      }
      failures = 0;
      reportedFailed = false;
      currentUrl = url;
      open(url, false);
    },
    send(serialized) {
      if (socket === null || socket.readyState !== WS_OPEN) return false;
      try {
        socket.send(serialized);
        return true;
      } catch {
        return false;
      }
    },
    close(reason) {
      intentionalClose = true;
      generation += 1;
      if (retryTimer !== null) {
        clearTimer(retryTimer);
        retryTimer = null;
      }
      currentUrl = null;
      const target = socket;
      socket = null;
      if (target !== null) {
        target.onopen = null;
        target.onmessage = null;
        target.onclose = null;
        target.onerror = null;
        try {
          target.close(1000, reason.slice(0, 100));
        } catch {
          // already closed
        }
      }
      emitState('offline', reason);
    },
  };
}
