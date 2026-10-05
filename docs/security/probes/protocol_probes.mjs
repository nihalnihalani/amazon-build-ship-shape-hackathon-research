// Adversarial probes for @atr/protocol parseWireMessage / validateMessageObject.
// Reviewer: security (T02-review / T16-prep). Read-only against packages/protocol.
//
// Usage (from the worktree root):
//   npx tsc -p packages/protocol/tsconfig.build.json --outDir /tmp/atr-protocol-dist
//   ATR_PROTOCOL_DIST=/tmp/atr-protocol-dist/index.js node docs/security/probes/protocol_probes.mjs out.json
//
// Revision 4 edition (T16): expectations follow docs/adr/AMENDMENTS-REV2.md and PROTOCOL.md rev 4. The rev 1 record is in git history (commit eb84ea6).
// Every probe records: id, input class, input, expected (what PROTOCOL.md / the package README
// promise, or "ok" where the current rules accept it), observed, status.
// status: PASS = observed matches expected and no change is recommended
//         GAP  = observed matches the current rules but a stricter rule is recommended (see review)
//         INFO = behaviour documented for the record, no change recommended
//         FAIL = observed differs from expected (a defect against the documented contract)

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const distPath = process.env.ATR_PROTOCOL_DIST ?? path.resolve(here, '../../../packages/protocol/dist/index.js');
const P = await import(pathToFileURL(distPath).href);

const NOW = 1_800_000_000_000;
const DAY = 24 * 3_600_000;
const rows = [];

const mid = 'm_AAAAAAAAAAAAAAAA';
function env(type, payload, o = {}) {
  return {
    protocol_version: 1,
    type,
    message_id: mid,
    room_id: 'r_AAAAAAAAAAAAAAAA',
    session_id: null,
    window_id: null,
    attempt_id: null,
    sender_role: 'phone',
    producer_generation: 1,
    sequence: 1,
    event_timestamp: NOW,
    payload,
    ...o,
  };
}
const ping = (o) => env('ping', {}, { room_id: null, ...o });
const phrases = (arr, o) => env('phrases.update', { phrases: arr }, o);
const cue = (text, o) => env('cue', { text }, { session_id: 's_AAAAAAAA', ...o });
const joinReq = (code, label = 'Pixel 8') =>
  env('join.request', { pairing_code: code, device_label: label }, { room_id: null, producer_generation: 0 });
const ids = { session_id: 's_AAAAAAAA', window_id: 'w_AAAAAAAA', attempt_id: 'a_AAAAAAAA' };
const levelMsg = (p) => env('level', { frame_index: 0, t_audio_ms: 0, dbfs: -50, active: false, clipped: false, ...p }, ids);
const winResult = (p) =>
  env(
    'window.result',
    {
      kind: 'phrase', valid: true, invalid_reason: null, frame_count: 160, expected_frames: 160, coverage: 1,
      active_ms: 3000, longest_active_ms: 2000, segments: 2, onset_ms: 300, p50_active_dbfs: -30,
      p95_active_dbfs: -20, peak_dbfs: -15, clipped_frames: 0, nonfinite_frames: 0, duration_ms: 8000, ...p,
    },
    ids,
  );
const preResult = (p) =>
  env(
    'precheck.result',
    {
      purpose: 'quiet_check', valid: true, invalid_reason: null, floor_dbfs: -60, p20_dbfs: -62, p80_dbfs: -58,
      p95_dbfs: -55, frame_count: 100, expected_frames: 100, coverage: 1, clipped_frames: 0, nonfinite_frames: 0,
      duration_ms: 5000, ...p,
    },
    ids,
  );

const run = (raw, opts) => P.parseWireMessage(raw, { now: NOW, ...opts });
const runObj = (obj, opts) => P.validateMessageObject(obj, { now: NOW, ...opts });
const cls = (r) => (r.ok ? 'ok' : r.code);
const sum = (r) => (r.ok ? `ok(${r.message.type})` : `${r.code}: ${r.detail}`);
const J = JSON.stringify;

