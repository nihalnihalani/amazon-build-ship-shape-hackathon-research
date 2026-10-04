/**
 * docs/adr/AMENDMENTS-REV2.md ADR-0002 (A2-02, A2-03) and ADR-0005 (A5-01, A5-03, A5-04, A5-05).
 */

import { describe, expect, it } from 'vitest';
import { loadData } from '../src/index.js';
import { parseAttempt, parseCheckpoint, parseRecord, parseSettings } from '../src/storage.js';
import { CREDENTIAL, ROOM, T0, boot, createFlakyStorage } from './helpers.js';
import type { Harness } from './helpers.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const attempt = (o: Record<string, unknown> = {}) => ({
  attemptId: 'a_attempt0001',
  windowId: 'w_window00001',
  position: 1,
  attemptNumber: 1,
  hidden: false,
  state: 'revealed',
  started: true,
  verdict: 'reached',
  reason: null,
  borderline: false,
  activeMs: 2000,
  longestActiveMs: 2000,
  rating: null,
  listener: null,
  lateListener: null,
  ...o,
});

const record = (o: Record<string, unknown> = {}) => ({
  sessionId: 's_session0001',
  startedAt: T0 - 1000,
  endedAt: T0,
  localDate: '2026-10-05',
  complete: true,
  endReason: 'completed',
  resumed: false,
  familyMode: false,
  phraseCount: 10,
  calMarginDb: 20,
  cuesUsed: 0,
  attempts: [attempt()],
  vowels: [],
  skipped: [],
  ...o,
});

const checkpoint = (savedAt: number, o: Record<string, unknown> = {}) => ({
  version: 1,
  savedAt,
  stage: 'phrase_ready',
  phraseCount: 10,
  phraseIdx: 1,
  record: record({ complete: false, endReason: 'interrupted' }),
  ...o,
});

const META = JSON.stringify({ schema_version: 1, created_at: 1 });
const SETTINGS = JSON.stringify({ familyMode: false, cueWord: null, measurementMode: 'relative_band', onboarded: true });

describe('A2-02 / A2-03 About text', () => {
  it('states what the TV tells the relay and phone, the abuse counters, and what is stored and for how long', async () => {
    const h = await boot();
    h.ui('open_settings');
    h.ui('open_about');
    const text = h.view.body.join('\n');
    expect(h.view.body).toContain(
      "This TV tells the relay and your phone which practice step you are on and the room's background level. It does not send your results, ratings or history.",
    );
    expect(text).toContain('abuse-prevention counters');
    expect(text).toContain('counts only');
    expect(text).toContain('keyed hash');
    expect(text).toContain('at least daily');
    expect(text).toContain('within an hour');
    expect(text).toContain('unencrypted');
    expect(text).toContain('8 days');
    expect(text).toContain('phrase bank stays on this TV until you delete it');
    expect(text).toContain('never phrase text, cue words or phone names');
    expect(text).not.toContain('30 days');
  });
});

