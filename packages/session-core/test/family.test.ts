import { describe, expect, it } from 'vitest';
import { boot } from './helpers.js';

const FAMILY = { familyMode: true, onboarded: true };

async function familySession() {
  const h = await boot({ settings: FAMILY });
  h.setupToPhrases();
  return h;
}

describe('family mode: listener response phase before reveal', () => {
  it('opens the listener when capture closes and holds the result until the listener answers', async () => {
    const h = await familySession();
    expect(h.last('session.begin').payload.family_mode).toBe(true);
    h.runPhrase({ rel: 25 });
    expect(h.view.stage).toBe('response_pending');
    expect(h.view.result).toBeNull();
    expect(h.view.meter).toBeNull();
    expect(h.view.title).toBe('Waiting for the listener');
    const open = h.last('listener.open');
    expect(open.payload).toEqual({ timeout_ms: 60000 });
    expect(open.attempt_id).toBe(h.last('window.start').attempt_id);
    expect(h.last('session.state').payload).toMatchObject({ stage: 'response_pending', listener_open_attempt: open.attempt_id });
    expect(h.of('attempt.reveal')).toHaveLength(0);

    h.listener('heard');
    expect(h.view.stage).toBe('reveal');
    expect(h.view.result?.label).toBe("Reached today's relative level band");
    expect(h.view.result?.listener).toBe('Listener: heard');
    expect(h.last('attempt.reveal').attempt_id).toBe(open.attempt_id);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'applied' });
    expect(h.last('session.state').payload).toMatchObject({ stage: 'reveal', listener_open_attempt: null });
  });

  it('a hidden attempt needs both the speaker rating and the listener, in either order', async () => {
    for (const listenerFirst of [true, false]) {
      const h = await familySession();
      for (let p = 1; p < 3; p += 1) {
        h.runPhrase({ listener: 'heard' });
        h.ui('next_phrase');
      }
      h.runPhrase({});
      expect(h.view.phrase?.position).toBe(3);
      expect(h.view.stage).toBe('response_pending');
      if (listenerFirst) {
        h.listener('not_heard');
        expect(h.view.stage).toBe('response_pending');
        expect(h.view.result).toBeNull();
        h.ui('rate_felt_normal');
      } else {
        h.ui('rate_felt_loud');
        expect(h.view.stage).toBe('response_pending');
        expect(h.view.result).toBeNull();
        expect(h.view.title).toBe('Waiting for the listener');
        h.listener('not_heard');
      }
      expect(h.view.stage).toBe('reveal');
      expect(h.view.result?.listener).toBe('Listener: not heard');
    }
  });

  it('after 20 s offers Keep waiting (preferred) and Continue without listener response', async () => {
    const h = await familySession();
    h.runPhrase({});
    h.advance(19_999);
    expect(h.actionIds()).toEqual([]);
    h.advance(1);
    expect(h.actionIds()).toEqual(['keep_waiting', 'continue_without_listener']);
    expect(h.view.preferredAction).toBe('keep_waiting');
    expect(h.view.title).toBe('No listener response yet');

    h.ui('keep_waiting');
    expect(h.actionIds()).toEqual([]);
    h.advance(19_999);
    expect(h.actionIds()).toEqual([]);
    h.advance(1);
    expect(h.actionIds()).toContain('continue_without_listener');

    h.ui('continue_without_listener');
    expect(h.view.stage).toBe('reveal');
    expect(h.view.result?.listener).toBe('Listener: no response');
    h.ui('finish_early');
    expect(h.view.summary?.agreementVisible).toEqual({ agree: 0, eligible: 0 });
    expect(h.view.summary?.lines.join(' ')).toContain('No eligible listener responses');
  });

  it('a late response is stored as late, excluded from agreement, and counted separately', async () => {
    const h = await familySession();
    h.runPhrase({ rel: 25 });
    const open = h.last('listener.open');
    h.advance(20_000);
    h.ui('continue_without_listener');
    expect(h.view.stage).toBe('reveal');
    h.listener('heard', open);
    expect(h.last('ack').payload).toEqual({ acked_message_id: expect.any(String), outcome: 'applied', detail: 'late' });
    expect(h.view.result?.listener).toBe('Listener (late, not counted): heard');
    // the locked on-time record is unchanged and a second late tap is not accepted
    h.listener('not_heard', open);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    h.ui('finish_early');
    expect(h.view.summary).toMatchObject({
      lateListenerResponses: 1,
      agreementVisible: { agree: 0, eligible: 0 },
      agreementHidden: { agree: 0, eligible: 0 },
    });
  });

  it('an on-time response is locked at reveal: a later different answer is stale', async () => {
    const h = await familySession();
    h.runPhrase({ listener: 'heard' });
    const open = h.last('listener.open');
    h.listener('not_heard', open);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.view.result?.listener).toBe('Listener: heard');
  });

  it('computes agreement separately for hidden first attempts and visible attempts with denominators', async () => {
    const h = await familySession();
    h.runPhrase({ rel: 25, listener: 'heard' }); // visible agree
    h.ui('next_phrase');
    h.runPhrase({ rel: 25, listener: 'not_heard' }); // visible disagree
    h.ui('next_phrase');
    h.runPhrase({ rel: 5, rating: 'felt_normal', listener: 'not_heard' }); // hidden agree (below + not heard)
    h.ui('next_phrase');
    h.runPhrase({ rel: 25 }); // visible, missing
    h.advance(20_000);
    h.ui('continue_without_listener');
    h.ui('try_again'); // visible retry at position 4
    h.runPhrase({ rel: 25, listener: 'heard' }); // visible agree (retry counts as visible)
    h.ui('finish_early');
    const s = h.view.summary;
    expect(s?.agreementHidden).toEqual({ agree: 1, eligible: 1 });
    expect(s?.agreementVisible).toEqual({ agree: 2, eligible: 3 });
    expect(s?.lines.join('\n')).not.toContain('No eligible'); // both groups have eligible attempts
  });

  it('ignores listener responses for the wrong session, window or attempt, and for unopened attempts', async () => {
    const h = await familySession();
    h.runPhrase({});
    const open = h.last('listener.open');
    const before = h.of('ack').length;
    // wrong attempt id
    h.listener('heard', { ...open, attempt_id: 'a_wrongattempt00001' });
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    // wrong window id
    h.listener('heard', { ...open, window_id: 'w_wrongwindow000001' });
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    // wrong session id
    h.listener('heard', { ...open, session_id: 's_wrongsession0001' });
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.of('ack').length).toBe(before + 3);
    expect(h.view.stage).toBe('response_pending');
  });

  it('never opens the listener for invalid or cancelled windows', async () => {
    const h = await familySession();
    h.runPhrase({ valid: false, reason: 'low_coverage' });
    expect(h.view.stage).toBe('reveal');
    expect(h.of('listener.open')).toHaveLength(0);
    expect(h.view.result?.label).toBe('Not scored');
    h.ui('try_again');
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.back();
    expect(h.of('listener.open')).toHaveLength(0);
    expect(h.view.stage).toBe('reveal');
  });

  it('listener responses are ignored when family mode is off', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.runPhrase({});
    expect(h.view.stage).toBe('reveal');
    expect(h.of('listener.open')).toHaveLength(0);
    const open = { ...h.last('window.start') };
    h.listener('heard', open);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    expect(h.view.result?.listener).toBeNull();
  });
});