// Make every non-ASCII code point visible as <U+XXXX> so the record is pure ASCII.
const vis = (s) => String(s).replace(/[^\x20-\x7e]/gu, (c) => '<U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + '>');
function rec(id, klass, input, expect, observedResult, opts = {}) {
  const observed = vis(typeof observedResult === 'string' ? observedResult : sum(observedResult));
  const token = typeof observedResult === 'string' ? observedResult.split(/[ :(]/)[0] : cls(observedResult);
  const matches = Array.isArray(expect) ? expect.includes(token) : token === expect;
  let status = matches ? 'PASS' : 'FAIL';
  if (matches && opts.gap) status = 'GAP';
  if (matches && opts.info) status = 'INFO';
  rows.push({ id, klass: vis(klass), input: vis(input), expect: Array.isArray(expect) ? expect.join('|') : expect, observed, status, note: vis(opts.note ?? '') });
}
const esc = (s) => J(s).slice(1, -1); // JSON string body with escapes
function info(id, klass, input, observed, note = '') {
  rows.push({ id, klass, input: vis(input), expect: 'n/a', observed: vis(observed), status: 'INFO', note: vis(note) });
}

// ------------------------------------------------------------------ A baseline controls
rec('A01', 'control', 'valid ping', 'ok', run(J(ping())));
rec('A02', 'control', 'valid phrases.update (1 phrase)', 'ok', run(J(phrases(['Hello there']))));
rec('A03', 'control', 'valid cue', 'ok', run(J(cue('Volume'))));
rec('A04', 'control', 'valid join.request', 'ok', run(J(joinReq('ACDEFH'))));
rec('A05', 'control', 'valid window.result', 'ok', run(J(winResult())));
rec('A06', 'control', 'valid precheck.result', 'ok', run(J(preResult())));
rec('A07', 'control', 'valid level', 'ok', run(J(levelMsg())));

// ------------------------------------------------------------------ B prototype pollution
{
  const body = J(ping()).slice(1); // drop leading {
  const rawEnvProto = '{"__proto__":{"polluted":"yes"},' + body;
  rec('B01', 'prototype pollution', '13th envelope key "__proto__":{"polluted":"yes"} (raw JSON)', 'bad_schema', run(rawEnvProto));
  rec('B02', 'prototype pollution', 'ping payload {"__proto__":{"polluted":1}}', 'bad_schema', run(J(ping()).replace('"payload":{}', '"payload":{"__proto__":{"polluted":1}}')));
  rec('B03', 'prototype pollution', 'cue payload with "constructor":{"prototype":{"x":1}}', 'bad_schema', run(J(cue('Hi')).replace('"text":"Hi"', '"text":"Hi","constructor":{"prototype":{"x":1}}')));
  const swapped = J(ping()).replace('"message_id":"' + mid + '"', '"__proto__":"' + mid + '"');
  rec('B04', 'prototype pollution', '"message_id" renamed to "__proto__" (still 12 keys)', 'bad_schema', run(swapped));
  rec('B05', 'prototype pollution', 'phrases element is object {"__proto__":{}}', 'bad_schema', run(J(phrases(['x'])).replace('["x"]', '[{"__proto__":{}}]')));
  rec('B06', 'prototype pollution', 'validateMessageObject(Object.create({polluted:1}) with envelope fields)', 'bad_schema', runObj(Object.assign(Object.create({ polluted: 1 }), ping())));
  const parsed = JSON.parse(rawEnvProto); // own enumerable "__proto__" key
  rec('B07', 'prototype pollution', 'validateMessageObject(JSON.parse(B01)) with own "__proto__" key', 'bad_schema', runObj(parsed));
  rec('B08', 'prototype pollution', 'global state after B01-B07: ({}).polluted, ({}).x, Object.prototype own keys', 'clean',
    ({}).polluted === undefined && ({}).x === undefined && Object.getOwnPropertyNames(Object.prototype).length === 12 ? 'clean' : 'POLLUTED');
}

// ------------------------------------------------------------------ C duplicate JSON keys
{
  const rawDupType = J(ping({ room_id: 'r_AAAAAAAAAAAAAAAA' })).replace('"type":"ping"', '"type":"ping","type":"unpair"');
  const r1 = run(rawDupType);
  rec('C01', 'duplicate keys', '"type" appears twice ("ping" then "unpair")', 'ok', r1, {
    info: true,
    note: `validator: last wins (type=${r1.ok ? r1.message.type : 'n/a'}); the relay forwards the canonical re-serialization (PK-04), verified end to end in tests/security (SEC-V03)`,
  });
  const rawDupMsgId = J(ping()).replace('"message_id":"' + mid + '"', '"message_id":"m_BBBBBBBBBBBBBBBB","message_id":"' + mid + '"');
  const r2 = run(rawDupMsgId);
  rec('C02', 'duplicate keys', '"message_id" twice (B..., then A...)', 'ok', r2, { info: true, note: `clean copy carries ${r2.ok ? r2.message.message_id : 'n/a'}; raw frame still contains both ids` });
  const rawDupText = J(cue('Hi')).replace('"text":"Hi"', '"text":"Hi","text":"Volume"');
  const r3 = run(rawDupText);
  rec('C03', 'duplicate keys', 'cue payload "text" twice', 'ok', r3, { info: true, note: `kept: ${r3.ok ? r3.message.payload.text : 'n/a'}` });
  const rawDupPayload = J(ping()).replace('"payload":{}', '"payload":{"a":1},"payload":{}');
  rec('C04', 'duplicate keys', '"payload" twice (first invalid, last valid)', 'ok', run(rawDupPayload), { info: true, note: 'first payload is never validated; only the last survives parsing' });
}

// ------------------------------------------------------------------ D nesting and structural DoS
{
  const deepObj = (n) => '{"a":'.repeat(n) + '1' + '}'.repeat(n);
  rec('D01', 'deep nesting', 'ping payload nested 9 objects deep (raw)', 'bad_schema', run(J(ping()).replace('"payload":{}', '"payload":' + deepObj(9))));
  const arr3900 = '['.repeat(3900) + ']'.repeat(3900);
  const raw3900 = J(ping()).replace('"payload":{}', '"payload":' + arr3900);
  rec('D02', 'deep nesting', `payload = 3900 nested arrays (${raw3900.length} bytes raw, under the cap)`, 'bad_schema', run(raw3900));
  rec('D03', 'deep nesting', '8190 x "[" raw frame (parser stress)', 'bad_schema', run('['.repeat(8190)));
  let deep = {}; let cur = deep; for (let i = 0; i < 200000; i++) { cur.a = {}; cur = cur.a; }
  const t0 = performance.now();
  const rD4 = runObj({ ...ping(), payload: deep });
  rec('D04', 'deep nesting', 'validateMessageObject, payload 200000 levels deep (programmatic)', ['bad_schema', 'payload_too_large'], rD4, { note: `no crash; ${(performance.now() - t0).toFixed(1)} ms` });
  const circ = ping(); circ.payload.self = circ;
  rec('D05', 'deep nesting', 'validateMessageObject, circular payload', 'bad_schema', runObj(circ));
  rec('D06', 'deep nesting', 'validateMessageObject, BigInt in payload', 'bad_schema', runObj({ ...ping(), payload: { n: 1n } }));
  const tj = ping(); Object.defineProperty(tj, 'toJSON', { value: () => ({}), enumerable: false });
  rec('D07', 'deep nesting', 'validateMessageObject, non-enumerable toJSON that hides content from the size check', 'bad_schema', runObj(tj));
  // stateful Proxy: `payload` is read 4 times (stringify, audit guard, schema check, clone); the clone read differs.
  let reads = 0;
  const target = ping();
  const proxy = new Proxy(target, {
    get(t, k, r) {
      if (k === 'payload') { reads += 1; return reads <= 3 ? {} : { injected: 'unvalidated' }; }
      return Reflect.get(t, k, r);
    },
  });
  const rP = runObj(proxy);
  const leaked = rP.ok && Object.prototype.hasOwnProperty.call(rP.message.payload, 'injected');
  rec('D08', 'TOCTOU', 'stateful Proxy whose 4th read of "payload" (the clone step) returns {injected:"unvalidated"}', 'no_leak', leaked ? 'LEAK: clean copy contains unvalidated field' : `no_leak (${sum(rP)}; reads=${reads})`, {
    note: 'PK-01: rev 4 snapshots the input once and validates and returns the snapshot',
  });
}

// ------------------------------------------------------------------ E numbers
{
  const withSeq = (lit) => J(ping()).replace('"sequence":1', '"sequence":' + lit);
  rec('E01', 'huge numbers', 'sequence 1e999 (raw, parses to Infinity)', 'bad_schema', run(withSeq('1e999')));
  rec('E02', 'huge numbers', 'sequence -1e999', 'bad_schema', run(withSeq('-1e999')));
  rec('E03', 'huge numbers', 'sequence 9007199254740993 (rounds to 2^53)', 'bad_schema', run(withSeq('9007199254740993')));
  rec('E04', 'huge numbers', 'sequence 9007199254740991 (MAX_SAFE_INTEGER)', 'ok', run(withSeq('9007199254740991')), { info: true, note: 'legal; a producer that sends it exhausts its own sequence space until it resumes with a new generation' });
  const r0 = run(withSeq('-0'));
  rec('E05', 'negative zero', 'sequence -0 (raw): clean copy must not contain -0', 'normalised', r0.ok ? (Object.is(r0.message.sequence, -0) ? 'STILL_NEGATIVE_ZERO' : 'normalised') : sum(r0), { note: 'PK-05' });
  const rl = run(J(levelMsg()).replace('"dbfs":-50', '"dbfs":-0'));
  rec('E06', 'negative zero', 'level.dbfs -0: clean copy must not contain -0', 'normalised', rl.ok ? (Object.is(rl.message.payload.dbfs, -0) ? 'STILL_NEGATIVE_ZERO' : 'normalised') : sum(rl), { note: 'PK-05' });
  rec('E07', 'huge numbers', 'producer_generation 2147483648 (2^31)', 'bad_schema', run(J(ping()).replace('"producer_generation":1', '"producer_generation":2147483648')));
  rec('E08', 'huge numbers', 'producer_generation 2147483647', 'ok', run(J(ping()).replace('"producer_generation":1', '"producer_generation":2147483647')));
  rec('E09', 'huge numbers', 'level.dbfs 1e308', 'bad_schema', run(J(levelMsg()).replace('"dbfs":-50', '"dbfs":1e308')));
  rec('E10', 'numbers', 'sequence as string "5"', 'bad_schema', run(withSeq('"5"')));
  rec('E11', 'numbers', 'sequence 1.5', 'bad_schema', run(withSeq('1.5')));
  rec('E12', 'numbers', 'sequence 1e2 and 100.0 (non-canonical integer spellings)', 'ok', run(withSeq('1e2')), { info: true, note: 'accepted; spelling is not preserved by JSON.parse, so no differential' });
  rec('E13', 'numbers', 'NaN literal in raw JSON', 'bad_schema', run(withSeq('NaN')));
  rec('E14', 'numbers', 'Infinity literal in raw JSON', 'bad_schema', run(withSeq('Infinity')));
  rec('E15', 'numbers', 'level.frame_index 701', 'bad_schema', run(J(levelMsg({ frame_index: 701 }))));
rec('E16', 'numbers', 'level.dbfs = -23.123456789012345 (15 digits)', 'bad_schema', run(J(levelMsg({ dbfs: -23.123456789012345 }))), { note: 'PK-06: dB fields are multiples of 0.1' });
  rec('E16b', 'numbers', 'level.dbfs = -23.1 (one decimal)', 'ok', run(J(levelMsg({ dbfs: -23.1 }))));
  rec('E16c', 'numbers', 'level.dbfs = -23.15 (two decimals)', 'bad_schema', run(J(levelMsg({ dbfs: -23.15 }))));
  rec('E16d', 'numbers', 'window.result.coverage = 0.9996 (not a multiple of 0.001)', 'bad_schema', run(J(winResult({ coverage: 0.9996 }))));
  rec('E16e', 'numbers', 'level.t_audio_ms = 1000.5 (not an integer)', 'bad_schema', run(J(levelMsg({ t_audio_ms: 1000.5 }))));
  rec('E17', 'numbers', 'window.result.coverage 1.0000001', 'bad_schema', run(J(winResult({ coverage: 1.0000001 }))));
}

// ------------------------------------------------------------------ F control and format characters (raw JSON escapes)
const textProbes = [
  ['U+0000', '\\u0000', 'bad_schema'], ['U+001F', '\\u001f', 'bad_schema'], ['U+007F', '\\u007f', 'bad_schema'],
  ['U+0080', '\\u0080', 'bad_schema'], ['U+0085 NEL', '\\u0085', 'bad_schema'], ['U+009F', '\\u009f', 'bad_schema'],
  ['TAB', '\\t', 'bad_schema'], ['LF', '\\n', 'bad_schema'], ['CR', '\\r', 'bad_schema'],
];
for (const [name, e, expect] of textProbes) {
  rec(`F-${name}`, 'escaped control char', `phrase "a${name}b" via JSON escape`, expect, run(J(phrases(['x'])).replace('"x"', `"a${e}b"`)));
}
const fmtProbes = [
  ['U+2028 LINE SEP', '\\u2028'], ['U+2029 PARA SEP', '\\u2029'], ['U+200B ZWSP', '\\u200b'], ['U+200C ZWNJ', '\\u200c'],
  ['U+200D ZWJ', '\\u200d'], ['U+2060 WORD JOINER', '\\u2060'], ['U+FEFF BOM mid-string', '\\ufeff'], ['U+00AD SOFT HYPHEN', '\\u00ad'],
  ['U+FFFE noncharacter', '\\ufffe'], ['U+FFF9 interlinear', '\\ufff9'], ['U+E000 private use', '\\ue000'],
  ['U+E0041 TAG LATIN A (surrogate pair)', '\\udb40\\udc41'],
];
const keepFmt = /ZWSP|ZWNJ|ZWJ|SOFT HYPHEN|private use/;
for (const [name, e] of fmtProbes) {
  rec(`F-${name}`, 'format/invisible char', `phrase "a${name}b"`, keepFmt.test(name) ? 'ok' : 'bad_schema', run(J(phrases(['x'])).replace('"x"', `"a${e}b"`)), keepFmt.test(name) ? { info: true, note: 'allowed by design (ZWNJ and ZWJ are needed for Persian, Urdu, Devanagari and emoji sequences)' } : { note: 'PK-03' });
}
for (const [name, e] of [['3 x U+200B only', '\\u200b\\u200b\\u200b'], ['U+3164 HANGUL FILLER', '\\u3164'], ['U+2800 BRAILLE BLANK', '\\u2800']]) {
  rec(`F-${name}`, 'visually empty phrase', `phrase = ${name}`, 'bad_schema', run(J(phrases(['x'])).replace('"x"', `"${e}"`)), { note: 'PK-03' });
}
rec('F-leading-space', 'trim', 'phrase " Hello"', 'bad_schema', run(J(phrases([' Hello']))));
rec('F-trailing-nbsp', 'trim', 'phrase "Hello\\u00a0"', 'bad_schema', run(J(phrases(['Hello\u00a0']))));
rec('F-trailing-2028', 'trim', 'phrase "Hello\\u2028" (edge)', 'bad_schema', run(J(phrases(['Hello\u2028']))));
rec('F-whitespace-only', 'trim', 'phrase "   "', 'bad_schema', run(J(phrases(['   ']))));
rec('F-empty', 'length', 'phrase ""', 'bad_schema', run(J(phrases(['']))));
rec('F-1char', 'length', 'phrase "I" (1 code point)', 'ok', run(J(phrases(['I']))), { info: true, note: 'see ADR-0001 finding: a 1-syllable phrase cannot reach active_ms >= 400' });
rec('F-60ascii', 'length', 'phrase 60 x "a"', 'ok', run(J(phrases(['a'.repeat(60)]))));
rec('F-61ascii', 'length', 'phrase 61 x "a"', 'bad_schema', run(J(phrases(['a'.repeat(61)]))));
rec('F-60emoji', 'length', 'phrase 60 x U+1F600 (120 UTF-16 units, 240 bytes)', 'ok', run(J(phrases(['\u{1F600}'.repeat(60)]))));
rec('F-61emoji', 'length', 'phrase 61 x U+1F600', 'bad_schema', run(J(phrases(['\u{1F600}'.repeat(61)]))));
rec('F-zwj-family', 'length', '9 x family emoji (7 code points each = 63)', 'bad_schema', run(J(phrases(['\u{1F468}\u200d\u{1F469}\u200d\u{1F467}\u200d\u{1F466}'.repeat(9)]))), { info: true, note: 'length is code points, not grapheme clusters: 9 visible glyphs are rejected' });
{
  const zalgo = 'x' + '\u0301'.repeat(59);
  rec('F-combining-stack', 'combining marks', '"x" + 59 x U+0301 (NFC-stable, 60 code points)', 'bad_schema', run(J(phrases([zalgo]))), { note: 'PK-03' });
  rec('F-combining-4', 'combining marks', '"x" + 4 combining marks', 'ok', run(J(phrases(['x' + String.fromCodePoint(0x301, 0x302, 0x303, 0x304)]))));
}
rec('F-device-label-24emoji', 'length', 'device_label 24 emoji (96 bytes)', 'ok', run(J(joinReq('ACDEFH', '\u{1F600}'.repeat(24)))));
rec('F-device-label-25', 'length', 'device_label 25 chars', 'bad_schema', run(J(joinReq('ACDEFH', 'a'.repeat(25)))));

// ------------------------------------------------------------------ G surrogates
for (const [name, e, expect] of [
  ['lone high U+D800', '\\ud800', 'bad_schema'], ['lone low U+DC00', '\\udc00', 'bad_schema'],
  ['high at end', 'Hi\\ud800', 'bad_schema'], ['high before ASCII', '\\ud800a', 'bad_schema'],
  ['reversed pair low,high', '\\udc00\\ud800', 'bad_schema'], ['valid pair U+1F600', '\\ud83d\\ude00', 'ok'],
]) {
  rec(`G-${name}`, 'surrogate', `phrase ${name}`, expect, run(J(phrases(['x'])).replace('"x"', `"${e}"`)));
}
rec('G-key', 'surrogate', 'payload key "\\ud800" (lone surrogate as key name)', 'bad_schema', run(J(ping()).replace('"payload":{}', '"payload":{"\\ud800":1}')));
rec('G-pairing-code', 'surrogate', 'pairing_code containing lone high surrogate', 'bad_schema', run(J(joinReq('ACDEF\ud800'))));
rec('G-app-version', 'surrogate', 'room.create app_version lone surrogate', 'bad_schema',
  run(J(env('room.create', { client: { app_version: '1.0\ud800', platform: 'vega' } }, { room_id: null, producer_generation: 0, sender_role: 'tv' }))));
{
  const enc = new TextEncoder();
  let mismatches = 0; const samples = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  for (let i = 0; i < 20000; i++) {
    let s = '';
    const n = rnd() % 12;
    for (let k = 0; k < n; k++) {
      const pick = rnd() % 6;
      s += pick === 0 ? String.fromCharCode(0xd800 + (rnd() % 0x400)) : pick === 1 ? String.fromCharCode(0xdc00 + (rnd() % 0x400))
        : pick === 2 ? String.fromCodePoint(0x10000 + (rnd() % 0x100000)) : pick === 3 ? String.fromCharCode(0x80 + (rnd() % 0x780))
        : pick === 4 ? String.fromCharCode(0x800 + (rnd() % 0xd000)) : String.fromCharCode(32 + (rnd() % 95));
    }
    if (P.utf8ByteLength(s) !== enc.encode(s).length) { mismatches++; if (samples.length < 3) samples.push(J(s)); }
  }
  rec('G-utf8-len', 'surrogate', 'utf8ByteLength vs TextEncoder over 20000 random strings with lone/paired surrogates', 'match', mismatches === 0 ? 'match' : `mismatch x${mismatches} ${samples.join(',')}`);
}

// ------------------------------------------------------------------ H pairing-code homoglyphs
for (const [name, code, expect] of [
  ['valid', 'ACDEFH', 'ok'], ['lowercase', 'acdefh', 'bad_schema'], ['Cyrillic A U+0410', '\u0410CDEFH', 'bad_schema'],
  ['Greek Alpha U+0391', '\u0391CDEFH', 'bad_schema'], ['fullwidth A U+FF21', '\uff21CDEFH', 'bad_schema'],
  ['Latin O (not in alphabet)', 'ACDEFO', 'bad_schema'], ['digit zero', 'ACDEF0', 'bad_schema'], ['digit one', 'ACDEF1', 'bad_schema'],
  ['letter I', 'ACDEFI', 'bad_schema'], ['letter L', 'ACDEFL', 'bad_schema'], ['digit 5', 'ACDEF5', 'bad_schema'],
  ['letter S', 'ACDEFS', 'bad_schema'], ['digit 8', 'ACDEF8', 'bad_schema'], ['letter B', 'ACDEFB', 'bad_schema'],
  ['trailing newline', 'ACDEFH\n', 'bad_schema'], ['5 chars', 'ACDEF', 'bad_schema'], ['7 chars', 'ACDEFHJ', 'bad_schema'],
  ['zero-width inside', 'AC\u200bDEFH', 'bad_schema'], ['leading space', ' ACDEF', 'bad_schema'], ['NUL', 'ACDEF\u0000', 'bad_schema'],
]) {
  rec(`H-${name}`, 'pairing code', `join.request pairing_code ${J(code)}`, expect, run(J(joinReq(code))));
}
{
  const alpha = [...P.PAIRING_ALPHABET];
  rec('H-alphabet', 'pairing code', `alphabet "${P.PAIRING_ALPHABET}": ${alpha.length} distinct symbols; 22^6 = ${22 ** 6}`, '22', String(new Set(alpha).size), { info: true, note: 'residual look-alike pairs at 3 m for human review: U/V, M/N, E/F, 7/T, 4/A' });
}

// ------------------------------------------------------------------ I BOM
rec('I01', 'BOM', 'leading U+FEFF before a valid frame', 'bad_schema', run('\ufeff' + J(ping())));
rec('I02', 'BOM', 'trailing U+FEFF after a valid frame', 'bad_schema', run(J(ping()) + '\ufeff'));
rec('I03', 'BOM', 'UTF-8 BOM bytes EF BB BF + JSON as a Buffer (binary)', 'binary_rejected', run(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(J(ping()))])));