describe('A5-01 delete local data also cleans up the relay', () => {
  async function pairedAtHome(): Promise<Harness> {
    const h = await boot();
    h.pairOnly();
    expect(h.view.screen).toBe('home');
    return h;
  }

  it('sends unpair then room.close, reports confirmed once the relay closes the connection, and never persists a credential', async () => {
    const h = await pairedAtHome();
    h.ui('open_settings');
    h.ui('delete_local_data');
    expect(h.of('unpair')).toHaveLength(0); // nothing happens before the confirmation
    h.ui('confirm_destructive');
    const types = h.transport.sent.map((m) => m.type);
    const unpairAt = types.lastIndexOf('unpair');
    const closeAt = types.lastIndexOf('room.close');
    expect(unpairAt).toBeGreaterThan(-1);
    expect(closeAt).toBeGreaterThan(unpairAt);
    await h.flush();
    expect(h.view.banner?.text).toBe('All local practice data was deleted. Relay cleanup in progress.');
    h.transportState('reconnecting'); // the relay closed the room and our connection
    expect(h.view.banner?.text).toBe('All local practice data was deleted. Relay cleanup confirmed.');
    expect(Object.keys(h.storage.dump())).toEqual([]);
    expect(h.view.mic).toBe('not_paired');
    // a later reconnect creates no room and presents no credential
    const sent = h.transport.sent.length;
    h.transportState('connected');
    expect(h.transport.sent).toHaveLength(sent);
    expect(h.transport.closes).toContain('no_room_wanted');
    expect(JSON.stringify(h.views)).not.toContain(CREDENTIAL);
  });

  it('reports "not confirmed" if the relay does not close within 5 s, and closes the connection itself', async () => {
    const h = await pairedAtHome();
    h.ui('open_settings');
    h.ui('delete_local_data');
    h.ui('confirm_destructive');
    await h.flush();
    h.advance(4999);
    expect(h.view.banner?.text).toContain('in progress');
    h.advance(1);
    expect(h.view.banner?.text).toBe('All local practice data was deleted. Relay cleanup not confirmed.');
    expect(h.transport.closes).toContain('delete_cleanup_timeout');
  });

  it('with no live relay link it says not confirmed straight away and sends nothing', async () => {
    const h = await pairedAtHome();
    h.transportState('reconnecting');
    h.clearSent();
    h.ui('open_settings');
    h.ui('delete_local_data');
    h.ui('confirm_destructive');
    await h.flush();
    expect(h.transport.sent).toHaveLength(0);
    expect(h.view.banner?.text).toBe('All local practice data was deleted. Relay cleanup not confirmed.');
    expect(Object.keys(h.storage.dump())).toEqual([]);
  });

  it('never reports success when verification finds keys: error banner, data kept, retry works', async () => {
    const h = await pairedAtHome();
    h.ui('open_settings');
    h.storage.failMultiRemove = true;
    h.ui('delete_local_data');
    h.ui('confirm_destructive');
    await h.flush();
    expect(h.view.banner?.kind).toBe('error');
    expect(h.view.banner?.text).toContain('could not be removed');
    expect(h.view.banner?.text).not.toContain('was deleted');
    expect(Object.keys(h.storage.dump()).length).toBeGreaterThan(0);
    // the lying store: removal "succeeds" but nothing is removed
    h.storage.failMultiRemove = false;
    h.storage.ignoreMultiRemove = true;
    h.ui('delete_local_data');
    h.ui('confirm_destructive');
    await h.flush();
    expect(h.view.banner?.kind).toBe('error');
    expect(h.view.banner?.text).not.toContain('was deleted');
    expect(h.view.banner?.text).toContain('Relay cleanup');
    h.storage.ignoreMultiRemove = false;
    h.ui('delete_local_data');
    h.ui('confirm_destructive');
    await h.flush();
    expect(Object.keys(h.storage.dump())).toEqual([]);
    expect(h.view.banner?.text).toContain('All local practice data was deleted.');
  });

  it('resets memory on success: settings, phrase bank and history are back to defaults', async () => {
    const h = await boot({ settings: { familyMode: true } });
    h.phrases(['Custom phrase.']);
    h.pairOnly();
    h.setupPairedToPhrases();
    h.runPhrase({ listener: 'heard' });
    h.ui('finish_early');
    h.ui('done');
    await h.flush();
    h.ui('open_settings');
    h.ui('delete_local_data');
    h.ui('confirm_destructive');
    await h.flush();
    h.back();
    expect(h.view.body.join(' ')).toContain('No sessions saved');
    h.ui('open_settings');
    expect(h.view.body.join(' ')).toContain('Family mode: off');
    h.back();
    h.ui('open_history');
    expect(h.view.history?.every((d) => d.sessions === null)).toBe(true);
  });
});

describe('A5-03 checkpoint age', () => {
  const seed = (savedAt: number) => ({ 'atr:v1:meta': META, 'atr:v1:settings': SETTINGS, 'atr:v1:active': JSON.stringify(checkpoint(savedAt)) });

  it('discards a checkpoint older than 12 h on launch and removes it', async () => {
    const h = await boot({ seed: seed(T0 - 12 * HOUR - 1) });
    expect(h.view.stage).toBe('idle');
    expect(h.view.screen).toBe('home');
    await h.flush();
    expect(Object.keys(h.storage.dump())).not.toContain('atr:v1:active');
  });

  it('offers a checkpoint that is exactly 12 h old or younger', async () => {
    for (const age of [12 * HOUR, 11 * HOUR + 59 * 60_000, 1000]) {
      const h = await boot({ seed: seed(T0 - age) });
      expect(h.view.stage, `age ${age}`).toBe('resume_or_discard');
    }
  });
});

