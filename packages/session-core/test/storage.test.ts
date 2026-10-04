import { describe, expect, it } from 'vitest';
import {
  STORAGE_KEYS,
  deleteAllLocalData,
  loadData,
  migrateSnapshot,
  migrateV0ToV1,
  summarizeRecord,
} from '../src/index.js';
import type { V0Snapshot } from '../src/index.js';
import { CREDENTIAL, PAIRING_CODE, ROOM, T0, boot, createFlakyStorage } from './helpers.js';

const DAY = 86_400_000;

const V0: V0Snapshot = {
  schema_version: 0,
  settings: { family: true, cue: 'Volume' },
  phrases: ['Dinner is ready.', 'Please pass the salt.'],
  sessions: [
    {
      id: 's_legacy0001',
      date: '2026-09-30',
      complete: true,
      started_at: T0 - 3 * DAY,
      ended_at: T0 - 3 * DAY + 2_000,
      attempts: [
        { pos: 1, verdict: 'reached' },
        { pos: 2, verdict: 'below' },
        { pos: 3, verdict: 'reached', hidden: true },
        { pos: 3, verdict: 'none' },
      ],
      vowel_ms: 11_500,
    },
    { id: 's_legacy0002', date: '2026-10-01', complete: false, ended_at: T0 - 2 * DAY, attempts: [] },
  ],
};

function sessionRecordJson(id: string, endedAt: number, localDate: string): string {
  return JSON.stringify({
    sessionId: id,
    startedAt: endedAt - 1000,
    endedAt,
    localDate,
    complete: true,
    endReason: 'completed',
    resumed: false,
    familyMode: false,
    phraseCount: 10,
    calMarginDb: 20,
    cuesUsed: 0,
    attempts: [],
    vowels: [],
    skipped: [],
  });
}

describe('schema migration (pure functions)', () => {
  it('migrates a v0 fixture to v1 without inventing anything', () => {
    const v1 = migrateV0ToV1(V0);
    expect(v1.schemaVersion).toBe(1);
    expect(v1.settings).toEqual({
      familyMode: true,
      cueWord: 'Volume',
      measurementMode: 'relative_band',
      onboarded: true,
      qualification: 'not_run',
      quietLeadMs: null,
      quietLeadScreenReaderMs: null,
    });
    expect(v1.phrases).toEqual(['Dinner is ready.', 'Please pass the salt.']);
    expect(v1.sessions).toHaveLength(2);
    const first = v1.sessions[0];
    expect(first).toMatchObject({
      sessionId: 's_legacy0001',
      localDate: '2026-09-30',
      complete: true,
      endReason: 'completed',
      familyMode: true,
      phraseCount: 3,
      calMarginDb: null,
      startedAt: T0 - 3 * DAY,
      endedAt: T0 - 3 * DAY + 2_000,
    });
    expect(first?.attempts.map((a) => [a.position, a.attemptNumber, a.verdict, a.hidden, a.state])).toEqual([
      [1, 1, 'reached', false, 'revealed'],
      [2, 1, 'not_reached', false, 'revealed'],
      [3, 1, 'reached', true, 'revealed'],
      [3, 2, 'unscored', false, 'invalid'],
    ]);
    expect(first?.attempts[3]?.reason).toBe('legacy_unscored');
    expect(first?.vowels).toEqual([
      { windowId: 'w_legacys_legacy0001_vowel', valid: true, reason: null, longestActiveMs: 11_500, verdict: null, borderline: false },
    ]);
    const second = v1.sessions[1];
    expect(second).toMatchObject({ complete: false, endReason: 'user_exit', startedAt: T0 - 2 * DAY, vowels: [], attempts: [] });
    expect(summarizeRecord(first as NonNullable<typeof first>)).toMatchObject({ reachedHidden: 1, scoredHidden: 1, reachedVisible: 1, scoredVisible: 2 });
  });

  it('drops an invalid legacy phrase bank and cue rather than guessing', () => {
    const v1 = migrateV0ToV1({ ...V0, phrases: [], settings: { family: false, cue: 'x'.repeat(40) } });
    expect(v1.phrases).toBeNull();
    expect(v1.settings.cueWord).toBeNull();
  });

  it('dispatches by schema_version and refuses unknown futures', () => {
    expect(migrateSnapshot(V0)).toMatchObject({ ok: true, from: 0 });
    expect(migrateSnapshot({ schema_version: 1, settings: {}, phrases: null, sessions: [] })).toMatchObject({ ok: true, from: 1 });
    expect(migrateSnapshot({ schema_version: 2 })).toEqual({ ok: false, reason: 'future_version', version: 2 });
    expect(migrateSnapshot({ schema_version: 99 })).toEqual({ ok: false, reason: 'future_version', version: 99 });
    expect(migrateSnapshot({ schema_version: -1 })).toEqual({ ok: false, reason: 'unrecognized' });
    expect(migrateSnapshot({})).toEqual({ ok: false, reason: 'unrecognized' });
    expect(migrateSnapshot(null)).toEqual({ ok: false, reason: 'unrecognized' });
    expect(migrateSnapshot('x')).toEqual({ ok: false, reason: 'unrecognized' });
  });
});