// ------------------------------------------------------------------ J non-object JSON and non-string inputs
for (const [name, raw] of [
  ['null', 'null'], ['empty array', '[]'], ['number', '1'], ['string', '"x"'], ['true', 'true'], ['empty object', '{}'],
  ['batch [valid message]', '[' + J(ping()) + ']'], ['empty string', ''], ['whitespace only', '   '],
  ['valid + trailing garbage', J(ping()) + 'x'], ['trailing comma', '{"a":1,}'], ['comment', '/*c*/{}'], ['single quotes', "{'a':1}"],
]) rec(`J-${name}`, 'non-object JSON', `raw ${J(raw.length > 40 ? raw.slice(0, 37) + '...' : raw)}`, 'bad_schema', run(raw));
for (const [name, val] of [
  ['Buffer', Buffer.from(J(ping()))], ['Uint8Array', new Uint8Array(Buffer.from(J(ping())))], ['ArrayBuffer', new Uint8Array(Buffer.from(J(ping()))).buffer],
  ['Blob', new Blob([J(ping())])], ['number', 5], ['undefined', undefined], ['null', null], ['parsed object', ping()],
]) rec(`J-input-${name}`, 'non-string input', `parseWireMessage(${name})`, 'binary_rejected', P.parseWireMessage(val, { now: NOW }));