describe('A5-04 what is stored', () => {
  it('summaries, the index and the checkpoint hold no phrase text, cue text or device label', async () => {
    const markers = ['Zebra marker phrase one.', 'Zebra marker phrase two.', 'Zebra marker phrase three.', 'Zebra marker phrase four.'];
    const h = await boot({ settings: { familyMode: true } });
    h.phrases(markers);
    h.ui('pair_phone');
    h.transportState('connected');
    h.roomCreated();
    h.joinRequested('LabelMarkerPhone', '47');
    h.acceptJoin();
    h.peerState(true);
    h.setupPairedToPhrases();
    h.cue('CueMarker');
    h.runPhrase({ listener: 'heard' });
    await h.flush();
    const midSession = { ...h.storage.dump() };
    h.ui('next_phrase');
    h.finishAllPhrases();
    await h.flush();
    const dump = h.storage.dump();
    for (const snapshot of [midSession, dump]) {
      for (const [key, value] of Object.entries(snapshot)) {
        expect(value, key).not.toContain('LabelMarkerPhone');
        if (key === 'atr:v1:phrases') {
          expect(value).toContain('Zebra marker'); // the bank persists until deleted (stated in About)
          continue;
        }
        expect(value, key).not.toContain('Zebra');
        if (key === 'atr:v1:settings') continue; // the last cue word is a setting
        expect(value, key).not.toContain('CueMarker');
      }
    }
    expect(Object.keys(midSession)).toContain('atr:v1:active');
    expect(Object.keys(dump).filter((k) => k.startsWith('atr:v1:session:'))).toHaveLength(1);
    expect(JSON.stringify(dump)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(dump)).not.toContain(ROOM);
  });
});

