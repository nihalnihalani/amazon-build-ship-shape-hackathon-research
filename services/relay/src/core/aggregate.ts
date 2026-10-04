/**
 * Per-minute aggregation of ordinary traffic (A2-04).
 *
 * The relay does not write a log line per message: that would record when each measurement window starts and ends
 * (a behavioural trace). Adapters feed the core's aggregated metric actions into this class and write one
 * `minute_aggregate` line per message type and minute instead. Counts only; no identifiers.
 */
import type { AggregateKind, LogEvent } from './logger.js';
import type { MessageType } from './protocol-port.js';
import { AGGREGATED_METRICS, type Action, type MetricName } from './types.js';

const MINUTE_MS = 60_000;
const KIND_OF: Partial<Record<MetricName, AggregateKind>> = {
  messages_forwarded: 'forwarded',
  duplicate_dropped: 'duplicate_dropped',
  peer_offline: 'peer_offline',
};

export function isAggregatedMetric(name: MetricName): boolean {
  return (AGGREGATED_METRICS as readonly string[]).includes(name);
}

export class MinuteAggregator {
  private minute = -1;
  private counts = new Map<string, { kind: AggregateKind; type?: MessageType; count: number }>();

  /** Records one metric action. Returns false when the action is not an aggregated metric. */
  record(action: Action, nowMs: number): LogEvent[] {
    if (action.kind !== 'metric' || !isAggregatedMetric(action.name)) return [];
    const out = this.flush(nowMs);
    const kind = KIND_OF[action.name];
    if (!kind) return out;
    const key = `${kind}|${action.type ?? ''}`;
    const cur = this.counts.get(key);
    if (cur) cur.count += action.value;
    else this.counts.set(key, { kind, ...(action.type ? { type: action.type } : {}), count: action.value });
    return out;
  }

  /**
   * Lines for every minute that has completed before `nowMs` (all of them with `force`). Call regularly; an
   * adapter that is idle flushes on its next call, so the last minute of traffic can appear late or, if the
   * process is recycled first, not at all.
   */
  flush(nowMs: number, force = false): LogEvent[] {
    const current = Math.floor(nowMs / MINUTE_MS);
    if (this.minute === -1) this.minute = current;
    if (!force && current <= this.minute) return [];
    const lines: LogEvent[] = [...this.counts.values()]
      .sort((a, b) => (a.kind + (a.type ?? '')).localeCompare(b.kind + (b.type ?? '')))
      .map((e) => ({ event: 'minute_aggregate' as const, code: e.kind, ...(e.type ? { type: e.type } : {}), count: e.count }));
    this.counts = new Map();
    this.minute = current;
    return lines;
  }
}
