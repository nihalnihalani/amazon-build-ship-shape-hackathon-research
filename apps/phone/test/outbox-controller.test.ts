/**
 * QA-E2E-01 at the controller level: the phone against a model of the relay's rate limiter.
 * The model counts every received frame in fixed windows exactly as services/relay does, so a
 * pass here means the relay would have accepted what the phone sent (or that the phone recovered
 * from what it refused).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTEMPT,
  attemptReveal,
  flush,
  lastMessageId,
  listenerOpen,
  relayMsg,
  sessionBegin,
  sessionState,
  validWindow,
  windowStart,
  windowStop,
  windowCancel,
  type FakeSocket,
} from './helpers/fakes.js';
import { advanceLive, type Harness, pairedHarness, resumeSocket } from './helpers/harness.js';
import { maxInAnyWindow, RelayModel } from './helpers/relay-model.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function ready(): Promise<Harness> {
  const h = await pairedHarness();
  h.sockets.current.receive(sessionBegin());
  h.audio.makeOpen();
  await flush();
  return h;
}

/** The network between the phone's socket and the relay model. `held` is a stall that does not drop the connection. */
class Link {
  held = false;
  private sock: FakeSocket;
  private cursor = 0;
  constructor(
    private readonly h: Harness,
    readonly model: RelayModel = new RelayModel(),
  ) {
    this.sock = h.sockets.current;
  }
  /** Delivers what the phone has sent since the last call and returns the relay's replies to the phone. */
  pump(): void {
    while (!this.held && this.cursor < this.sock.sent.length) {
      const text = this.sock.sent[this.cursor++] as string;
      const error = this.model.receive(text, Date.now());
      if (error !== null) this.sock.receive(error);
      else if ((JSON.parse(text) as { type: string }).type === 'ping') this.sock.receive(relayMsg('pong', { server_time: 1 }));
    }
  }
  release(): void {
    this.held = false;
    this.pump();
  }
  /** Advances fake time in small steps, delivering frames as they appear. */
  run(ms: number, step = 10): void {
    for (let t = 0; t < ms; t += step) {
      vi.advanceTimersByTime(step);
      this.pump();
    }
  }
}

const commandAck = (h: Harness, text: string) => {
  const id = lastMessageId(text);
  return h.sockets.current.messages('ack').find((m) => m.payload['acked_message_id'] === id);
};
/** Sequence numbers of the current producer generation, in wire order (they restart at 0 with each generation). */
const sequences = (h: Harness): number[] => {
  const all = h.sockets.current.messages();
  const generation = all.at(-1)?.producer_generation;
  return all.filter((m) => m.producer_generation === generation).map((m) => m.sequence);
};
const lastAcceptedMicState = (model: RelayModel): unknown => model.accepted.filter((f) => f.type === 'mic.state').at(-1)?.payload['state'];