// ------------------------------------------------------------------ K message_id collisions (relay helper)
{
  const d = new P.MessageIdDedupe();
  rec('K01', 'message_id', 'record then has: same id is a duplicate', 'true', String((d.record('m_AAAAAAAAAAAAAAAA'), d.has('m_AAAAAAAAAAAAAAAA'))));
  const d2 = new P.MessageIdDedupe(1024);
  d2.record('m_FIRST000000000000');
  for (let i = 0; i < 1024; i++) d2.record('m_' + String(i).padStart(16, '0'));
  rec('K02', 'message_id', 'after 1024 further distinct ids the first id is evicted', 'false', String(d2.has('m_FIRST000000000000')), { info: true, note: 'after eviction only the sequence check stops a replay; at 40 msgs/s the window is ~26 s' });
  const scopes = new P.DedupeScopes();
  scopes.record('r_AAAAAAAAAAAAAAAA', 'phone', 'm_SHAREDID00000000');
  rec('K03', 'message_id', 'id recorded for role "phone" is NOT a duplicate for role "tv" (PK-08 scoping)', 'false', String(scopes.has('r_AAAAAAAAAAAAAAAA', 'tv', 'm_SHAREDID00000000')));
  rec('K03b', 'message_id', 'has() does not record: a message dropped later can be retransmitted with the same id', 'false', String((() => { const x = new P.MessageIdDedupe(); x.has('m_RETRY00000000000'); return x.has('m_RETRY00000000000'); })()));
  rec('K04', 'message_id', 'ids differing only in case are distinct', 'false', String((() => { const x = new P.MessageIdDedupe(); x.record('m_AAAAAAAAAAAAAAAA'); return x.has('m_aaaaaaaaaaaaaaaa'); })()));
  const idsOK = [run(J(ping({ message_id: 'm_' + 'A'.repeat(16) }))), run(J(ping({ message_id: 'm_' + 'A'.repeat(32) }))), run(J(ping({ message_id: 'm_' + 'A'.repeat(33) }))), run(J(ping({ message_id: 'm_' + 'A'.repeat(15) })))].map(cls);
  rec('K05', 'message_id', 'length 16 and 32 accepted, 15 and 33 rejected', 'ok,ok,bad_schema,bad_schema', idsOK.join(','), { note: 'format allows low-entropy chosen ids (e.g. 16 x "A"); uniqueness is not enforced by the validator' });
  const t = new P.SequenceTracker();
  t.accept(1, 1, 5);
  rec('K06', 'sequence', 'SequenceTracker.accept(expected=1, generation=2147483647, sequence=0): a jump is stale', 'stale', t.accept(1, 2147483647, 0), { note: 'PK-07; afterwards the legitimate generation-1 sequence 6 is ' + t.accept(1, 1, 6) });
  const t2 = new P.SequenceTracker();
  rec('K07', 'sequence', 'tracker: same sequence twice', 'replay', (() => { t2.accept(1, 1, 3); return t2.accept(1, 1, 3); })());
  rec('K08', 'sequence', 'old two-argument call form throws instead of silently rejecting', 'TypeError', (() => { try { new P.SequenceTracker().accept(1, 5); return 'no_throw'; } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } })());
  rec('K09', 'sequence', 'expectedGeneration must not decrease', 'RangeError', (() => { const x = new P.SequenceTracker(); x.accept(2, 2, 1); try { x.accept(1, 1, 5); return 'no_throw'; } catch (e) { return e instanceof RangeError ? 'RangeError' : 'other'; } })());
}
function rawVerdict(v) { return v; }

