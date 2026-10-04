/**
 * Parses docs/PROTOCOL.md and checks that packages/protocol agrees with it:
 * message-type set, direction and auth columns, S/W/A identity columns, error
 * codes, TvStage names and the limits that appear in the document.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CATALOGUE,
  CREDENTIAL_TTL_MS,
  CUES_PER_SESSION_MAX,
  CUE_LENGTH_MAX,
  DEVICE_LABEL_LENGTH_MAX,
  ERROR_CODES,
  MAX_MESSAGE_BYTES,
  MESSAGE_TYPES,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PHRASE_LENGTH_MAX,
  PRECHECK_INVALID_REASONS,
  PRE_WINDOW_INVALID_REASONS,
  VAD_FLOOR_DBFS_MAX,
  VAD_FLOOR_DBFS_MIN,
  FRAME_MS,
  TV_STAGES,
  TRANSPORT_STATES,
  specFor,
  validateMessageObject,
} from '../src/index.js';
import type { Direction, MessageType } from '../src/index.js';
import { NOW as base_now, VALID_FIXTURES } from './fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const docPath = resolve(here, '../../../docs/PROTOCOL.md');
const doc = readFileSync(docPath, 'utf8');

interface DocRow {
  type: string;
  dir: string;
  auth: string;
  swa: string;
}

/** Split a markdown table row on unescaped pipes. */
function cells(line: string): string[] {
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((c) => c.trim());
}

function sectionBetween(startHeading: string, endHeading: string): string {
  const start = doc.indexOf(startHeading);
  const end = doc.indexOf(endHeading, start + startHeading.length);
  if (start < 0 || end < 0) throw new Error(`cannot find ${startHeading} or ${endHeading} in PROTOCOL.md`);
  return doc.slice(start, end);
}

function messageRows(): DocRow[] {
  const section = sectionBetween('## 3. Message catalogue', '### 3.4 Error codes');
  const rows: DocRow[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const c = cells(line);
    const m = /^`([a-z.]+)`$/.exec(c[0] ?? '');
    if (!m) continue;
    rows.push({ type: m[1] as string, dir: c[1] ?? '', auth: c[2] ?? '', swa: c[3] ?? '' });
  }
  return rows;
}

const ARROWS: Record<string, Direction[]> = {
  'T→R': ['T->R'],
  'P→R': ['P->R'],
  'T→P': ['T->P'],
  'P→T': ['P->T'],
  'R→T': ['R->T'],
  'R→P': ['R->P'],
  'any→R': ['T->R', 'P->R'],
  'R→*': ['R->T', 'R->P'],
};

function parseDirections(cell: string): Direction[] {
  const out: Direction[] = [];
  for (const part of cell.split(',').map((p) => p.trim())) {
    const arrows = ARROWS[part];
    if (!arrows) throw new Error(`unknown direction notation in PROTOCOL.md: ${part}`);
    for (const a of arrows) if (!out.includes(a)) out.push(a);
  }
  return out;
}

const AUTH_MAP: Record<string, string> = { pre: 'pre', auth: 'auth', 'pre/auth': 'pre_or_auth', '—': 'relay_origin' };

/** Document S/W/A cell to three characters R (required), - (null), O (optional). */
function parseSwa(cell: string): string {
  if (/as acked/i.test(cell)) return 'OOO';
  const tokens = cell.replace(/\(.*\)/, '').trim().split(/\s+/);
  if (tokens.length !== 3) throw new Error(`cannot parse S W A cell: ${cell}`);
  const letters: string[] = tokens.map((t) => (t === '✓' ? 'R' : t === '–' ? '-' : '?'));
  if (letters.includes('?')) throw new Error(`cannot parse S W A cell: ${cell}`);
  if (/S optional/i.test(cell)) letters[0] = 'O';
  return letters.join('');
}

const letter = (r: string): string => (r === 'required' ? 'R' : r === 'null' ? '-' : 'O');

