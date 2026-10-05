/**
 * A small model of the relay's per-connection rate limiter (services/relay/src/core/relay-core.ts,
 * isRateLimited): every frame received on a connection is counted, rejected ones included, in a fixed
 * 1-second window (more than 60 is refused) and a fixed 10-second window (more than 400 is refused);
 * 120 refusals close the connection. A refused frame gets `error rate_limited` carrying its message_id.
 * Windows open at the first frame counted in them, which is the worst case for a client.
 */
import { relayMsg } from './fakes.js';

export interface ModelFrame {
  type: string;
  message_id: string;
  sequence: number;
  at: number;
  payload: Record<string, unknown>;
}

export class RelayModel {
  accepted: ModelFrame[] = [];
  rejected: ModelFrame[] = [];
  closed = false;
  private w1Start = Number.NEGATIVE_INFINITY;
  private n1 = 0;
  private w10Start = Number.NEGATIVE_INFINITY;
  private n10 = 0;

  constructor(
    private readonly burstPerSec = 60,
    private readonly sustainedPerSec = 40,
  ) {}

  /** Feeds one frame the phone sent; returns the error text the relay would send back, or null if accepted. */
  receive(text: string, at: number): string | null {
    const m = JSON.parse(text) as { type: string; message_id: string; sequence: number; payload: Record<string, unknown> };
    const frame: ModelFrame = { type: m.type, message_id: m.message_id, sequence: m.sequence, at, payload: m.payload };
    if (at - this.w1Start >= 1000) {
      this.w1Start = at;
      this.n1 = 0;
    }
    if (at - this.w10Start >= 10_000) {
      this.w10Start = at;
      this.n10 = 0;
    }
    this.n1 += 1;
    this.n10 += 1;
    if (this.n1 > this.burstPerSec || this.n10 > this.sustainedPerSec * 10) {
      this.rejected.push(frame);
      if (this.rejected.length >= 120) this.closed = true;
      return relayMsg('error', { code: 'rate_limited', ref_message_id: frame.message_id, detail: 'rate_limited' });
    }
    this.accepted.push(frame);
    return null;
  }
}

/** The most frames in any window of `windowMs` (sliding, so stricter than the relay's fixed windows). */
export function maxInAnyWindow(times: number[], windowMs = 1000): number {
  let best = 0;
  let j = 0;
  for (let i = 0; i < times.length; i++) {
    while ((times[i] as number) - (times[j] as number) >= windowMs) j += 1;
    best = Math.max(best, i - j + 1);
  }
  return best;
}
