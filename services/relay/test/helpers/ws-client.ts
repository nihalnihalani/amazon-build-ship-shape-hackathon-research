import { WebSocket, type ClientOptions } from 'ws';
import type { MessageType, Role } from '../../src/core/index.js';
import { buildEnvelope, type SendOptions, type SenderState } from './envelope.js';

export interface WsReceived {
  type: MessageType;
  raw: string;
  env: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/** A real WebSocket client used by the local-server integration tests. */
export class WsClient implements SenderState {
  inbox: WsReceived[] = [];
  closeInfo: { code: number; reason: string } | null = null;
  roomId: string | null = null;
  role: Role | null;
  generation = 0;
  nextSeq = 0;
  credential: string | null = null;
  private waiters: { pred: () => boolean; resolve: () => void }[] = [];
  private constructor(
    readonly ws: WebSocket,
    role: Role | null,
    private readonly clock: () => number,
  ) {
    this.role = role;
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      const raw = data.toString('utf8');
      const env = JSON.parse(raw) as Record<string, unknown>;
      this.inbox.push({ type: env.type as MessageType, raw, env, payload: env.payload as Record<string, unknown> });
      this.notify();
    });
    ws.on('close', (code: number, reason: Buffer) => {
      this.closeInfo = { code, reason: reason.toString('utf8') };
      this.notify();
    });
  }

  static async open(
    url: string,
    role: Role | null,
    options: ClientOptions,
    clock: () => number = Date.now,
  ): Promise<WsClient> {
    const ws = new WebSocket(url, options);
    const c = new WsClient(ws, role, clock);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`unexpected-response ${res.statusCode}`)));
    });
    return c;
  }

  /** Attempts a connection and returns the HTTP status of a refused upgrade, or 101 when accepted. */
  static async probe(url: string, options: ClientOptions): Promise<number> {
    const ws = new WebSocket(url, options);
    return new Promise<number>((resolve) => {
      ws.once('open', () => {
        ws.close();
        resolve(101);
      });
      ws.once('unexpected-response', (_req, res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      ws.once('error', () => resolve(0));
    });
  }

  private notify(): void {
    this.waiters = this.waiters.filter((w) => {
      if (w.pred()) {
        w.resolve();
        return false;
      }
      return true;
    });
  }

  waitFor(pred: () => boolean, timeoutMs = 5000, what = 'condition'): Promise<void> {
    if (pred()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(`timeout waiting for ${what}; inbox=[${this.inbox.map((m) => m.type).join(',')}] closed=${JSON.stringify(this.closeInfo)}`)),
        timeoutMs,
      );
      this.waiters.push({
        pred,
        resolve: () => {
          clearTimeout(t);
          resolve();
        },
      });
    });
  }

  async next(type: MessageType, after = 0, timeoutMs = 5000): Promise<WsReceived> {
    await this.waitFor(() => this.inbox.slice(after).some((m) => m.type === type), timeoutMs, `message ${type}`);
    return this.inbox.slice(after).find((m) => m.type === type) as WsReceived;
  }

  of(type: MessageType): WsReceived[] {
    return this.inbox.filter((m) => m.type === type);
  }

  send(type: MessageType, o: SendOptions = {}): string {
    const raw = buildEnvelope(this, type, this.clock(), o);
    this.ws.send(raw);
    return raw;
  }

  sendRaw(data: string | Buffer, binary = false): void {
    this.ws.send(data, { binary });
  }

  waitClosed(timeoutMs = 5000): Promise<{ code: number; reason: string }> {
    return this.waitFor(() => this.closeInfo !== null, timeoutMs, 'close').then(() => this.closeInfo as { code: number; reason: string });
  }

  close(): void {
    this.ws.close();
  }
}