describe('docs/PROTOCOL.md section 3 versus catalogue.ts', () => {
  const rows = messageRows();

  it('parsed the document tables', () => {
    expect(rows.length).toBe(37);
  });

  it('lists exactly the message types in MESSAGE_TYPES, in the same order', () => {
    expect(rows.map((r) => r.type)).toEqual([...MESSAGE_TYPES]);
    expect(new Set(rows.map((r) => r.type))).toEqual(new Set<string>(CATALOGUE.map((s) => s.type)));
  });

  for (const row of messageRows()) {
    it(`${row.type}: direction, auth and S/W/A columns match`, () => {
      const spec = specFor(row.type as MessageType);
      const directions = parseDirections(row.dir);
      expect([...spec.directions].sort()).toEqual([...directions].sort());
      const authKey = AUTH_MAP[row.auth];
      expect(authKey, `auth cell "${row.auth}"`).toBeDefined();
      expect(spec.auth).toBe(authKey);
      const swa = parseSwa(row.swa);
      expect(`${letter(spec.identity.session)}${letter(spec.identity.window)}${letter(spec.identity.attempt)}`).toBe(swa);
    });
  }

  it('derived senders and forwarding agree with the direction column', () => {
    for (const row of rows) {
      const spec = specFor(row.type as MessageType);
      const dirs = parseDirections(row.dir);
      const senders = new Set(dirs.map((d) => ({ T: 'tv', P: 'phone', R: 'relay' })[d.charAt(0) as 'T' | 'P' | 'R']));
      expect(new Set(spec.senders)).toEqual(senders);
      const toPhone = dirs.includes('T->P');
      const toTv = dirs.includes('P->T');
      expect(spec.forwardTo).toBe(toPhone && toTv ? 'peer' : toPhone ? 'phone' : toTv ? 'tv' : null);
    }
  });
});

describe('docs/PROTOCOL.md MicStatePayload block (revision 3)', () => {
  const block = sectionBetween('#### MicStatePayload', '#### PrecheckResultPayload');
  const supportedLine = block.split('\n').find((l) => l.trim().startsWith('supported:'));

  it('declares supported.* as boolean | null', () => {
    expect(supportedLine).toBeDefined();
    const fields = [...(supportedLine as string).matchAll(/([a-z_]+): ([a-z |]+?)(?:,|\s*\})/g)].map((m) => [m[1], (m[2] as string).trim()]);
    expect(fields).toEqual([
      ['auto_gain_control', 'boolean | null'],
      ['echo_cancellation', 'boolean | null'],
      ['noise_suppression', 'boolean | null'],
    ]);
  });

  it('the validator accepts null and rejects non-booleans for exactly the documented fields', () => {
    const names = [...(supportedLine as string).matchAll(/([a-z_]+): boolean \| null/g)].map((m) => m[1] as string);
    expect(names.length).toBe(3);
    for (const name of names) {
      const base = JSON.parse(JSON.stringify(VALID_FIXTURES.find((f) => f.name === 'mic.state no session')?.message)) as {
        payload: { supported: Record<string, unknown> };
      };
      for (const ok of [null, true, false]) {
        base.payload.supported[name] = ok;
        expect(validateMessageObject(base, { now: base_now }).ok, `${name}=${String(ok)}`).toBe(true);
      }
      for (const bad of ['true', 'null', 0, 1, {}, []]) {
        base.payload.supported[name] = bad;
        expect(validateMessageObject(base, { now: base_now }).ok, `${name}=${JSON.stringify(bad)}`).toBe(false);
      }
    }
  });

  it('the revision 3 line is recorded in section 8 and the status line', () => {
    expect(doc).toMatch(/revision 3/);
    expect(doc).toContain('Revision 3 (2026-10-05): `MicStatePayload.supported');
  });
});