// ------------------------------------------------------------------ L timestamps
for (const [name, ts, expect] of [
  ['now', NOW, 'ok'], ['now+24h', NOW + DAY, 'ok'], ['now+24h+1ms', NOW + DAY + 1, 'bad_schema'], ['now-24h', NOW - DAY, 'ok'],
  ['now-24h-1ms', NOW - DAY - 1, 'bad_schema'], ['0', 0, 'bad_schema'], ['-1', -1, 'bad_schema'], ['1.5', NOW + 0.5, 'bad_schema'],
  ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER, 'bad_schema'],
]) rec(`L-${name}`, 'timestamp', `event_timestamp ${name} (receiver now fixed)`, expect, run(J(ping({ event_timestamp: ts }))));
rec('L-now-NaN', 'timestamp', 'opts.now = NaN (caller bug) with ts = real Date.now()', 'ok', P.parseWireMessage(J(ping({ event_timestamp: Date.now() })), { now: NaN }), { info: true, note: 'falls back to Date.now(); relay must never take opts.now from the peer' });
{
  const big = run(J(ping()), { maxBytes: 1e9 });
  rec('L-maxBytes-raise', 'size', 'opts.maxBytes = 1e9 (attempt to raise the cap)', 'ok', big, { info: true, note: 'cap is min(opts.maxBytes, 8192)' });
}