describe('loadData', () => {
  it('migrates a physical v0 snapshot into v1 keys and removes the v0 key', async () => {
    const storage = createFlakyStorage({ 'atr:v0:snapshot': JSON.stringify(V0) });
    const data = await loadData(storage, T0);
    expect(data.migratedFrom).toBe(0);
    expect(data.records).toHaveLength(2);
    const dump = storage.dump();
    expect(Object.keys(dump).sort()).toEqual(
      [
        'atr:v1:index',
        'atr:v1:meta',
        'atr:v1:phrases',
        'atr:v1:session:s_legacy0001',
        'atr:v1:session:s_legacy0002',
        'atr:v1:settings',
      ].sort(),
    );
    expect(JSON.parse(dump['atr:v1:meta'] as string).schema_version).toBe(1);
    const again = await loadData(storage, T0);
    expect(again.migratedFrom).toBeNull();
    expect(again.records.map((r) => r.sessionId)).toEqual(['s_legacy0001', 's_legacy0002']);
  });

  it('never overwrites data from an unknown future version', async () => {
    const seed = {
      'atr:v1:meta': JSON.stringify({ schema_version: 2, created_at: 1 }),
      'atr:v1:settings': JSON.stringify({ shape: 'from the future' }),
      'atr:v1:session:s_future': 'opaque future payload',
    };
    const storage = createFlakyStorage({ ...seed });
    const data = await loadData(storage, T0);
    expect(data).toMatchObject({ status: 'future_version', futureVersion: 2, records: [], active: null });
    expect(storage.dump()).toEqual(seed);
    expect(storage.setCalls).toEqual([]);

    const newerKeys = createFlakyStorage({ 'atr:v3:thing': 'x' });
    expect(await loadData(newerKeys, T0)).toMatchObject({ status: 'future_version', futureVersion: 3 });
    expect(newerKeys.dump()).toEqual({ 'atr:v3:thing': 'x' });
  });

  it('the store runs without persisting while future data exists, tells the user, and writes again only after delete', async () => {
    const seed = {
      'atr:v1:meta': JSON.stringify({ schema_version: 2, created_at: 1 }),
      'atr:v1:settings': 'future',
    };
    const h = await boot({ seed });
    expect(h.view.body.join(' ')).toContain('newer version');
    h.setupToPhrases();
    h.runPhrase({});
    h.ui('finish_early');
    await h.flush();
    expect(h.storage.dump()).toEqual(seed);
    expect(h.storage.setCalls).toEqual([]);
    h.ui('done');
    h.ui('open_settings');
    h.ui('delete_local_data');
    h.ui('confirm_destructive');
    await h.flush();
    expect(Object.keys(h.storage.dump())).toEqual([]);
    h.ui('toggle_family_mode');
    await h.flush();
    expect(JSON.parse(h.storage.dump()['atr:v1:settings'] as string).familyMode).toBe(true);
    expect(h.view.body.join(' ')).not.toContain('newer version');
  });

  it('prunes session summaries older than 8 days on launch and keeps the rest (A5-04)', async () => {
    const seed: Record<string, string> = {
      'atr:v1:meta': JSON.stringify({ schema_version: 1, created_at: 1 }),
      'atr:v1:session:s_old': sessionRecordJson('s_old', T0 - 8 * DAY - 1, '2026-09-27'),
      'atr:v1:session:s_edge': sessionRecordJson('s_edge', T0 - 8 * DAY, '2026-09-27'),
      'atr:v1:session:s_thirty': sessionRecordJson('s_thirty', T0 - 29 * DAY, '2026-09-06'),
      'atr:v1:session:s_new': sessionRecordJson('s_new', T0 - DAY, '2026-10-04'),
    };
    const storage = createFlakyStorage(seed);
    const data = await loadData(storage, T0);
    expect(data.prunedSessions).toBe(2);
    expect(data.records.map((r) => r.sessionId)).toEqual(['s_edge', 's_new']);
    const keys = Object.keys(storage.dump());
    expect(keys).not.toContain('atr:v1:session:s_old');
    expect(keys).not.toContain('atr:v1:session:s_thirty');
    expect(JSON.parse(storage.dump()['atr:v1:index'] as string).entries.map((e: { sessionId: string }) => e.sessionId)).toEqual([
      's_edge',
      's_new',
    ]);
  });

  it('survives corrupt keys, ignores them, and still loads the rest', async () => {
    const storage = createFlakyStorage({
      'atr:v1:meta': JSON.stringify({ schema_version: 1, created_at: 1 }),
      'atr:v1:settings': '{not json',
      'atr:v1:phrases': JSON.stringify({ phrases: ['', 'x'] }),
      'atr:v1:session:s_bad': '{"sessionId": 5}',
      'atr:v1:session:s_ok': sessionRecordJson('s_ok', T0 - 1000, '2026-10-05'),
      'atr:v1:active': '[]',
      'unrelated': 'keep',
    });
    const data = await loadData(storage, T0);
    expect(data.records.map((r) => r.sessionId)).toEqual(['s_ok']);
    expect(data.phrases).toBeNull();
    expect(data.active).toBeNull();
    expect(data.corruptKeys).toBeGreaterThanOrEqual(3);
    expect(data.settings.familyMode).toBe(false);
  });

  it('writes the meta record on a first launch', async () => {
    const storage = createFlakyStorage();
    await loadData(storage, T0);
    expect(JSON.parse(storage.dump()['atr:v1:meta'] as string)).toEqual({ schema_version: 1, created_at: T0 });
  });
});

