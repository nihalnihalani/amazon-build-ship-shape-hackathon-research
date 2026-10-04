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
  CUES_PER_SESSION_MAX,
  CUE_LENGTH_MAX,
  DEVICE_LABEL_LENGTH_MAX,
  ERROR_CODES,
  MAX_MESSAGE_BYTES,
  MESSAGE_TYPES,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PHRASE_LENGTH_MAX,
  TV_STAGES,
  TRANSPORT_STATES,
  specFor,
} from '../src/index.js';
import type { Direction, MessageType } from '../src/index.js';

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