// ------------------------------------------------------------------ M normalization
for (const [name, text, expect] of [
  ['NFD e+U+0301', 'e\u0301', 'bad_schema'], ['NFC precomposed', '\u00e9', 'ok'], ['Angstrom sign U+212B', '\u212b', 'bad_schema'],
  ['Kelvin sign U+212A', '\u212a', 'bad_schema'], ['Hangul decomposed jamo', '\u1112\u1161\u11ab', 'bad_schema'],
  ['ligature U+FB01 (NFKC differs)', '\ufb01ne', 'ok'], ['fullwidth A (NFKC differs)', '\uff21', 'ok'], ['circled digit (NFKC differs)', '\u2460', 'ok'],
  ['Devanagari with ZWJ (legit)', '\u0915\u094d\u200d\u0937', 'ok'],
]) rec(`M-${name}`, 'normalization', `phrase ${name}`, expect, run(J(phrases([text]))), expect === 'ok' && /NFKC/.test(name) ? { info: true, note: 'literal text preserved; NFKC would corrupt user text and is not recommended for phrases' } : {});
rec('M-normalize-available', 'normalization', 'String.prototype.normalize present in this runtime', 'true', String(typeof String.prototype.normalize === 'function'), { info: true, note: 'on Hermes/Vega this is unverified; if absent, normalizeUserText is the identity and non-NFC text would pass the TV-side check (relay still enforces on Node)' });

// ------------------------------------------------------------------ N bidi and direction controls
const bidi = [
  ['U+202A LRE', '\u202a'], ['U+202B RLE', '\u202b'], ['U+202C PDF', '\u202c'], ['U+202D LRO', '\u202d'], ['U+202E RLO', '\u202e'],
  ['U+2066 LRI', '\u2066'], ['U+2067 RLI', '\u2067'], ['U+2068 FSI', '\u2068'], ['U+2069 PDI', '\u2069'],
  ['U+200E LRM', '\u200e'], ['U+200F RLM', '\u200f'], ['U+061C ALM', '\u061c'],
];
for (const [name, ch] of bidi) {
  const rp = run(J(phrases(['abc' + ch + 'def'])));
  const implicit = /LRM|RLM|ALM/.test(name);
  rec(`N-phrase-${name}`, 'bidi control', `phrase "abc${name}def"`, implicit ? 'ok' : 'bad_schema', rp, implicit ? { info: true, note: 'implicit marks are legitimate in mixed-direction text; kept allowed' } : { note: 'PK-03' });
}
rec('N-label-RLO', 'bidi control', 'device_label "Mom\\u202es phone" (shown on the TV at pairing)', 'bad_schema', run(J(joinReq('ACDEFH', 'Mom\u202es phone'))), { note: 'PK-03' });
rec('N-cue-RLO', 'bidi control', 'cue "Vol\\u202eume"', 'bad_schema', run(J(cue('Vol\u202eume'))), { note: 'PK-03' });
rec('N-appver-RLO', 'bidi control', 'room.create app_version "1.0\\u202e"', 'bad_schema', run(J(env('room.create', { client: { app_version: '1.0\u202e', platform: 'vega' } }, { room_id: null, producer_generation: 0, sender_role: 'tv' }))), { note: 'PK-03' });

// ------------------------------------------------------------------ O audio guard
rec('O01', 'audio guard', 'cue payload extra key "Data"', 'audio_rejected', run(J(cue('Hi')).replace('"text":"Hi"', '"text":"Hi","Data":1')));
rec('O02', 'audio guard', 'key spelled "d\\u0061ta" (escaped)', 'audio_rejected', run(J(cue('Hi')).replace('"text":"Hi"', '"text":"Hi","d\\u0061ta":1')));
rec('O03', 'audio guard', 'cue.text of 257 code points', 'audio_rejected', run(J(cue('a'.repeat(257)))));
rec('O04', 'audio guard', 'cue.text of 256 code points (schema says max 12)', 'bad_schema', run(J(cue('a'.repeat(256)))));
rec('O05', 'audio guard', 'phrases array of 17 items', 'audio_rejected', run(J(phrases(Array(17).fill('a')))));
rec('O06', 'audio guard', 'phrases array of 11 items (schema max 10, guard max 16)', 'bad_schema', run(J(phrases(Array(11).fill('a')))));
for (const [name, v] of [['Float32Array', new Float32Array(4)], ['Uint8Array', new Uint8Array(4)], ['ArrayBuffer', new ArrayBuffer(4)], ['Buffer', Buffer.from('x')], ['Blob', new Blob(['x'])]]) {
  rec(`O-${name}`, 'audio guard', `validateMessageObject, payload.x = ${name}`, ['audio_rejected', 'bad_schema'], runObj({ ...ping(), payload: { x: v } }));
}
{
  // 20 level frames per second, arbitrary mantissa: capacity of the numeric covert channel
  const bitsPerFrame = 52; const fps = 20;
  info('O-covert-capacity', 'audio guard', 'level.dbfs after PK-06 quantisation: multiples of 0.1 over -140..20 = 1601 values at 20 frames/s', `${Math.floor(Math.log2(1601) * 20)} bit/s per dB field (was 1040 bit/s with a free 52-bit mantissa)`, 'residual R4: below low-rate speech codecs (0.7-2.4 kbit/s) per field but not zero; enforced by review, CSP connect-src and network inspection');
}