describe('delete local data', () => {
  it('removes only atr: keys and verifies none remain', async () => {
    const storage = createFlakyStorage({ 'atr:v1:meta': '{}', 'atr:v1:x': '1', 'atr:v0:y': '2', other: 'keep', 'atrium:z': 'keep' });
    expect(await deleteAllLocalData(storage)).toEqual({ ok: true });
    expect(Object.keys(storage.dump()).sort()).toEqual(['atrium:z', 'other']);
  });

  it('reports failure when keys remain (removal error or a store that ignores removal)', async () => {
    const failing = createFlakyStorage({ 'atr:v1:meta': '{}', 'atr:v1:x': '1' });
    failing.failMultiRemove = true;
    expect(await deleteAllLocalData(failing)).toEqual({ ok: false, remaining: ['atr:v1:meta', 'atr:v1:x'] });
    const lying = createFlakyStorage({ 'atr:v1:meta': '{}' });
    lying.ignoreMultiRemove = true;
    expect(await deleteAllLocalData(lying)).toEqual({ ok: false, remaining: ['atr:v1:meta'] });
  });

  it('shows the failure to the user, keeps the data, and a retry can succeed', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.runPhrase({});
    h.ui('finish_early');
    h.ui('done');
    await h.flush();
    h.storage.failMultiRemove = true;
    h.ui('open_settings');
    h.ui('delete_local_data');
    h.ui('confirm_destructive');
    await h.flush();
    expect(h.view.banner?.kind).toBe('error');
    expect(h.view.banner?.text).toContain('could not be removed');
    expect(Object.keys(h.storage.dump()).length).toBeGreaterThan(0);
    h.ui('open_diagnostics');
    expect(Number(h.view.diagnostics?.delete_remaining_keys)).toBeGreaterThan(0);
    h.back();
    h.storage.failMultiRemove = false;
    h.ui('delete_local_data');
    h.ui('confirm_destructive');
    await h.flush();
    expect(Object.keys(h.storage.dump())).toEqual([]);
    expect(h.view.banner?.text).toContain('All local practice data was deleted.');
  });

  it('cancel leaves the data untouched and delete is unavailable during a session', async () => {
    const h = await boot();
    h.ui('open_settings');
    h.ui('delete_local_data');
    h.ui('cancel_destructive');
    await h.flush();
    expect(Object.keys(h.storage.dump()).length).toBeGreaterThan(0);
    expect(h.view.screen).toBe('settings');
    h.back();
    h.setupToPhrases();
    h.ui('open_settings');
    expect(h.view.actions.find((a) => a.id === 'delete_local_data')?.disabled).toBe(true);
    h.ui('delete_local_data');
    expect(h.view.screen).toBe('settings');
  });
});

