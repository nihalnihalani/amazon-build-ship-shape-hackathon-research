import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ATTEMPT_STATES,
  MESSAGE_TYPES,
  MIC_STATES,
  TRANSPORT_STATES,
  TV_STAGES,
  PROTOCOL_VERSION,
  MAX_MESSAGE_BYTES,
} from '../src/index.js';
import type { SessionEvent, TvStage, WireMessage } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');

describe('TvStage', () => {
  it('has 16 values equal to the session-core contract', () => {
    const contract = readFileSync(resolve(pkgRoot, '../session-core/src/contract.ts'), 'utf8');
    const start = contract.indexOf('export type TvStage');
    const end = contract.indexOf(';', start);
    expect(start).toBeGreaterThanOrEqual(0);
    const stages = [...contract.slice(start, end).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(stages.length).toBe(16);
    expect([...TV_STAGES]).toEqual(stages);
    expect(new Set(TV_STAGES).size).toBe(16);
  });
});

describe('enumerations', () => {
  it('mic, transport and attempt states', () => {
    expect([...MIC_STATES]).toEqual(['off', 'permission_pending', 'permission_denied', 'no_input', 'input_busy', 'constraints_unsupported', 'open_idle', 'measuring', 'error']);
    expect([...TRANSPORT_STATES]).toEqual(['disconnected', 'connecting', 'authenticating', 'connected', 'reconnecting', 'failed']);
    expect([...ATTEMPT_STATES]).toEqual(['capturing', 'capture_closed', 'response_pending', 'revealed', 'cancelled', 'invalid']);
  });
  it('constants', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(MAX_MESSAGE_BYTES).toBe(8192);
    expect(MESSAGE_TYPES.length).toBe(37);
  });
});

describe('type-level checks', () => {
  it('WireMessage is a union discriminated by type', () => {
    function handle(m: WireMessage): string {
      switch (m.type) {
        case 'level':
          expectTypeOf(m.payload.dbfs).toEqualTypeOf<number>();
          return 'level';
        case 'window.start':
          expectTypeOf(m.payload.phrase_position).toEqualTypeOf<number | null>();
          return 'window';
        case 'error':
          expectTypeOf(m.payload.ref_message_id).toEqualTypeOf<string | null>();
          return 'error';
        default:
          return m.type;
      }
    }
    expect(typeof handle).toBe('function');
    expectTypeOf<WireMessage['type']>().toEqualTypeOf<(typeof MESSAGE_TYPES)[number]>();
  });
  it('TvStage derives from the constant list', () => {
    expectTypeOf<TvStage>().toEqualTypeOf<(typeof TV_STAGES)[number]>();
  });
  it('SessionEvent covers the section 5 events', () => {
    const types: Array<SessionEvent['type']> = [
      'remote.ok', 'remote.back', 'remote.up', 'remote.down', 'remote.left', 'remote.right',
      'speaker.rating', 'ui.confirm_skip_listener', 'timer.listener_timeout', 'timer.window_max', 'transport.state', 'wire',
    ];
    expect(types.length).toBe(12);
    const rating: SessionEvent = { type: 'speaker.rating', rating: 'felt_loud' };
    expect(rating.type).toBe('speaker.rating');
  });
});

describe('portability and dependency rules', () => {
  const srcDir = resolve(pkgRoot, 'src');
  const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
  const sources = files.map((f) => ({ file: f, text: readFileSync(resolve(srcDir, f), 'utf8') }));

  it('declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('source imports only relative modules or nothing', () => {
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)'/gm)) {
        expect(m[1], `${file}: ${m[0]}`).toMatch(/^\.\/[a-z-]+\.js$/);
      }
    }
  });

  it('source uses no Node-only or non-portable APIs', () => {
    const banned: Array<[string, RegExp]> = [
      ['Buffer', /\bBuffer\b/],
      ['process', /\bprocess\./],
      ['require()', /\brequire\(/],
      ['node: import', /'node:/],
      ['TextEncoder', /\bTextEncoder\b/],
      ['regex lookbehind', /\(\?<[=!]/],
      ['unicode property escape', /\\p\{/],
      ['structuredClone', /\bstructuredClone\b/],
      ['Object.hasOwn', /\bObject\.hasOwn\b/],
      ['isWellFormed', /\bisWellFormed\b/],
      ['atob/btoa', /\b(?:atob|btoa)\(/],
      ['DOM globals', /\b(?:document|navigator|localStorage|sessionStorage)\.|\bwindow\.(?:location|document|crypto|addEventListener|navigator)/],
    ];
    for (const { file, text } of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const [name, re] of banned) {
        expect(re.test(code), `${file} uses ${name}`).toBe(false);
      }
    }
  });
});