// ------------------------------------------------------------------ P cross-field semantic gaps (all accepted today)
const sem = [
  ['P01 valid:true with coverage 0.01', () => run(J(winResult({ coverage: 0.01 }))), 'bad_schema'],
  ['P02 frame_count 700 > expected_frames 160', () => run(J(winResult({ frame_count: 700 }))), 'bad_schema'],
  ['P03 active_ms 35000 > duration_ms 8000', () => run(J(winResult({ active_ms: 35000 }))), 'bad_schema'],
  ['P04 longest_active_ms 8000 > active_ms 3000', () => run(J(winResult({ longest_active_ms: 8000 }))), 'bad_schema'],
  ['P05 valid:true but p95_active/p50/peak all null', () => run(J(winResult({ p95_active_dbfs: null, p50_active_dbfs: null, peak_dbfs: null }))), 'bad_schema'],
  ['P06 p50 (-10) > p95 (-20) and peak (-30) < p95', () => run(J(winResult({ p50_active_dbfs: -10, peak_dbfs: -30 }))), 'bad_schema'],
  ['P07 segments 0 but onset_ms 300 and active_ms 3000', () => run(J(winResult({ segments: 0 }))), 'bad_schema'],
  ['P08 valid:true with clipped_frames 160 (all frames)', () => run(J(winResult({ clipped_frames: 160 }))), 'bad_schema'],
  ['P09 window.result kind "calibration" with duration_ms 100', () => run(J(winResult({ kind: 'calibration', duration_ms: 100 }))), 'bad_schema'],
  ['P10 precheck valid:true with floor_dbfs null', () => run(J(preResult({ floor_dbfs: null }))), 'bad_schema'],
  ['P11 precheck p20 (-40) > p80 (-70), floor outside [p20,p80]', () => run(J(preResult({ p20_dbfs: -40, p80_dbfs: -70 }))), 'bad_schema'],
  ['P12 precheck valid:true with floor_dbfs 0 (loud) and clipped_frames 100', () => run(J(preResult({ floor_dbfs: 0, clipped_frames: 100 }))), 'bad_schema'],
  ['P13 level frame_index 0 with t_audio_ms 35000', () => run(J(levelMsg({ t_audio_ms: 35000 }))), 'bad_schema'],
  ['P14 level frame_index 5 repeated with new message_id/sequence (replayed frame)', () => run(J(levelMsg({ frame_index: 5, t_audio_ms: 250 }))), 'ok'],
  ['P15 level dbfs 20 (above full scale) active:true clipped:false', () => run(J(levelMsg({ dbfs: 20, active: true }))), 'ok'],
  ['P16 window.result invalid_reason "no_voice" with active_ms 3000', () => run(J(winResult({ valid: false, invalid_reason: 'no_voice' }))), 'bad_schema'],
  ['P17 window.start vad_floor_dbfs 0 (ADR: floor <= -30)', () => run(J(env('window.start', { kind: 'phrase', phrase_position: 1, max_duration_ms: 8000, vad_floor_dbfs: 0 }, { ...ids, sender_role: 'tv' }))), 'bad_schema'],
];
const stateOnly = new Set(['P08', 'P13', 'P14', 'P15', 'P16']);
const stateNote = {
  P08: 'accepted: the TV cannot recompute accepted-active frames, so it cannot check the clipped share of a window the phone calls valid; a phone able to send this can send any self-consistent numbers (residual R11)',
  P13: 'accepted by design: gaps are allowed, so only the lower bound t_audio_ms >= 50*frame_index - 1 is a protocol rule; the TV bounds it by its own window timing',
  P14: 'stateful: the TV ignores a repeated frame_index (tests/security SEC-T07 and session-core tests)',
  P15: 'plausible reading; a level above 0 dBFS is allowed by the range',
  P16: 'accepted: a phone-claimed invalid reason only makes the attempt unscored (fails closed); the TV reports it as claimed',
};
for (const [name, fn] of sem) {
  const id = name.split(' ')[0];
  rec(id, 'cross-field semantics', name.slice(4), stateOnly.has(id) ? 'ok' : 'bad_schema', fn(), stateOnly.has(id) ? { info: true, note: stateNote[id] } : { note: 'PK-02' });
}

// ------------------------------------------------------------------ Q envelope / role binding
rec('Q01', 'direction', 'relay-only type room.created sent with sender_role "phone"', 'ok', run(J(env('room.created', { room_id: 'r_AAAAAAAAAAAAAAAA', pairing_code: 'ACDEFH', code_expires_at: 1, tv_credential: 'A'.repeat(43), credential_expires_at: 1, generation: 1 }, { producer_generation: 0 }))), { info: true, note: 'validator is direction-blind by design; isAllowedSender("room.created","phone")=' + P.isAllowedSender('room.created', 'phone') });
rec('Q02', 'direction', 'client sends sender_role "relay" ping', 'ok', run(J(ping({ sender_role: 'relay', producer_generation: 0 }))), { info: true, note: 'isAllowedSender("ping","relay")=' + P.isAllowedSender('ping', 'relay') });
rec('Q03', 'direction', 'phone sends TV-only window.start', 'ok', run(J(env('window.start', { kind: 'phrase', phrase_position: 1, max_duration_ms: 8000, vad_floor_dbfs: -60 }, ids))), { info: true, note: 'isAllowedSender("window.start","phone")=' + P.isAllowedSender('window.start', 'phone') });
rec('Q04', 'identity', 'ping with session_id set', 'bad_schema', run(J(ping({ session_id: 's_AAAAAAAA' }))));
rec('Q05', 'identity', 'join.request with room_id set', 'bad_schema', run(J(joinReq('ACDEFH')).replace('"room_id":null', '"room_id":"r_AAAAAAAAAAAAAAAA"')));
rec('Q06', 'identity', 'level with null room_id', 'bad_schema', run(J(levelMsg()).replace('"room_id":"r_AAAAAAAAAAAAAAAA"', '"room_id":null')));
rec('Q07', 'identity', 'auth.resume envelope room differs from payload room', 'bad_schema', run(J(env('auth.resume', { room_id: 'r_BBBBBBBBBBBBBBBB', role: 'phone', credential: 'A'.repeat(43) }, { producer_generation: 0 }))));
rec('Q08', 'identity', 'pre-auth type with generation 1', 'bad_schema', run(J(joinReq('ACDEFH')).replace('"producer_generation":0', '"producer_generation":1')));