describe('A5-05 corrupt values are absent, with a delete offer; stored values are validated like wire data', () => {
  it('malformed records, attempts, settings and checkpoints are rejected', () => {
    expect(parseRecord(record())).not.toBeNull();
    const bad: [string, unknown][] = [
      ['position 99', record({ attempts: [attempt({ position: 99 })] })],
      ['position 0', record({ attempts: [attempt({ position: 0 })] })],
      ['attemptNumber 0', record({ attempts: [attempt({ attemptNumber: 0 })] })],
      ['attemptNumber fractional', record({ attempts: [attempt({ attemptNumber: 1.5 })] })],
      ['unknown state', record({ attempts: [attempt({ state: 'weird' })] })],
      ['unknown verdict', record({ attempts: [attempt({ verdict: 'maybe' })] })],
      ['unknown listener', record({ attempts: [attempt({ listener: 'shrug' })] })],
      ['huge activeMs', record({ attempts: [attempt({ activeMs: 1e9 })] })],
      ['non-finite', record({ attempts: [attempt({ activeMs: Number.NaN })] })],
      ['long reason', record({ attempts: [attempt({ reason: 'x'.repeat(65) })] })],
      ['bad id', record({ attempts: [attempt({ attemptId: 'bad id with spaces' })] })],
      ['bad date', record({ localDate: '10/05/2026' })],
      ['bad date shape', record({ localDate: '2026-10-5' })],
      ['bad session id', record({ sessionId: '' })],
      ['too many attempts', record({ attempts: Array.from({ length: 201 }, () => attempt()) })],
      ['phraseCount 11', record({ phraseCount: 11 })],
      ['cuesUsed 4', record({ cuesUsed: 4 })],
      ['skipped 0', record({ skipped: [0] })],
      ['not an object', 'text'],
      ['array', []],
      ['attempts not a list', record({ attempts: 'x' })],
      ['endedAt string', record({ endedAt: 'soon' })],
      ['calMarginDb absurd', record({ calMarginDb: 1e6 })],
      ['unknown endReason', record({ endReason: 'who knows' })],
    ];
    for (const [name, value] of bad) expect(parseRecord(value), name).toBeNull();
    expect(parseAttempt(attempt({ rating: 'felt_loud', hidden: true }))).not.toBeNull();
    expect(parseAttempt(attempt({ rating: 'shouting' }))).toBeNull();
    expect(parseCheckpoint(checkpoint(T0))).not.toBeNull();
    expect(parseCheckpoint(checkpoint(T0, { phraseCount: 0 }))).toBeNull();
    expect(parseCheckpoint(checkpoint(T0, { phraseIdx: 11 }))).toBeNull();
    expect(parseCheckpoint(checkpoint(T0, { version: 2 }))).toBeNull();
    expect(parseCheckpoint(checkpoint(-5))).toBeNull();
    expect(parseCheckpoint(checkpoint(T0, { record: record({ attempts: [attempt({ position: 99 })] }) }))).toBeNull();
    expect(parseSettings({ qualification: 'bogus', quietLeadMs: 5, quietLeadScreenReaderMs: 99999 })).toMatchObject({
      qualification: 'not_run',
      quietLeadMs: null,
      quietLeadScreenReaderMs: null,
    });
    expect(parseSettings({ qualification: 'failed', quietLeadMs: 2000, quietLeadScreenReaderMs: 4000 })).toMatchObject({
      qualification: 'failed',
      quietLeadMs: 2000,
      quietLeadScreenReaderMs: 4000,
    });
  });

  it('on launch corrupt values are ignored, counted, offered for deletion, and never crash the app', async () => {
    const seed = {
      'atr:v1:meta': META,
      'atr:v1:settings': SETTINGS,
      'atr:v1:phrases': JSON.stringify({ phrases: ['x'.repeat(61)] }),
      'atr:v1:session:s_badposition': JSON.stringify(record({ sessionId: 's_badposition', attempts: [attempt({ position: 99 })] })),
      'atr:v1:session:s_baddate': JSON.stringify(record({ sessionId: 's_baddate', localDate: 'yesterday' })),
      'atr:v1:session:s_fine': JSON.stringify(record({ sessionId: 's_fine', endedAt: T0 - HOUR })),
      'atr:v1:active': JSON.stringify(checkpoint(T0 - HOUR, { record: record({ attempts: [attempt({ state: 'weird' })] }) })),
    };
    const h = await boot({ seed });
    expect(h.view.screen).toBe('home'); // the bad checkpoint is not offered for resume
    expect(h.view.body.join(' ')).toContain('could not be read and is being ignored');
    expect(h.view.body.join(' ')).toContain('Last session');
    h.ui('open_settings');
    expect(h.view.body.join(' ')).toContain('could not be read');
    h.ui('open_diagnostics');
    expect(h.view.diagnostics?.unreadable_stored_values).toBe('4');
    h.back();
    // starter bank is used, the fine record is kept
    h.back();
    h.ui('open_history');
    expect(h.view.history?.reduce((n, d) => n + (d.sessions ?? 0), 0)).toBe(1);
    // deleting removes the bad values and clears the offer
    h.ui('done');
    h.ui('open_settings');
    h.ui('delete_local_data');
    h.ui('confirm_destructive');
    await h.flush();
    h.back();
    expect(h.view.body.join(' ')).not.toContain('could not be read');
  });

  it('a failed removal of expired summaries is surfaced and keeps them', async () => {
    const storage = createFlakyStorage({
      'atr:v1:meta': META,
      'atr:v1:settings': SETTINGS,
      'atr:v1:session:s_old': JSON.stringify(record({ sessionId: 's_old', endedAt: T0 - 9 * DAY })),
    });
    storage.failMultiRemove = true;
    const data = await loadData(storage, T0);
    expect(data.pruneFailed).toBe(true);
    expect(data.prunedSessions).toBe(0);
    expect(data.records.map((r) => r.sessionId)).toEqual(['s_old']);
    const h = await boot({ storage, seed: {} });
    expect(h.view.banner?.text).toContain('Could not save');
    expect(h.view.body.join(' ')).toContain('Last session'); // the unremoved summary is still listed
  });

  it('no stored value is ever echoed into Diagnostics', async () => {
    const h = await boot({ seed: { 'atr:v1:meta': META, 'atr:v1:settings': SETTINGS, 'atr:v1:phrases': JSON.stringify({ phrases: ['Secret phrase text.'] }) } });
    h.ui('open_settings');
    h.ui('open_diagnostics');
    expect(JSON.stringify(h.view.diagnostics)).not.toContain('Secret');
  });
});
