/**
 * T16 security gate helpers (independent reviewer, role security-review).
 *
 * Black-box tooling for the security tests: a real local relay process (the same one tests/src/e2e-env.ts
 * starts, with the dev CA), raw WebSocket clients built on the `ws` package that send any frame with any
 * Origin, and catalogue-driven message builders that do not go through the production client code. Nothing
 * here imports relay internals: the relay is reached only through its sockets and its stdout.
 *
 * Evidence class of every test that uses it: automated (local relay process, raw sockets). Never real_phone,
 * real_VVD or AWS.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { specFor, type MessageType } from '@atr/protocol';
import { ROOT } from '../src/e2e-env.js';

export { ROOT };
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ certificates and relay process */

let sharedCertDir: string | null = null;
export function certDir(): string {
  if (sharedCertDir === null) {
    sharedCertDir = mkdtempSync(path.join(os.tmpdir(), 'atr-sec-certs-'));
    execFileSync('bash', [path.join(ROOT, 'scripts/dev-certs/make-dev-certs.sh'), '--out', sharedCertDir], { stdio: 'pipe' });
    process.on('exit', () => {
      if (sharedCertDir !== null) rmSync(sharedCertDir, { recursive: true, force: true });
    });
  }
  return sharedCertDir;
}

export interface SecRelay {
  port: number;
  /** The relay's own https origin (the page origin when it serves the phone page). */
  origin: string;
  /** The phone origin the relay was configured to accept. Equal to `origin` unless overridden. */
  phoneOrigin: string;
  /** Preview origin if one was configured. */
  previewOrigin: string | null;
  wsUrl: string;
  ca: Buffer;
  proc: ChildProcess;
  /** Everything the relay process wrote to stdout and stderr, in order. */
  logs: string[];
  stop(): Promise<void>;
}

export interface RelayOptions {
  /** Directory served at /. Defaults to the production phone build. */
  staticDir?: string;
  /** Extra or overriding environment variables (ATR_*). */
  env?: Record<string, string>;
  /** Phone origin to allow instead of the relay's own origin (needed for ATR_ENV=production). */
  phoneOrigin?: string;
  previewOrigin?: string;
  tickMs?: number;
}