describe('docs/PROTOCOL.md revision 4 versus the package', () => {
  const minus = (n: number): string => `${n < 0 ? '\u2212' : ''}${Math.abs(n)}`;
  const quoted = (line: string): string[] => [...line.matchAll(/"([a-z_]+)"/g)].map((m) => m[1] as string);
  const ticked = (text: string): string[] => [...text.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] as string);

  it('the status line and section 8 record revision 4 with its thirteen items', () => {
    expect(doc).toMatch(/^Status: frozen for implementation \(revision 4,/m);
    const start = doc.indexOf('### Revision 4 (2026-10-05)');
    expect(start).toBeGreaterThan(0);
    const items = doc.slice(start).split('\n').filter((l) => /^\d+\. /.test(l));
    expect(items.length).toBe(13);
    expect(items.map((l) => l.split('.')[0])).toEqual(Array.from({ length: 13 }, (_, i) => String(i + 1)));
  });

  it('PrecheckResultPayload lists exactly PRECHECK_INVALID_REASONS (silent_input included)', () => {
    const block = sectionBetween('#### PrecheckResultPayload', '#### WindowResultPayload');
    const line = block.split('\n').find((l) => l.trim().startsWith('invalid_reason:'));
    expect(line).toBeDefined();
    expect(quoted(line as string)).toEqual([...PRECHECK_INVALID_REASONS]);
    expect(quoted(line as string)).toContain('silent_input');
  });

  it('the per-purpose rule lists exactly PRE_WINDOW_INVALID_REASONS for pre_window', () => {
    const block = sectionBetween('#### PrecheckResultPayload', '#### WindowResultPayload');
    const bullet = block.split('\n').find((l) => l.startsWith('- Reasons per purpose'));
    expect(bullet).toBeDefined();
    const afterAllows = (bullet as string).slice((bullet as string).indexOf('allows only') + 'allows only'.length);
    const listText = afterAllows.slice(0, afterAllows.indexOf('('));
    expect(ticked(listText).sort()).toEqual([...PRE_WINDOW_INVALID_REASONS].sort());
    expect(bullet).toContain('`unstable_floor` and `too_loud` apply to the quiet check only');
  });

  it('the window.start row states the vad floor range of the constants', () => {
    const row = doc.split('\n').find((l) => l.startsWith('| `window.start` |'));
    expect(row).toBeDefined();
    expect(row).toContain(`vad_floor_dbfs: number(${minus(VAD_FLOOR_DBFS_MIN).replace('\u2212', '-')}..${minus(VAD_FLOOR_DBFS_MAX).replace('\u2212', '-')})`);
    expect(doc).toContain(`${minus(VAD_FLOOR_DBFS_MIN)} \u2026 ${minus(VAD_FLOOR_DBFS_MAX)}`);
  });

  it('the level row has an integer t_audio_ms and the frame-time invariant', () => {
    const row = doc.split('\n').find((l) => l.startsWith('| `level` |'));
    expect(row).toBeDefined();
    expect(row).toContain('t_audio_ms: int(0..35000)');
    expect(row).toContain(`\u2265 ${FRAME_MS} \u00d7 \`frame_index\` \u2212 1`);
  });

  it('result blocks use integer time fields', () => {
    const pre = sectionBetween('#### PrecheckResultPayload', '#### WindowResultPayload');
    expect(pre).toContain('duration_ms: int');
    const win = sectionBetween('#### WindowResultPayload', '### 3.4 Error codes');
    for (const field of ['active_ms: int', 'longest_active_ms: int', 'onset_ms: int | null', 'duration_ms: int']) {
      expect(win, field).toContain(field);
    }
  });

  it('credential rotation: auth.ok carries next_credential and credentials live 2 h', () => {
    const row = doc.split('\n').find((l) => l.startsWith('| `auth.ok` |'));
    expect(row).toContain('next_credential: string(43)');
    expect(CREDENTIAL_TTL_MS).toBe(2 * 3_600_000);
    const credentials = doc.split('\n').find((l) => l.startsWith('| Credentials |'));
    expect(credentials).toContain('2 h');
    expect(credentials).not.toContain('12 h');
  });

  it('documents the busy join, the ack details, window identity, canonical forwarding and sender normalisation', () => {
    expect(doc).toContain('receives only `join.rejected { reason: "busy" }`');
    for (const detail of ['late', 'already_answered', 'window_open', 'cue_limit', 'next_session', 'already_closed']) {
      expect(doc, detail).toContain(`\`${detail}\``);
    }
    expect(doc).toContain('`window_id` is **unique per measurement**');
    expect(doc).toContain('shares the `attempt_id` of the capture window');
    expect(doc).toContain('canonical re-serialisation of the validated message');
    expect(doc).toContain('**Senders must normalise user text (NFC, then trim); receivers reject non-normalised text**');
  });

  it('section 4 states dedupe per (room, role), record after acceptance and the authoritative generation', () => {
    expect(doc).toContain('**for that (room, role)**');
    expect(doc).toContain('recorded only after the message has been accepted');
    expect(doc).toContain('against the authoritative current generation');
  });
});

