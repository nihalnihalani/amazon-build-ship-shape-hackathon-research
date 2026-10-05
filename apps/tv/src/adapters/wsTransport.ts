import type { TransportPort, TvInput } from '@atr/session-core';

/**
 * TransportPort over the global WebSocket (ADR-0006, amendment A6-02).
 *
 * It only moves strings: every text frame is handed to the session store as `{ kind: 'wire', message }`
 * (the raw frame, never parsed here) and validation (size, schema, role, window binding) is the store's
 * job. Connection state changes are emitted as `{ kind: 'transport', state }`.
 *
 * Reconnect: exponential backoff 0.5, 1, 2, 4, 8 s (cap 8 s) with +-25 % jitter, reset by a successful
 * open. A connection attempt that neither opens nor closes within CONNECT_TIMEOUT_MS counts as a failure.
 * After FAIL_AFTER_MS (2 minutes) of continuous failure the adapter reports 'failed' once and STOPS: it
 * does nothing more until the store (the user's retry) calls connect() again.
 *
 * Terminal causes: the relay's `revoked`, `expired`, `unauthorized`, `superseded` and `unpaired` mean
 * "return to pairing, do not reconnect". The adapter does not read frames, so the store ends retries by
 * calling close(reason) when it sees one of them; close() is an intentional close, which cancels any
 * pending retry and is honoured until the next connect(). No TransportPort change is needed.
 *
 * The adapter never replays anything: a window that was open when the link dropped is cancelled by the
 * store, and a fresh explicit Start is required after reconnect. Emitted details never contain the URL.
 */

export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;
/** Backoff jitter: each delay is multiplied by a factor in [0.75, 1.25]. */
export const BACKOFF_JITTER = 0.25;
/** Continuous failure for this long reports 'failed' and stops retrying until connect() is called again. */
export const FAIL_AFTER_MS = 120_000;
/** An attempt that has not opened or closed after this long is treated as failed. */
export const CONNECT_TIMEOUT_MS = 15_000;
const WS_OPEN = 1;

/** Un-jittered delay for the Nth consecutive failure (1-based): 500, 1000, 2000, 4000, 8000, 8000, ... */
export function backoffBaseMs(consecutiveFailures: number): number {
  const index = Math.min(Math.max(consecutiveFailures, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[index] ?? 8000;
}

/** Jittered delay: base * (1 + (2r - 1) * 0.25) with r in [0, 1], rounded to whole milliseconds. */
export function backoffDelayMs(consecutiveFailures: number, random: () => number = Math.random): number {
  const draw = random();
  const r = Number.isFinite(draw) ? Math.min(1, Math.max(0, draw)) : 0.5;
  return Math.round(backoffBaseMs(consecutiveFailures) * (1 + (2 * r - 1) * BACKOFF_JITTER));
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
  /** Uniform random source in [0, 1) for jitter. */
  random?: () => number;
  now?: () => number;
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
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  let emit: (input: TvInput) => void = () => undefined;
  let socket: WebSocketLike | null = null;
  let currentUrl: string | null = null;
  let generation = 0;
  let failures = 0;
  /** Time of the first failure of the current streak; null while connected or before any failure. */
  let streakStart: number | null = null;
  /** True after 'failed' was reported: nothing runs until connect() is called again. */
  let stopped = false;
  let retryTimer: unknown = null;
  let connectTimer: unknown = null;
  let intentionalClose = false;

  function emitState(state: 'offline' | 'connecting' | 'connected' | 'reconnecting' | 'failed', detail?: string): void {
    emit(detail === undefined ? { kind: 'transport', state } : { kind: 'transport', state, detail });
  }

  function clearConnectTimer(): void {
    if (connectTimer !== null) {
      clearTimer(connectTimer);
      connectTimer = null;
    }
  }

  function clearRetryTimer(): void {
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
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
    clearConnectTimer();
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
    connectTimer = setTimer(() => {
      connectTimer = null;
      handleDrop(mine, 'connect_timeout');
    }, CONNECT_TIMEOUT_MS);
    created.onopen = () => {
      if (mine !== generation) return;
      clearConnectTimer();
      failures = 0;
      streakStart = null;
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
    if (mine !== generation || intentionalClose || stopped || retryTimer !== null) return;
    clearConnectTimer();
    failures += 1;
    const t = now();
    if (streakStart === null) streakStart = t;
    detachSocket(socket);
    socket = null;
    const deadline = streakStart + FAIL_AFTER_MS;
    if (t >= deadline) {
      stopped = true;
      emitState('failed', 'relay_unreachable');
      return;
    }
    if (failures === 1) emitState('reconnecting', detail);
    const url = currentUrl;
    if (url === null) return;
    // The last attempt of a streak lands exactly on the deadline instead of overshooting it.
    const delay = Math.min(backoffDelayMs(failures, random), deadline - t);
    retryTimer = setTimer(() => {
      retryTimer = null;
      if (intentionalClose || stopped || currentUrl !== url) return;
      open(url, true);
    }, delay);
  }

  return {
    attach(next) {
      emit = next;
    },
    connect(url) {
      intentionalClose = false;
      stopped = false;
      clearRetryTimer();
      failures = 0;
      streakStart = null;
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
      clearRetryTimer();
      clearConnectTimer();
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