describe('crash checkpoint, resume and discard', () => {
  async function crashedMidSession(): Promise<Record<string, string>> {
    const first = await boot();
    first.setupToPhrases();
    first.runPhrase({ rel: 25 });
    first.ui('next_phrase');
    first.runPhrase({ rel: 5 });
    first.ui('next_phrase'); // now at position 3 (blind)
    first.beginAndLead('begin_phrase');
    first.answerPrecheck();
    first.level(0, -40); // capturing the blind attempt when the app "crashes"
    await first.flush();
    return first.storage.dump();
  }

  it('writes a checkpoint after each reveal and at capture start, without credentials or a held verdict', async () => {
    const dump = await crashedMidSession();
    expect(Object.keys(dump)).toContain('atr:v1:active');
    const raw = dump['atr:v1:active'] as string;
    for (const secret of [CREDENTIAL, ROOM, PAIRING_CODE]) expect(raw).not.toContain(secret);
    const cp = JSON.parse(raw);
    expect(cp.phraseIdx).toBe(2);
    expect(cp.record.attempts).toHaveLength(3);
    expect(cp.record.attempts[2]).toMatchObject({ position: 3, hidden: true, state: 'capturing', verdict: null });
  });

  it('on launch offers Resume (preferred) and Discard second; resume never invents completion', async () => {
    const dump = await crashedMidSession();
    const h = await boot({ seed: dump });
    expect(h.view.stage).toBe('resume_or_discard');
    expect(h.view.screen).toBe('resume_or_discard');
    expect(h.view.actions.map((a) => a.id)).toEqual(['resume_session', 'discard_session']);
    expect(h.view.preferredAction).toBe('resume_session');
    expect(h.view.body.join(' ')).toContain('interrupted');
    expect(h.view.body.join(' ')).toContain('2 phrases were attempted'.replace('2', '3'));
    h.back(); // Back cannot dismiss the choice
    expect(h.view.stage).toBe('resume_or_discard');

    h.ui('resume_session');
    // a fresh pairing and microphone start are required: nothing is carried over from the dead process
    expect(h.view.stage).toBe('pairing');
    expect(h.transport.connects).toHaveLength(1);
    h.transportState('connected');
    h.roomCreated();
    h.joinRequested();
    h.acceptJoin();
    h.peerState(true);
    expect(h.view.stage).toBe('permission_pending');
    h.micState('open_idle');
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.ui('skip_vowel');
    // resumes at position 3; the attempt that was capturing is interrupted, so this is attempt 2 and visible
    expect(h.view.phrase).toMatchObject({ position: 3, attemptNumber: 2 });
    expect(h.last('session.begin').session_id).toBe(JSON.parse(dump['atr:v1:active'] as string).record.sessionId);
    h.beginAndLead('begin_phrase');
    h.answerPrecheck();
    h.level(0, -40);
    expect(h.view.meter).not.toBeNull(); // the retry is visible
    h.answerWindow({ rel: 25 });
    expect(h.view.stage).toBe('reveal');
    h.ui('finish_early');
    const s = h.view.summary;
    expect(s?.complete).toBe(false);
    expect(s?.invalidReasons).toEqual({ interrupted: 1 });
    expect(s).toMatchObject({ phrasesCompleted: 3, scoredHidden: 0 });
    await h.flush();
    const keys = Object.keys(h.storage.dump());
    expect(keys).not.toContain('atr:v1:active');
    const sessionKeys = keys.filter((k) => k.startsWith('atr:v1:session:'));
    expect(sessionKeys).toHaveLength(1);
    const rec = JSON.parse(h.storage.dump()[sessionKeys[0] as string] as string);
    expect(rec).toMatchObject({ complete: false, resumed: true });
  });

  it('a resumed session that reaches the last phrase is still labelled incomplete', async () => {
    const dump = await crashedMidSession();
    const h = await boot({ seed: dump });
    h.ui('resume_session');
    h.transportState('connected');
    h.roomCreated();
    h.joinRequested();
    h.acceptJoin();
    h.peerState(true);
    h.micState('open_idle');
    h.runQuiet();
    h.runCalibration(20);
    h.ui('continue');
    h.ui('skip_vowel');
    h.finishAllPhrases();
    expect(h.view.stage).toBe('summary');
    expect(h.view.summary?.complete).toBe(false);
    expect(h.last('session.end').payload).toEqual({ reason: 'completed' });
  });

  it('Discard saves what exists as an incomplete, discarded session and clears the checkpoint', async () => {
    const dump = await crashedMidSession();
    const h = await boot({ seed: dump });
    h.ui('discard_session');
    expect(h.view.screen).toBe('home');
    await h.flush();
    const keys = Object.keys(h.storage.dump());
    expect(keys).not.toContain('atr:v1:active');
    const sessionKey = keys.find((k) => k.startsWith('atr:v1:session:')) as string;
    const rec = JSON.parse(h.storage.dump()[sessionKey] as string);
    expect(rec).toMatchObject({ complete: false, endReason: 'discarded' });
    expect(rec.attempts[2]).toMatchObject({ state: 'invalid', verdict: 'unscored', reason: 'interrupted' });
    expect(h.view.body.join(' ')).toContain('(incomplete)');
    h.ui('open_history');
    expect(h.view.history?.[6]).toMatchObject({ sessions: 1, incomplete: true });
  });

  it('Discard of a checkpoint with no results records nothing', async () => {
    const first = await boot();
    first.setupToPhrases();
    first.ui('begin_phrase'); // lead only: nothing captured, but checkpoint requested? none yet
    await first.flush();
    const checkpoint = JSON.stringify({
      version: 1,
      savedAt: T0,
      stage: 'phrase_ready',
      phraseCount: 2,
      phraseIdx: 0,
      record: JSON.parse(sessionRecordJson('s_empty', T0, '2026-10-05')),
    });
    const h = await boot({ seed: { 'atr:v1:meta': JSON.stringify({ schema_version: 1, created_at: 1 }), 'atr:v1:active': checkpoint } });
    expect(h.view.stage).toBe('resume_or_discard');
    h.ui('discard_session');
    await h.flush();
    expect(Object.keys(h.storage.dump()).filter((k) => k.startsWith('atr:v1:session:'))).toEqual([]);
    expect(Object.keys(h.storage.dump())).not.toContain('atr:v1:active');
  });

  it('completing a session removes the checkpoint', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.runPhrase({});
    await h.flush();
    expect(Object.keys(h.storage.dump())).toContain('atr:v1:active');
    h.ui('finish_early');
    await h.flush();
    expect(Object.keys(h.storage.dump())).not.toContain('atr:v1:active');
    expect(STORAGE_KEYS.active).toBe('atr:v1:active');
  });
});