describe('docs/PROTOCOL.md other sections versus constants', () => {
  it('error codes (3.4)', () => {
    const section = sectionBetween('### 3.4 Error codes', '## 4. Validation order');
    const codes = [...section.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    expect(codes).toEqual([...ERROR_CODES]);
  });

  it('TvStage names (section 6) equal TV_STAGES', () => {
    const line = doc.split('\n').find((l) => l.startsWith('TV session stages'));
    expect(line).toBeDefined();
    const names = [...(line as string).matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((n) => n !== 'TvStage');
    expect(names).toEqual([...TV_STAGES]);
  });

  it('transport states (section 6)', () => {
    const line = doc.split('\n').find((l) => l.startsWith('Transport states'));
    expect(line).toBeDefined();
    const names = [...(line as string).matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    expect(names).toEqual([...TRANSPORT_STATES]);
  });

  it('message size, pairing alphabet and text limits (sections 7 and 1)', () => {
    expect(doc).toContain(`**${MAX_MESSAGE_BYTES} bytes**`);
    expect(doc).toContain(`alphabet \`${PAIRING_ALPHABET}\``);
    expect(doc).toContain(`${PAIRING_CODE_LENGTH} chars`);
    expect(doc).toMatch(new RegExp(`Cue \\| 1\\u2013${CUE_LENGTH_MAX} code points; max ${CUES_PER_SESSION_MAX} per session`));
    expect(doc).toMatch(new RegExp(`device_label \\| 1\\u2013${DEVICE_LABEL_LENGTH_MAX} code points`));
    expect(doc).toMatch(new RegExp(`each 1\\u2013${PHRASE_LENGTH_MAX} code points`));
  });

  it('audio guard key list (section 4) equals AUDIO_GUARD_KEYS', async () => {
    const { AUDIO_GUARD_KEYS } = await import('../src/index.js');
    const line = doc.split('\n').find((l) => l.startsWith('4. Audio guard'));
    expect(line).toBeDefined();
    const keys = [...(line as string).matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
    expect(keys).toEqual([...AUDIO_GUARD_KEYS]);
    expect(line).toContain('256 code points');
    expect(line).toContain('16 elements');
  });

  it('the envelope field list (section 1) equals ENVELOPE_KEYS', async () => {
    const { ENVELOPE_KEYS } = await import('../src/index.js');
    const section = sectionBetween('## 1. Envelope', 'Identity binding:');
    const fields: string[] = [];
    for (const line of section.split('\n')) {
      const m = /^\| `([a-z_]+)` \|/.exec(line);
      if (m) fields.push(m[1] as string);
    }
    expect(fields).toEqual([...ENVELOPE_KEYS]);
  });
});