// ------------------------------------------------------------------ S size boundaries, timing
{
  const base = J(ping());
  const pad = (n) => base + ' '.repeat(n - Buffer.byteLength(base));
  rec('S01', 'size', 'valid ping padded with trailing spaces to exactly 8192 bytes', 'ok', run(pad(8192)));
  rec('S02', 'size', '8193 bytes', 'payload_too_large', run(pad(8193)));
  const emojiBank = phrases(Array(10).fill('\u{1F600}'.repeat(60)));
  rec('S03', 'size', 'largest legal phrase bank: 10 x 60 emoji (600 code points x 4 bytes = 2400 B + envelope)', 'ok', run(J(emojiBank)), { info: true, note: `${Buffer.byteLength(J(emojiBank))} bytes; the 8192-byte cap has about 3x headroom for every schema-legal message` });
  const cjkBank = phrases(Array(10).fill('\u6c49'.repeat(60)));
  rec('S04', 'size', 'legal phrase bank 10 x 60 CJK (3 bytes each = 1800 B)', 'ok', run(J(cjkBank)));
  const t0 = performance.now(); const rBig = run('x'.repeat(10_000_000)); const dt = performance.now() - t0;
  rec('S05', 'size', '10 MB string frame', 'payload_too_large', rBig, { note: `${dt.toFixed(2)} ms` });
  const manyKeys = '{' + Array.from({ length: 800 }, (_, i) => `"k${i}":1`).join(',') + '}';
  const tk = performance.now(); const rK = run(manyKeys); const dk = performance.now() - tk;
  rec('S06', 'size', `object with 800 unknown keys (${manyKeys.length} B, under the cap)`, 'bad_schema', rK, { note: `${dk.toFixed(2)} ms` });
  // worst-case timing over a mixed hostile set
  const hostile = [pad(8192), '['.repeat(8000), raw3900(), manyKeys, J(phrases(Array(10).fill('\u{1F600}'.repeat(60)))), J(ping()).replace('"payload":{}', '"payload":{"a":' + '[1,'.repeat(2000) + '1' + ']'.repeat(2000) + '}')];
  function raw3900() { return J(ping()).replace('"payload":{}', '"payload":' + '['.repeat(3900) + ']'.repeat(3900)); }
  let worst = 0; for (let i = 0; i < 300; i++) for (const h of hostile) { const a = performance.now(); run(h); worst = Math.max(worst, performance.now() - a); }
  rec('S07', 'timing', 'worst single parse over 1800 runs of 6 hostile 8 KB frames', 'fast', worst < 25 ? 'fast' : 'SLOW', { info: true, note: `worst ${worst.toFixed(2)} ms on this host (Node ${process.version}); not a load test` });
}
{
  const t0 = performance.now(); let res;
  try { res = runObj({ ...ping(), payload: { x: new Array(1e8) } }); } catch (e) { res = { ok: false, code: 'THROW', detail: String(e).slice(0, 40) }; }
  const dt = performance.now() - t0;
  rec('S08', 'serialize-then-check', 'validateMessageObject with payload.x = sparse Array(1e8) (programmatic object)', ['bad_schema', 'payload_too_large'], res, { note: `${dt.toFixed(0)} ms (rev 1: about 2300 ms and 2.8 GB RSS); PK-09 snapshot bound`, ...(dt > 200 ? { gap: true } : {}) });
}

// ------------------------------------------------------------------ T failure-detail leakage
{
  const MARK = 'SECRETMARK123';
  const fields = [
    ['type', (o) => ({ ...o, type: MARK })], ['message_id', (o) => ({ ...o, message_id: 'm_' + MARK })], ['room_id', (o) => ({ ...o, room_id: 'r_' + MARK })],
    ['sender_role', (o) => ({ ...o, sender_role: MARK })], ['payload key', (o) => ({ ...o, payload: { [MARK]: 1 } })],
    ['phrase text', () => phrases([MARK + '\u0000'])], ['envelope extra key', (o) => ({ ...o, [MARK]: 1 })], ['cue text', () => cue(MARK + MARK)],
    ['pairing code', () => joinReq(MARK)], ['device_label', () => joinReq('ACDEFH', MARK.repeat(3))],
  ];
  let leaks = 0; const where = [];
  for (const [name, f] of fields) {
    const r = run(J(f(ping())));
    const blob = r.ok ? '' : r.detail + '|' + String(r.ref_message_id);
    if (blob.includes(MARK)) { leaks++; where.push(name); }
  }
  rec('T01', 'information leak', `marker string placed in ${fields.length} different fields; any in detail/ref_message_id?`, 'none', leaks === 0 ? 'none' : `LEAK in ${where.join(',')}`);
  const wf = run(J(ping({ message_id: 'm_AAAAAAAAAAAAAAAA' })).replace('"type":"ping"', '"type":"nope"'));
  rec('T02', 'information leak', 'unknown type: ref_message_id echoes only a well-formed client id', 'm_AAAAAAAAAAAAAAAA', wf.ok ? 'ok' : String(wf.ref_message_id), { info: true });
  const bad = run(J(ping({ message_id: 'not-an-id' })));
  rec('T03', 'information leak', 'malformed message_id is never echoed', 'null', bad.ok ? 'ok' : String(bad.ref_message_id));
}

// ------------------------------------------------------------------ output
const counts = rows.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
const mdEsc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const md = ['| ID | Input class | Input | Expected | Observed | Status |', '|---|---|---|---|---|---|']
  .concat(rows.map((r) => `| ${r.id} | ${r.klass} | ${mdEsc(r.input)} | ${mdEsc(r.expect)} | ${mdEsc(r.observed)}${r.note ? ' (' + mdEsc(r.note) + ')' : ''} | ${r.status} |`))
  .join('\n');
console.log(md);
console.log('\nCOUNTS', JSON.stringify(counts), 'TOTAL', rows.length);
const out = process.argv[2];
if (out) writeFileSync(out, J({ node: process.version, protocol_dist: distPath, counts, rows }, null, 1));