function healthz(port: number, ca: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get({ host: 'localhost', port, path: '/healthz', ca, timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function relayEnv(port: number, opts: RelayOptions): { env: NodeJS.ProcessEnv; phoneOrigin: string } {
  const dir = certDir();
  const origin = `https://localhost:${port}`;
  const phoneOrigin = opts.phoneOrigin ?? origin;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ATR_PORT: String(port),
    ATR_HOST: '127.0.0.1',
    ATR_ALLOWED_ORIGINS: phoneOrigin,
    ATR_STATIC_DIR: opts.staticDir ?? path.join(ROOT, 'apps/phone/dist'),
    ATR_TLS_CERT: path.join(dir, 'server.crt'),
    ATR_TLS_KEY: path.join(dir, 'server.key'),
    ATR_TICK_MS: String(opts.tickMs ?? 1000),
    ...(opts.previewOrigin ? { ATR_TV_PREVIEW_ORIGINS: opts.previewOrigin } : {}),
    ...(opts.env ?? {}),
  };
  return { env, phoneOrigin };
}

export async function startSecRelay(opts: RelayOptions = {}): Promise<SecRelay> {
  const ca = readFileSync(path.join(certDir(), 'ca.crt'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const { env, phoneOrigin } = relayEnv(port, opts);
  const logs: string[] = [];
  const proc = spawn(process.execPath, [path.join(ROOT, 'services/relay/dist/local/main.js')], {
    cwd: path.join(ROOT, 'services/relay'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (d) => logs.push(String(d)));
  proc.stderr?.on('data', (d) => logs.push(String(d)));
  const start = Date.now();
  while (!(await healthz(port, ca))) {
    if (proc.exitCode !== null) throw new Error(`relay exited (${proc.exitCode}): ${logs.join('')}`);
    if (Date.now() - start > 15_000) {
      proc.kill('SIGKILL');
      throw new Error(`relay did not become healthy: ${logs.join('')}`);
    }
    await sleep(150);
  }
  return {
    port,
    origin: `https://localhost:${port}`,
    phoneOrigin,
    previewOrigin: opts.previewOrigin ?? null,
    wsUrl: `wss://localhost:${port}/ws`,
    ca,
    proc,
    logs,
    stop: async () => {
      proc.kill('SIGTERM');
      await sleep(250);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    },
  };
}

/** Starts the relay expecting it to refuse its configuration; returns its exit code and output. */
export async function relayConfigOutcome(opts: RelayOptions): Promise<{ exitCode: number | null; output: string }> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const { env } = relayEnv(port, opts);
  const logs: string[] = [];
  const proc = spawn(process.execPath, [path.join(ROOT, 'services/relay/dist/local/main.js')], {
    cwd: path.join(ROOT, 'services/relay'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (d) => logs.push(String(d)));
  proc.stderr?.on('data', (d) => logs.push(String(d)));
  const end = Date.now() + 5000;
  while (proc.exitCode === null && Date.now() < end) await sleep(50);
  const exitCode = proc.exitCode;
  if (exitCode === null) proc.kill('SIGKILL');
  return { exitCode, output: logs.join('') };
}

/* ------------------------------------------------------------------ raw WebSocket client */

export interface Msg {
  type: string;
  message_id: string;
  room_id: string | null;
  session_id: string | null;
  window_id: string | null;
  attempt_id: string | null;
  sender_role: string;
  producer_generation: number;
  sequence: number;
  event_timestamp: number;
  payload: Record<string, unknown>;
}

export type ConnectResult =
  | { opened: true; client: RawClient }
  | { opened: false; status: number | null; error: string };

export class RawClient {
  readonly inbox: Msg[] = [];
  readonly frames: string[] = [];
  readonly binaryFrames: number[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: Array<() => void> = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.binaryFrames.push(Array.isArray(data) ? data.length : (data as Buffer).length);
      } else {
        const text = (Array.isArray(data) ? Buffer.concat(data) : (data as Buffer)).toString('utf8');
        this.frames.push(text);
        try {
          this.inbox.push(JSON.parse(text) as Msg);
        } catch {
          /* kept in frames */
        }
      }
      this.wake();
    });
    ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString('utf8') };
      this.wake();
    });
    ws.on('error', () => this.wake());
  }

  private wake(): void {
    for (const w of this.waiters.splice(0)) w();
  }

  /** Connects with an optional Origin header ("absent" sends none) and reports an HTTP refusal as a status. */
  static async connect(relay: SecRelay, opts: { origin?: string | null; headers?: Record<string, string> } = {}): Promise<ConnectResult> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.origin !== undefined && opts.origin !== null) headers['Origin'] = opts.origin;
    return new Promise((resolve) => {
      const ws = new WebSocket(relay.wsUrl, { ca: relay.ca, headers, perMessageDeflate: false });
      let settled = false;
      const done = (r: ConnectResult): void => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      ws.once('open', () => done({ opened: true, client: new RawClient(ws) }));
      ws.once('unexpected-response', (_req, res) => {
        res.resume();
        done({ opened: false, status: res.statusCode ?? null, error: 'unexpected-response' });
      });
      ws.once('error', (e) => done({ opened: false, status: null, error: e.message }));
    });
  }

  static async open(relay: SecRelay, origin?: string | null): Promise<RawClient> {
    const r = await RawClient.connect(relay, origin === undefined ? {} : { origin });
    if (!r.opened) throw new Error(`could not connect (${r.status ?? r.error})`);
    return r.client;
  }

  send(text: string): void {
    this.ws.send(text);
  }

  sendBinary(data: Buffer): void {
    this.ws.send(data, { binary: true });
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  close(): void {
    try {
      this.ws.terminate();
    } catch {
      /* already gone */
    }
  }

  async waitUntil(pred: () => boolean, ms: number, label: string): Promise<void> {
    const end = Date.now() + ms;
    for (;;) {
      if (pred()) return;
      const left = end - Date.now();
      if (left <= 0) throw new Error(`timeout waiting for ${label}; inbox=${JSON.stringify(this.inbox.map((m) => `${m.type}:${(m.payload as { code?: string }).code ?? ''}`))} closed=${JSON.stringify(this.closed)}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, Math.min(left, 100));
      });
    }
  }

  /** Waits for a message of `type` that arrives after index `from` (default: any). */
  async next(type: string, ms = 5000, from = 0): Promise<Msg> {
    let found: Msg | undefined;
    await this.waitUntil(() => {
      found = this.inbox.slice(from).find((m) => m.type === type);
      return found !== undefined;
    }, ms, `message ${type}`);
    return found as Msg;
  }

  async nextError(ms = 5000, from = 0): Promise<{ code: string; detail: string; msg: Msg }> {
    const m = await this.next('error', ms, from);
    return { code: String(m.payload['code']), detail: String(m.payload['detail']), msg: m };
  }

  async waitClosed(ms = 8000): Promise<{ code: number; reason: string }> {
    await this.waitUntil(() => this.closed !== null, ms, 'close');
    return this.closed as { code: number; reason: string };
  }

  /** True when nothing arrives for `ms` (used to prove silence). */
  async quiet(ms: number): Promise<boolean> {
    const before = this.inbox.length;
    await sleep(ms);
    return this.inbox.length === before;
  }
}

/* ------------------------------------------------------------------ catalogue-driven message builders */

export const mid = (): string => 'm_' + randomBytes(16).toString('base64url');
export const B64 = (n: number): string => randomBytes(n).toString('base64url');

export interface Ids {
  session_id?: string;
  window_id?: string;
  attempt_id?: string;
}
export const DEFAULT_IDS: Required<Ids> = { session_id: 's_secsession01', window_id: 'w_secwindow001', attempt_id: 'a_secattempt01' };

/** One schema-valid sample payload per message type (values are arbitrary but legal). */
export function samplePayload(type: MessageType, o: { roomId?: string } = {}): Record<string, unknown> {
  const roomId = o.roomId ?? 'r_' + B64(16);
  const now = Date.now();
  switch (type) {
    case 'room.create':
      return { client: { app_version: '0.1.0-sec', platform: 'test' } };
    case 'room.created':
      return { room_id: roomId, pairing_code: 'ACDEFH', code_expires_at: now + 600_000, tv_credential: B64(32), credential_expires_at: now + 7_200_000, generation: 1 };
    case 'pairing.code':
      return { pairing_code: 'ACDEFH', code_expires_at: now + 600_000 };
    case 'join.request':
      return { pairing_code: 'ACDEFH', device_label: 'Security test phone' };
    case 'join.pending':
      return { join_id: 'j_' + B64(16), confirm_digits: '42', expires_at: now + 60_000 };
    case 'join.requested':
      return { join_id: 'j_' + B64(16), device_label: 'Security test phone', confirm_digits: '42', expires_at: now + 60_000 };
    case 'join.confirm':
      return { join_id: 'j_' + B64(16), decision: 'accept' };
    case 'join.accepted':
      return { room_id: roomId, phone_credential: B64(32), credential_expires_at: now + 7_200_000, generation: 1 };
    case 'join.rejected':
      return { reason: 'rejected' };
    case 'join.expired':
      return { join_id: 'j_' + B64(16) };
    case 'auth.resume':
      return { room_id: roomId, role: 'tv', credential: B64(32) };
    case 'auth.ok':
      return { role: 'tv', generation: 1, peer_connected: false, phone_paired: false, next_credential: B64(32) };
    case 'peer.state':
      return { role: 'phone', connected: true, generation: 1 };
    case 'unpaired':
      return { reason: 'tv_unpaired' };
    case 'pong':
      return { server_time: now };
    case 'error':
      return { code: 'bad_schema', ref_message_id: null, detail: '' };
    case 'session.begin':
      return { family_mode: false, phrase_count: 3, cues_max: 3 };
    case 'session.state':
      return { stage: 'idle', phrase_position: 0, cues_used: 0, listener_open_attempt: null };
    case 'precheck.start':
      return { purpose: 'pre_window', duration_ms: 2000 };
    case 'window.start':
      return { kind: 'phrase', phrase_position: 1, max_duration_ms: 8000, vad_floor_dbfs: -60 };
    case 'window.stop':
      return { reason: 'complete' };
    case 'window.cancel':
      return { reason: 'user_cancel' };
    case 'listener.open':
      return { timeout_ms: 20_000 };
    case 'session.end':
      return { reason: 'completed' };
    case 'mic.state':
      return {
        state: 'open_idle',
        settings: { auto_gain_control: false, echo_cancellation: false, noise_suppression: false, sample_rate: 48000, channel_count: 1 },
        supported: { auto_gain_control: true, echo_cancellation: true, noise_suppression: true },
        wake_lock: 'held',
        visibility: 'visible',
        mode: 'fixture_replay',
      };
    case 'precheck.result':
      return {
        purpose: 'pre_window', valid: true, invalid_reason: null, floor_dbfs: -60, p20_dbfs: -61, p80_dbfs: -59, p95_dbfs: -57,
        frame_count: 40, expected_frames: 40, coverage: 1, clipped_frames: 0, nonfinite_frames: 0, duration_ms: 2000,
      };
    case 'level':
      return { frame_index: 0, t_audio_ms: 0, dbfs: -50, active: false, clipped: false };
    case 'window.result':
      return {
        kind: 'phrase', valid: true, invalid_reason: null, frame_count: 160, expected_frames: 160, coverage: 1, active_ms: 3000,
        longest_active_ms: 2000, segments: 2, onset_ms: 300, p50_active_dbfs: -30, p95_active_dbfs: -20, peak_dbfs: -15,
        clipped_frames: 0, nonfinite_frames: 0, duration_ms: 8000,
      };
    case 'listener.response':
      return { response: 'heard' };
    case 'cue':
      return { text: 'Volume' };
    case 'phrases.update':
      return { phrases: ['Hello there'] };
    case 'ack':
      return { acked_message_id: mid(), outcome: 'applied', detail: '' };
    default:
      return {}; // pairing.refresh, unpair, room.close, ping, attempt.reveal
  }
}

export interface EnvelopeOptions {
  role: 'tv' | 'phone' | 'relay';
  roomId?: string | null;
  generation?: number;
  sequence?: number;
  ids?: Ids;
  payload?: Record<string, unknown>;
  messageId?: string;
  timestamp?: number;
}

/**
 * A schema-valid envelope for `type`, shaped by the catalogue (which ids are required, whether a room is
 * required) and NOT by the sender's role, so a test can send a type from a role that must not send it.
 */
export function envelope(type: MessageType, o: EnvelopeOptions): Record<string, unknown> {
  const spec = specFor(type);
  const ids = { ...DEFAULT_IDS, ...(o.ids ?? {}) };
  const pick = (rule: 'required' | 'null' | 'optional', value: string): string | null => (rule === 'required' ? value : null);
  const room = spec.room === 'required' ? (o.roomId ?? 'r_' + B64(16)) : spec.room === 'optional' ? (o.roomId ?? null) : null;
  return {
    protocol_version: 1,
    type,
    message_id: o.messageId ?? mid(),
    room_id: room,
    session_id: pick(spec.identity.session, ids.session_id),
    window_id: pick(spec.identity.window, ids.window_id),
    attempt_id: pick(spec.identity.attempt, ids.attempt_id),
    sender_role: o.role,
    producer_generation: spec.generation === 'zero' || o.role === 'relay' ? 0 : (o.generation ?? 1),
    sequence: o.sequence ?? 0,
    event_timestamp: o.timestamp ?? Date.now(),
    payload: o.payload ?? samplePayload(type, room ? { roomId: room } : {}),
  };
}

/* ------------------------------------------------------------------ authenticated peers */

export class Peer {
  seq = 0;
  constructor(
    readonly client: RawClient,
    readonly role: 'tv' | 'phone',
    readonly roomId: string,
    public generation: number,
    public credential: string,
  ) {}

  /** Sends a catalogue-shaped message with the next sequence number. Returns the message_id. */
  send(type: MessageType, payload?: Record<string, unknown>, ids?: Ids): string {
    const id = mid();
    this.client.send(
      JSON.stringify(
        envelope(type, {
          role: this.role,
          roomId: this.roomId,
          generation: this.generation,
          sequence: this.seq++,
          messageId: id,
          ...(ids ? { ids } : {}),
          ...(payload ? { payload } : {}),
        }),
      ),
    );
    return id;
  }

  sendEnvelope(env: Record<string, unknown>): void {
    this.client.send(JSON.stringify(env));
  }
}

export interface Paired {
  tv: Peer;
  phone: Peer;
  roomId: string;
  code: string;
  tvCredential: string;
  phoneCredential: string;
}

/** TV side: room.create without an Origin header, as a native client sends it. */
export async function createRoom(relay: SecRelay): Promise<{ tv: Peer; code: string; created: Msg }> {
  const c = await RawClient.open(relay, null);
  c.send(JSON.stringify(envelope('room.create', { role: 'tv' })));
  const created = await c.next('room.created');
  const p = created.payload;
  const tv = new Peer(c, 'tv', String(p['room_id']), Number(p['generation']), String(p['tv_credential']));
  return { tv, code: String(p['pairing_code']), created };
}

/** Phone side: join.request with the phone origin. Returns the pending join as the phone sees it. */
export async function requestJoin(
  relay: SecRelay,
  code: string,
  label = 'Security test phone',
): Promise<{ client: RawClient; joinId: string; digits: string; pending: Msg }> {
  const c = await RawClient.open(relay, relay.phoneOrigin);
  c.send(JSON.stringify(envelope('join.request', { role: 'phone', payload: { pairing_code: code, device_label: label } })));
  const pending = await c.next('join.pending');
  return { client: c, joinId: String(pending.payload['join_id']), digits: String(pending.payload['confirm_digits']), pending };
}

/** Full raw pairing: TV room, phone join, TV accept (the TV session core would have the user pick the digits). */
export async function pairRaw(relay: SecRelay, label?: string): Promise<Paired> {
  const { tv, code } = await createRoom(relay);
  const j = await requestJoin(relay, code, label);
  const requested = await tv.client.next('join.requested');
  tv.send('join.confirm', { join_id: String(requested.payload['join_id']), decision: 'accept' });
  const accepted = await j.client.next('join.accepted');
  const phone = new Peer(j.client, 'phone', tv.roomId, Number(accepted.payload['generation']), String(accepted.payload['phone_credential']));
  // Let the pairing-time peer.state notices land on both sides so later assertions only see later traffic.
  await tv.client.next('peer.state');
  await j.client.next('peer.state');
  return { tv, phone, roomId: tv.roomId, code, tvCredential: tv.credential, phoneCredential: phone.credential };
}

/** auth.resume on a fresh connection. Returns the client and the first reply (auth.ok or error). */
export async function resume(
  relay: SecRelay,
  o: { roomId: string; role: 'tv' | 'phone'; credential: string; origin?: string | null },
): Promise<{ client: RawClient; reply: Msg | null; ok: boolean; peer: Peer | null; closed: boolean }> {
  const origin = o.origin === undefined ? (o.role === 'phone' ? relay.phoneOrigin : null) : o.origin;
  const c = await RawClient.open(relay, origin);
  c.send(
    JSON.stringify(
      envelope('auth.resume', {
        role: o.role,
        roomId: o.roomId,
        payload: { room_id: o.roomId, role: o.role, credential: o.credential },
      }),
    ),
  );
  await c.waitUntil(() => c.inbox.some((m) => m.type === 'auth.ok' || m.type === 'error') || c.closed !== null, 6000, 'resume reply');
  const reply = c.inbox.find((m) => m.type === 'auth.ok' || m.type === 'error') ?? null;
  if (reply && reply.type === 'auth.ok') {
    const peer = new Peer(c, o.role, o.roomId, Number(reply.payload['generation']), String(reply.payload['next_credential']));
    return { client: c, reply, ok: true, peer, closed: false };
  }
  return { client: c, reply, ok: false, peer: null, closed: c.closed !== null };
}

/** Every credential-like or code-like secret seen on a set of messages (for the log audit). */
export function collectSecrets(msgs: Msg[]): { credentials: string[]; codes: string[]; roomIds: string[] } {
  const credentials = new Set<string>();
  const codes = new Set<string>();
  const roomIds = new Set<string>();
  for (const m of msgs) {
    const p = m.payload;
    for (const k of ['tv_credential', 'phone_credential', 'credential', 'next_credential']) {
      if (typeof p[k] === 'string') credentials.add(p[k] as string);
    }
    if (typeof p['pairing_code'] === 'string') codes.add(p['pairing_code'] as string);
    if (typeof p['room_id'] === 'string') roomIds.add(p['room_id'] as string);
    if (typeof m.room_id === 'string') roomIds.add(m.room_id);
  }
  return { credentials: [...credentials], codes: [...codes], roomIds: [...roomIds] };
}