describe('cue word', () => {
  it('shows a neutral chip for 3 s, announces it, and accepts at most three per session', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.cue('Volume');
    expect(h.view.cue).toEqual({ text: 'Volume', expiresAt: h.clock.now() + 3000 });
    expect(h.view.announcement).toBe('Cue: Volume');
    expect(h.last('ack').payload).toMatchObject({ outcome: 'applied' });
    expect(h.last('session.state').payload).toMatchObject({ cues_used: 1 });
    h.advance(2999);
    expect(h.view.cue).not.toBeNull();
    h.advance(1);
    expect(h.view.cue).toBeNull();
    expect(h.view.announcement).not.toBe('Cue: Volume');

    h.cue('Volume');
    h.cue('Volume');
    expect(h.last('session.state').payload).toMatchObject({ cues_used: 3 });
    h.advance(5000);
    expect(h.view.cue).toBeNull();
    const acksBefore = h.of('ack').length;
    h.cue('Volume'); // fourth
    expect(h.view.cue).toBeNull();
    expect(h.of('ack').length).toBe(acksBefore + 1);
    expect(h.last('ack').payload).toMatchObject({ outcome: 'rejected', detail: 'cue_limit' });
    expect(h.last('session.state').payload).toMatchObject({ cues_used: 3 });
  });

  it('never changes a verdict', async () => {
    const run = async (cues: number) => {
      const h = await boot({ settings: FAMILY });
      h.setupToPhrases();
      for (let i = 0; i < cues; i += 1) h.cue('Volume');
      h.runPhrase({ rel: 5, listener: 'not_heard' });
      return h.view.result;
    };
    expect(await run(3)).toEqual(await run(0));
  });

  it('is rejected during a window, for the wrong session, and when not 1-12 clean code points', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.ui('begin_phrase');
    h.cue('Volume');
    expect(h.last('ack').payload).toMatchObject({ outcome: 'rejected', detail: 'window_open' });
    expect(h.view.cue).toBeNull();
    h.back(); // cancels the quiet lead and returns to the ready screen
    expect(h.view.stage).toBe('phrase_ready');
    // text the shared validators reject never reaches the session: dropped at the wire boundary, not counted
    const acks = h.of('ack').length;
    for (const bad of ['', '   ', 'x'.repeat(13), 'bad\u0007cue', ' padded ', 42, null]) h.cue(bad);
    expect(h.of('ack')).toHaveLength(acks);
    expect(h.last('session.state').payload).toMatchObject({ cues_used: 0 });
    h.cue('Volume', 's_notmysession123');
    expect(h.last('ack').payload).toMatchObject({ outcome: 'ignored_stale' });
    h.cue('x'.repeat(12));
    expect(h.last('ack').payload).toMatchObject({ outcome: 'applied' });
  });

  it('the cue chip never carries markup semantics: text is literal', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.cue('<b>Up</b>');
    expect(h.view.cue?.text).toBe('<b>Up</b>');
  });
});
