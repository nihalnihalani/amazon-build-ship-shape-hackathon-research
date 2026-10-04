import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const srcRoot = join(pkgRoot, 'src');

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listSources(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const sources = listSources(srcRoot).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

/** Forbidden identifiers are assembled from parts so this test file does not itself contain them. */
const forbidden: Array<[string, RegExp]> = [
  ['recorder API', new RegExp('Media' + 'Recorder')],
  ['network fetch', new RegExp('\\bfet' + 'ch\\s*\\(')],
  ['socket API', new RegExp('Web' + 'Socket')],
  ['XHR', new RegExp('XMLHttp' + 'Request')],
  ['beacon', new RegExp('send' + 'Beacon')],
  ['server-sent events', new RegExp('Event' + 'Source')],
  ['peer connection', new RegExp('RTCPeer' + 'Connection')],
  ['speech recognition', new RegExp('Speech' + 'Recognition', 'i')],
  ['stream destination (recorder feed)', new RegExp('createMediaStream' + 'Destination')],
  ['persistent storage', new RegExp('local' + 'Storage|session' + 'Storage|indexed' + 'DB', 'i')],
  ['file/audio decoding', new RegExp('FileRe' + 'ader|decodeAudio' + 'Data')],
  ['script processor (raw sample callback)', new RegExp('createScript' + 'Processor|onaudio' + 'process')],
  ['analyser raw sample reads', new RegExp('getFloatTimeDomain' + 'Data|getByteTimeDomain' + 'Data')],
];

describe('privacy guards over packages/phone-mic-meter/src', () => {
  it('finds the source files (guard against an empty scan)', () => {
    expect(sources.length).toBeGreaterThanOrEqual(10);
    expect(sources.some((s) => s.path.endsWith('capture.ts'))).toBe(true);
    expect(sources.some((s) => s.path.endsWith('worklet-source.ts'))).toBe(true);
  });

  for (const [label, pattern] of forbidden) {
    it(`contains no ${label}`, () => {
      const hits = sources.filter((s) => pattern.test(s.text)).map((s) => s.path);
      expect(hits).toEqual([]);
    });
  }

  it('has no runtime dependencies and imports only relative modules', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg.dependencies ?? {}).toEqual({});
    for (const s of sources) {
      const specs = [...s.text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] as string);
      for (const spec of specs) {
        expect(spec.startsWith('./') || spec.startsWith('../'), `${s.path} imports ${spec}`).toBe(true);
        expect(spec.endsWith('.js'), `${s.path} imports ${spec} without a .js suffix`).toBe(true);
      }
    }
  });

  it('the scan itself detects a forbidden token (self-check)', () => {
    const sample = 'new ' + 'Media' + 'Recorder(stream)';
    expect(forbidden.some(([, p]) => p.test(sample))).toBe(true);
  });
});
