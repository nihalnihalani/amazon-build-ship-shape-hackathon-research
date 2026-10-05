import { HEARTBEAT_MS, LINK_DEAD_MS, RECONNECT_BACKOFF_MS, RECONNECT_JITTER } from './config.js';

/** The subset of WebSocket the transport uses (handlers are assigned as properties). */
export interface SocketLike {
  readonly readyState: number;
  /** Bytes queued by send() but not yet handed to the network; absent when the socket does not say. */
  readonly bufferedAmount?: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export const SOCKET_OPEN = 1;

export type SocketFactory = (url: string) => SocketLike;

export interface TransportHandlers {
  onOpen(): void;
  onText(text: string): void;
  /** Fired once per socket when it closes or is declared dead (not for deliberate close()). */
  onClose(info: { code: number | null; wasOpen: boolean; reason: 'closed' | 'link_dead' | 'error' }): void;
}

/**
 * Delay for the nth consecutive reconnect (0-based): 0.5, 1, 2, 4, 8, 8, 8 ... seconds, each
 * multiplied by a jitter factor in [0.75, 1.25). `random()` returns a value in [0, 1); 0.5 gives
 * exactly the nominal delay. Jitter spreads out many phones retrying after a relay restart.
 */
export function backoffDelay(
  attempt: number,
  schedule: readonly number[] = RECONNECT_BACKOFF_MS,
  random: () => number = Math.random,
): number {
  const i = Math.min(Math.max(0, attempt), schedule.length - 1);
  const base = schedule[i] as number;
  const r = Math.min(Math.max(random(), 0), 1);
  return Math.round(base * (1 - RECONNECT_JITTER + 2 * RECONNECT_JITTER * r));
}

/**
 * Owns one socket at a time: open, send, heartbeat (ping every 10 s, link declared dead
 * after 25 s without any inbound traffic) and the reconnect timer. Reconnect *policy*
 * (when to retry, what to send on open) belongs to the controller.
 */
export class Transport {
  private sock: SocketLike | null = null;
  private opened = false;
  private lastRxAt = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private buildPing: (() => string | null) | null = null;

  constructor(
    private readonly createSocket: SocketFactory,
    private readonly handlers: TransportHandlers,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** How much the socket is still holding back; a growing number means the link is stalled. */
  get bufferedAmount(): number {
    const n = this.sock?.bufferedAmount;
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
  }

  get isOpen(): boolean {
    return this.sock !== null && this.opened && this.sock.readyState === SOCKET_OPEN;
  }

  open(url: string): void {
    this.cancelRetry();
    this.discard();
    const sock = this.createSocket(url);
    this.sock = sock;
    this.opened = false;
    this.lastRxAt = this.now();
    sock.onopen = () => {
      if (this.sock !== sock) return;
      this.opened = true;
      this.lastRxAt = this.now();
      this.handlers.onOpen();
    };
    sock.onmessage = (event) => {
      if (this.sock !== sock) return;
      this.lastRxAt = this.now();
      if (typeof event.data === 'string') this.handlers.onText(event.data);
    };
    sock.onerror = () => {
      // A close event always follows; nothing to do here.
    };
    sock.onclose = (event) => {
      if (this.sock !== sock) return;
      const wasOpen = this.opened;
      this.sock = null;
      this.opened = false;
      this.stopHeartbeat();
      this.handlers.onClose({ code: event.code ?? null, wasOpen, reason: wasOpen ? 'closed' : 'error' });
    };
  }

  send(text: string): boolean {
    if (!this.isOpen || this.sock === null) return false;
    try {
      this.sock.send(text);
      return true;
    } catch {
      return false;
    }
  }

  /** Starts pings every 10 s; `buildPing` returns the serialized ping (or null to skip). */
  startHeartbeat(buildPing: () => string | null): void {
    this.stopHeartbeat();
    this.buildPing = buildPing;
    this.lastRxAt = this.now();
    this.heartbeat = setInterval(() => this.tick(), HEARTBEAT_MS);
  }

  stopHeartbeat(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.buildPing = null;
  }

  private tick(): void {
    if (this.sock === null) return;
    if (this.now() - this.lastRxAt > LINK_DEAD_MS) {
      // Peer unknown: treat the link as dead and let the controller reconnect.
      const sock = this.sock;
      this.sock = null;
      this.opened = false;
      this.stopHeartbeat();
      sock.onclose = null;
      sock.onmessage = null;
      try {
        sock.close(4000, 'link_dead');
      } catch {
        /* ignore */
      }
      this.handlers.onClose({ code: null, wasOpen: true, reason: 'link_dead' });
      return;
    }
    const ping = this.buildPing?.();
    if (ping) this.send(ping);
  }

  scheduleRetry(delayMs: number, url: string): void {
    this.cancelRetry();
    this.retry = setTimeout(() => {
      this.retry = null;
      this.open(url);
    }, delayMs);
  }

  cancelRetry(): void {
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
  }

  /** Deliberate shutdown: no further events, no reconnect. */
  close(): void {
    this.cancelRetry();
    this.stopHeartbeat();
    this.discard();
  }

  private discard(): void {
    const sock = this.sock;
    this.sock = null;
    this.opened = false;
    if (sock === null) return;
    sock.onopen = null;
    sock.onmessage = null;
    sock.onclose = null;
    sock.onerror = null;
    try {
      sock.close(1000, 'client_close');
    } catch {
      /* ignore */
    }
  }
}