describe('settings, onboarding and fixture mode', () => {
  it('shows onboarding on a first launch and remembers it', async () => {
    const storage = createFlakyStorage();
    const h = await boot({ storage, seed: {} });
    expect(h.view.screen).toBe('onboarding');
    expect(h.view.body.join(' ')).toContain('2.5 to 3 metres');
    expect(h.view.preferredAction).toBe('continue');
    h.ok();
    expect(h.view.screen).toBe('home');
    await h.flush();
    expect(JSON.parse(storage.dump()['atr:v1:settings'] as string).onboarded).toBe(true);
    const again = await boot({ seed: storage.dump() });
    expect(again.view.screen).toBe('home');
  });

  it('persists the family mode toggle and the cue word, and shows them in Settings', async () => {
    const h = await boot();
    h.ui('open_settings');
    expect(h.view.body.join(' ')).toContain('Family mode: off');
    expect(h.view.body.join(' ')).toContain('Cue word: not set');
    h.ui('toggle_family_mode');
    expect(h.view.body.join(' ')).toContain('Family mode: on');
    h.back();
    h.setupToPhrases();
    expect(h.last('session.begin').payload.family_mode).toBe(true);
    h.cue('Volume');
    await h.flush();
    const saved = JSON.parse(h.storage.dump()['atr:v1:settings'] as string);
    expect(saved).toMatchObject({ familyMode: true, cueWord: 'Volume', onboarded: true });
    const again = await boot({ seed: h.storage.dump() });
    again.ui('open_settings');
    expect(again.view.body.join(' ')).toContain('Cue word: Volume');
    expect(again.view.body.join(' ')).toContain('Family mode: on');
  });

  it('fixture replay mode labels every screen and never touches real storage', async () => {
    const real = createFlakyStorage({
      'atr:v1:meta': JSON.stringify({ schema_version: 1, created_at: 1 }),
      'atr:v1:settings': JSON.stringify({ familyMode: false, cueWord: null, measurementMode: 'relative_band', onboarded: true }),
    });
    const before = JSON.stringify(real.dump());
    const h = await boot({ storage: real, fixtureMode: true, seed: {} });
    expect(h.view.screen).toBe('onboarding'); // fixture mode starts with its own empty in-memory settings
    expect(h.view.labels).toContain('Fixture replay');
    h.ok();
    h.setupToPhrases();
    h.runPhrase({});
    h.ui('finish_early');
    h.ui('open_history');
    expect(h.view.history?.[6]).toMatchObject({ sessions: 1 }); // in-memory history works in the fixture run
    await h.flush();
    expect(JSON.stringify(real.dump())).toBe(before);
    expect(real.setCalls).toEqual([]);
    expect(h.views.length).toBeGreaterThan(20);
    for (const v of h.views) expect(v.labels).toContain('Fixture replay');
    expect(h.view.labels).toContain('Fixture replay');
  });

  it('a phone that reports fixture replay or same-device mode is labelled on the TV', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.micState('open_idle', 'same_host');
    expect(h.view.labels).toContain('Same-device microphone mode');
    h.micState('open_idle', 'fixture_replay');
    expect(h.view.labels).toContain('Fixture replay');
  });

  it('settings are reachable from home and the ready stages, reset calibration clears only the band', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.runPhrase({ rel: 25 });
    h.ui('next_phrase');
    h.ui('open_settings');
    expect(h.view.screen).toBe('settings');
    expect(h.view.stage).toBe('phrase_ready');
    expect(h.view.preferredAction).toBeNull();
    expect(h.view.actions.find((a) => a.id === 'reset_calibration')?.disabled).toBe(false);
    expect(h.view.actions.find((a) => a.id === 'toggle_family_mode')?.disabled).toBe(true);
    expect(h.view.actions.find((a) => a.id === 'unpair_phone')?.disabled).toBe(true);
    h.ui('reset_calibration');
    expect(h.view.screen).toBe('confirm_dialog');
    expect(h.view.dialog?.preferred).toBe('cancel');
    h.ui('cancel_destructive');
    expect(h.view.screen).toBe('settings');
    h.ui('reset_calibration');
    h.ui('confirm_destructive');
    // band cleared, floor kept: only the calibration window is needed again; attempts are untouched
    expect(h.view.stage).toBe('calibration');
    expect(h.view.banner?.text).toContain('cleared');
    expect(h.actionIds()).toEqual(['begin_calibration', 'cancel']);
    h.runCalibration(18);
    h.ui('continue');
    expect(h.view.stage).toBe('phrase_ready');
    expect(h.view.phrase?.position).toBe(2);
    h.runPhrase({ rel: 25 });
    expect(h.view.result?.label).toBe("Reached today's relative level band (unqualified phone)");
    h.ui('finish_early');
    expect(h.view.summary?.phrasesCompleted).toBe(2);
    expect(h.view.summary?.calibrationMarginDb).toBe(18);
  });

  it('unpair asks for confirmation (Cancel preferred) and sends unpair to the relay', async () => {
    const h = await boot();
    h.ui('pair_phone');
    h.transportState('connected');
    h.roomCreated();
    h.joinRequested();
    h.acceptJoin();
    h.peerState(true);
    h.ui('open_settings');
    expect(h.view.actions.find((a) => a.id === 'unpair_phone')?.disabled).toBe(false);
    h.ui('unpair_phone');
    expect(h.view.dialog).toMatchObject({ preferred: 'cancel' });
    expect(h.of('unpair')).toHaveLength(0);
    h.ui('confirm_destructive');
    expect(h.of('unpair')).toHaveLength(1);
    expect(h.view.mic).toBe('not_paired');
    expect(h.view.actions.find((a) => a.id === 'unpair_phone')?.disabled).toBe(true);
  });

  it('about shows the version and the storage disclosure; diagnostics show counters and no credentials', async () => {
    const h = await boot();
    h.ui('open_settings');
    h.ui('open_about');
    expect(h.view.screen).toBe('about');
    expect(h.view.body.join(' ')).toContain('Version 0.1.0-test');
    expect(h.view.body.join(' ')).toContain('unencrypted');
    expect(h.view.body.join(' ')).toContain('Not yet qualified on this phone');
    h.back();
    expect(h.view.screen).toBe('settings');
    h.ui('open_diagnostics');
    expect(h.view.screen).toBe('diagnostics');
    expect(h.view.diagnostics?.link).toBe('offline');
    expect(h.view.diagnostics?.platform).toBe('test');
    h.back();
    h.back();
    expect(h.view.screen).toBe('home');
  });

  it('storage load failure still opens the app with a warning', async () => {
    const storage = createFlakyStorage();
    storage.getAllKeys = () => Promise.reject(new Error('no storage'));
    const h = await boot({ storage });
    expect(h.view.screen).toBe('onboarding');
    expect(h.view.banner?.text).toContain('Could not save');
  });
});