describe('QA-E2E-01: a stall that releases its backlog in one burst', () => {
  it('the relay refuses part of the burst, yet the TV ends up with the phone\'s real state and exactly one window.result', async () => {
    const h = await ready();
    const link = new Link(h);
    h.sockets.current.receive(windowStart('phrase'));
    link.pump();
    h.audio.frame(0);
    link.pump();
    expect(lastAcceptedMicState(link.model)).toBe('measuring');

    link.held = true; // the network stalls; the socket stays open
    for (let i = 1; i <= 80; i++) {
      h.audio.frame(i);
      vi.advanceTimersByTime(50);
    }
    h.audio.finishWindow(validWindow('phrase', 4000)); // the window ends while the stall is on
    await flush();
    vi.advanceTimersByTime(100);
    expect(link.model.accepted.length + link.model.rejected.length).toBeGreaterThan(0);
    const before = { accepted: link.model.accepted.length, rejected: link.model.rejected.length };

    link.release(); // everything handed to the network arrives at once
    // The precondition of the bug: that burst really is over the relay's limit.
    expect(link.model.rejected.length).toBeGreaterThan(before.rejected);
    expect(link.model.closed).toBe(false);

    link.run(5000);
    expect(lastAcceptedMicState(link.model), 'TV mic state must converge to the phone').toBe('open_idle');
    expect(link.model.accepted.filter((f) => f.type === 'window.result')).toHaveLength(1);

    // And it settles: nothing more is refused afterwards, and the link stays healthy.
    const refused = link.model.rejected.length;
    link.run(30_000, 50);
    expect(link.model.rejected.length).toBe(refused);
    expect(link.model.closed).toBe(false);

    // Every frame the phone sent, resends included, is a fresh message: strictly increasing sequences, unique ids.
    const seqs = sequences(h);
    expect(seqs.every((s, i) => i === 0 || s > (seqs[i - 1] as number))).toBe(true);
    const ids = h.sockets.current.messages().map((m) => m.message_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a window that is still measuring when the burst lands is reported as measuring (the latest state, not a stale one)', async () => {
    const h = await ready();
    const link = new Link(h);
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    link.pump();
    link.held = true;
    for (let i = 1; i <= 70; i++) {
      h.audio.frame(i);
      vi.advanceTimersByTime(50);
    }
    link.release();
    link.run(5000);
    expect(link.model.rejected.length).toBeGreaterThan(0);
    expect(lastAcceptedMicState(link.model)).toBe('measuring');
  });
});

describe('Outgoing pacing', () => {
  it('a flood of TV commands: every ack goes out, in order, and the relay refuses none', async () => {
    const h = await ready();
    const link = new Link(h);
    const commands = Array.from({ length: 100 }, () => sessionState('calibration'));
    for (const text of commands) h.sockets.current.receive(text);
    link.pump();
    link.run(6000);
    const acked = link.model.accepted.filter((f) => f.type === 'ack').map((f) => f.payload['acked_message_id']);
    const tail = acked.slice(-100);
    expect(tail).toEqual(commands.map(lastMessageId));
    expect(link.model.rejected).toHaveLength(0);
    const times = link.model.accepted.map((f) => f.at);
    expect(maxInAnyWindow(times, 1000)).toBeLessThan(60);
    const seqs = sequences(h);
    expect(seqs.every((s, i) => i === 0 || s > (seqs[i - 1] as number))).toBe(true);
  });

  it('a burst of level frames cannot crowd out an ack, a result or a mic.state', async () => {
    const h = await ready();
    const link = new Link(h);
    h.sockets.current.receive(windowStart('phrase'));
    for (let i = 0; i < 100; i++) h.audio.frame(i); // 100 frames at the same instant (a catch-up after a busy main thread)
    const stop = windowStop();
    h.sockets.current.receive(stop);
    await flush();
    link.pump(); // no time has passed: all of this is decided by the bucket alone
    const levels = h.sockets.current.messages('level');
    expect(levels.length).toBeGreaterThan(5);
    expect(levels.length).toBeLessThanOrEqual(17);
    expect(commandAck(h, stop)?.payload).toMatchObject({ outcome: 'applied' });
    expect(h.sockets.current.messages('window.result')).toHaveLength(1);
    expect(lastAcceptedMicState(link.model)).toBe('open_idle');
    expect(link.model.rejected).toHaveLength(0);
  });

  it('a stalled socket (bufferedAmount) holds back levels for good and releases acks in order once it drains', async () => {
    const h = await ready();
    const link = new Link(h);
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    link.pump();
    const sock = h.sockets.current;
    const levelsBefore = sock.messages('level').length;
    sock.bufferedAmount = 200_000;
    for (let i = 1; i <= 60; i++) {
      h.audio.frame(i);
      vi.advanceTimersByTime(50);
    }
    const commands = [sessionState('calibration'), sessionState('calibration'), sessionState('calibration')];
    const sentWhileStalled = sock.sent.length;
    for (const c of commands) sock.receive(c);
    expect(sock.sent).toHaveLength(sentWhileStalled); // nothing leaves a stalled socket
    expect(sock.messages('level')).toHaveLength(levelsBefore); // and no level for those 3 s was kept for later
    sock.bufferedAmount = 0;
    link.run(300);
    expect(sock.messages('level')).toHaveLength(levelsBefore);
    const acks = sock.messages('ack').slice(-3).map((m) => m.payload['acked_message_id']);
    expect(acks).toEqual(commands.map(lastMessageId));
    expect(link.model.rejected).toHaveLength(0);
  });

  it('levels for a window that has closed are never sent, even if the link was stalled when it closed', async () => {
    const h = await ready();
    const link = new Link(h);
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    link.pump();
    const sock = h.sockets.current;
    sock.bufferedAmount = 200_000;
    for (let i = 1; i <= 30; i++) {
      h.audio.frame(i);
      vi.advanceTimersByTime(50);
    }
    sock.receive(windowCancel());
    await flush();
    const levelsAtClose = sock.messages('level').length;
    sock.bufferedAmount = 0;
    link.run(5000);
    expect(sock.messages('level')).toHaveLength(levelsAtClose);
  });
});

describe('mic.state is coalesced and re-sent after rate_limited', () => {
  it('while backing off, several state changes become one mic.state: the latest', async () => {
    const h = await ready();
    const link = new Link(h);
    link.pump();
    const sock = h.sockets.current;
    sock.receive(relayMsg('error', { code: 'rate_limited', detail: 'rate_limited', ref_message_id: null }));
    const micBefore = sock.messages('mic.state').length;
    h.audio.setState('measuring');
    h.audio.setState('open_idle');
    h.audio.setState('measuring');
    h.audio.setState('open_idle');
    h.audio.setState('measuring');
    expect(sock.messages('mic.state')).toHaveLength(micBefore); // paused: nothing goes out yet
    link.run(2500);
    const after = sock.messages('mic.state').slice(micBefore);
    expect(after).toHaveLength(1);
    expect(after[0]?.payload['state']).toBe('measuring');
  });

  it('rate_limited with nothing wrong in particular re-sends the current mic.state once the pause is over', async () => {
    const h = await ready();
    const link = new Link(h);
    link.pump();
    const sock = h.sockets.current;
    const before = sock.messages('mic.state').length;
    sock.receive(relayMsg('error', { code: 'rate_limited', detail: 'rate_limited', ref_message_id: null }));
    vi.advanceTimersByTime(900);
    expect(sock.messages('mic.state')).toHaveLength(before);
    link.run(500);
    expect(sock.messages('mic.state')).toHaveLength(before + 1);
    expect(sock.last('mic.state').payload['state']).toBe('open_idle');
  });

  it('is not shown to the person as a failure of theirs: no generic "relay refused a message" notice', async () => {
    const h = await ready();
    h.sockets.current.receive(relayMsg('error', { code: 'rate_limited', detail: 'rate_limited', ref_message_id: null }));
    expect(h.controller.getState().notice ?? '').not.toMatch(/relay refused/i);
  });

  it('a flurry of rate_limited errors (one per refused frame) is one backoff and does not multiply re-sends', async () => {
    const h = await ready();
    const link = new Link(h);
    link.pump();
    const sock = h.sockets.current;
    const before = sock.messages('mic.state').length;
    for (let i = 0; i < 50; i++) sock.receive(relayMsg('error', { code: 'rate_limited', detail: 'rate_limited', ref_message_id: null }));
    link.run(3000);
    expect(sock.messages('mic.state')).toHaveLength(before + 1);
  });
});

describe('a refused ack or result is said again, once', () => {
  async function withResult() {
    const h = await ready();
    const link = new Link(h);
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    const stop = windowStop();
    h.sockets.current.receive(stop);
    await flush();
    link.pump();
    return { h, link, stop };
  }

  it('window.result refused: re-sent as a fresh message with the same content, and only once', async () => {
    const { h, link } = await withResult();
    const sock = h.sockets.current;
    const first = sock.last('window.result');
    sock.receive(relayMsg('error', { code: 'rate_limited', detail: 'rate_limited', ref_message_id: first.message_id }));
    link.run(2000);
    const results = sock.messages('window.result');
    expect(results).toHaveLength(2);
    const second = results[1]!;
    expect(second.message_id).not.toBe(first.message_id);
    expect(second.sequence).toBeGreaterThan(first.sequence);
    expect(second.payload).toEqual(first.payload);
    expect([second.session_id, second.window_id, second.attempt_id]).toEqual([first.session_id, first.window_id, first.attempt_id]);

    sock.receive(relayMsg('error', { code: 'rate_limited', detail: 'rate_limited', ref_message_id: second.message_id }));
    link.run(10_000);
    expect(sock.messages('window.result')).toHaveLength(2); // no loop
  });

  it('an ack refused: re-sent as a fresh ack for the same command, and only once', async () => {
    const h = await ready();
    const link = new Link(h);
    const command = sessionState('calibration');
    h.sockets.current.receive(command);
    link.pump();
    const sock = h.sockets.current;
    const first = commandAck(h, command)!;
    sock.receive(relayMsg('error', { code: 'rate_limited', detail: 'rate_limited', ref_message_id: first.message_id }));
    link.run(2000);
    const acks = sock.messages('ack').filter((m) => m.payload['acked_message_id'] === lastMessageId(command));
    expect(acks).toHaveLength(2);
    expect(acks[1]!.message_id).not.toBe(first.message_id);
    expect(acks[1]!.payload).toEqual(first.payload);
    sock.receive(relayMsg('error', { code: 'rate_limited', detail: 'rate_limited', ref_message_id: acks[1]!.message_id }));
    link.run(10_000);
    expect(sock.messages('ack').filter((m) => m.payload['acked_message_id'] === lastMessageId(command))).toHaveLength(2);
  });
});

describe('a refused user action can be tried again', () => {
  async function listening() {
    const h = await ready();
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    h.audio.finishWindow(validWindow());
    await flush();
    h.sockets.current.receive(listenerOpen());
    return h;
  }
  const limited = (id: string) => relayMsg('error', { code: 'rate_limited', detail: 'rate_limited', ref_message_id: id });

  it('cue: the count goes back, the person is told the connection was busy, and Cue works again', async () => {
    const h = await listening();
    h.controller.sendCue();
    expect(h.controller.getState().cue.used).toBe(1);
    h.sockets.current.receive(limited(h.sockets.current.last('cue').message_id));
    const s = h.controller.getState();
    expect(s.cue.used).toBe(0);
    expect(s.canCue).toBe(true);
    expect(s.cue.feedback).toMatch(/connection was busy/i);
    expect(s.notice ?? '').not.toMatch(/relay refused/i);
    vi.advanceTimersByTime(3000);
    h.controller.sendCue();
    expect(h.sockets.current.messages('cue')).toHaveLength(2);
  });

  it('listener.response: the controls are enabled again with an honest message', async () => {
    const h = await listening();
    h.controller.answer('heard');
    expect(h.controller.getState().canAnswer).toBe(false);
    h.sockets.current.receive(limited(h.sockets.current.last('listener.response').message_id));
    const s = h.controller.getState();
    expect(s.canAnswer).toBe(true);
    expect(s.listener.feedback).toMatch(/connection was busy/i);
  });

  it('phrases.update: shown as not sent (not "saved"), and Save works again', async () => {
    const h = await ready();
    const out = h.controller.savePhrases(['one two', 'three four']);
    expect(out.sent).toBe(true);
    expect(h.controller.getState().phrases.status).toBe('sending');
    h.sockets.current.receive(limited(h.sockets.current.last('phrases.update').message_id));
    expect(h.controller.getState().phrases.status).toBe('not_sent');
    vi.advanceTimersByTime(3000);
    expect(h.controller.savePhrases(['one two', 'three four']).sent).toBe(true);
    expect(h.sockets.current.messages('phrases.update')).toHaveLength(2);
  });

  it('reveal still locks the controls when it arrives while an answer is waiting its turn', async () => {
    const h = await listening();
    h.sockets.current.bufferedAmount = 200_000;
    h.controller.answer('heard');
    h.sockets.current.receive(attemptReveal());
    expect(h.controller.getState()).toMatchObject({ canAnswer: false, canCue: false });
    void ATTEMPT;
  });
});

describe('results waiting for a stalled or lost link', () => {
  it('a window.result queued behind a stalled socket survives the connection dropping and goes out after reconnecting', async () => {
    const h = await ready();
    const link = new Link(h);
    h.sockets.current.receive(windowStart('phrase'));
    h.audio.frame(0);
    link.pump();
    const first = h.sockets.current;
    first.bufferedAmount = 200_000;
    h.audio.finishWindow(validWindow('phrase', 3000));
    await flush();
    expect(first.messages('window.result')).toHaveLength(0); // waiting in the outbox
    first.drop();
    vi.advanceTimersByTime(600);
    first.bufferedAmount = 0;
    resumeSocket(h);
    await flush();
    vi.advanceTimersByTime(200);
    const second = h.sockets.current;
    expect(second).not.toBe(first);
    expect(second.messages('window.result')).toHaveLength(1);
    expect(second.messages('window.result')[0]?.payload).toMatchObject({ kind: 'phrase', valid: true });
    advanceLive(h, 3000, () => relayMsg('pong', { server_time: 1 }));
  });

  it('a new connection starts with a full bucket and no memory of the old connection\'s backoff', async () => {
    const h = await ready();
    const first = h.sockets.current;
    first.receive(relayMsg('error', { code: 'rate_limited', detail: 'rate_limited', ref_message_id: null }));
    first.drop();
    vi.advanceTimersByTime(600);
    resumeSocket(h);
    await flush();
    const second = h.sockets.current;
    const before = second.sent.length;
    const command = sessionState('calibration');
    second.receive(command);
    expect(second.sent.length).toBeGreaterThan(before); // acked at once: not paused
    expect(second.messages('ack').some((m) => m.payload['acked_message_id'] === lastMessageId(command))).toBe(true);
  });
});
