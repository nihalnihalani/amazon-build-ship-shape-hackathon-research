// Reference sketch of the display-safety rule recommended in PROTOCOL_PACKAGE_REVIEW.md (section 4).
// It is NOT part of @atr/protocol; the contracts owner decides whether to adopt it.
// Rules: no look-behind, no \p{...} property escapes, no u flag, so it also runs on Hermes.
// Patterns are built from strings with doubled backslashes so that this file stays pure ASCII.

// Characters that must not appear in phrases, cues, device labels or app_version:
//   U+2028/2029 line and paragraph separators, U+202A-202E embeddings and overrides, U+2066-2069 isolates,
//   U+2060-2064 invisible operators, U+FEFF, U+FFF9-FFFD, noncharacters, and tag characters U+E0000-E007F.
const FORBIDDEN = new RegExp(
  '[\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069\\u2060-\\u2064\\uFEFF\\uFFF9-\\uFFFF\\uFDD0-\\uFDEF]' +
    '|\\uDB40[\\uDC00-\\uDC7F]' +
    '|[\\uD83F\\uD87F\\uD8BF\\uD8FF\\uD93F\\uD97F\\uD9BF\\uD9FF\\uDA3F\\uDA7F\\uDABF\\uDAFF\\uDB3F\\uDB7F\\uDBBF\\uDBFF][\\uDFFE\\uDFFF]',
);
// A string made only of whitespace and invisible fillers renders as blank.
const INVISIBLE_ONLY = new RegExp(
  '^[\\s\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180E\\u200B-\\u200F\\u2800\\u3164\\uFE00-\\uFE0F\\uFFA0]*$',
);
// More than four consecutive combining marks stack off the line box on a TV.
const COMBINING_RUN = new RegExp(
  '[\\u0300-\\u036F\\u0483-\\u0489\\u0591-\\u05BD\\u0610-\\u061A\\u064B-\\u065F\\u1AB0-\\u1AFF\\u1DC0-\\u1DFF\\u20D0-\\u20FF\\uFE20-\\uFE2F]{5,}',
);

export function displaySafe(s) {
  if (FORBIDDEN.test(s)) return 'forbidden_char';
  if (INVISIBLE_ONLY.test(s)) return 'no_visible_content';
  if (COMBINING_RUN.test(s)) return 'combining_run';
  return 'ok';
}

// ---- self-check (run: node docs/security/probes/text_policy_sketch.mjs) ----
const cp = (...codes) => String.fromCodePoint(...codes);
const cases = [
  ['plain', 'Hello there', 'ok'],
  ['RLO U+202E', 'abc' + cp(0x202e) + 'def', 'forbidden_char'],
  ['LRE U+202A', 'a' + cp(0x202a) + 'b', 'forbidden_char'],
  ['RLI U+2067', 'a' + cp(0x2067) + 'b', 'forbidden_char'],
  ['PDI U+2069', 'a' + cp(0x2069) + 'b', 'forbidden_char'],
  ['LINE SEP U+2028', 'a' + cp(0x2028) + 'b', 'forbidden_char'],
  ['PARA SEP U+2029', 'a' + cp(0x2029) + 'b', 'forbidden_char'],
  ['BOM U+FEFF', 'a' + cp(0xfeff) + 'b', 'forbidden_char'],
  ['WORD JOINER U+2060', 'a' + cp(0x2060) + 'b', 'forbidden_char'],
  ['TAG A U+E0041', 'a' + cp(0xe0041) + 'b', 'forbidden_char'],
  ['noncharacter U+FFFE', 'a' + cp(0xfffe) + 'b', 'forbidden_char'],
  ['noncharacter U+FDD0', 'a' + cp(0xfdd0) + 'b', 'forbidden_char'],
  ['noncharacter U+1FFFE', 'a' + cp(0x1fffe) + 'b', 'forbidden_char'],
  ['3 x ZWSP', cp(0x200b, 0x200b, 0x200b), 'no_visible_content'],
  ['HANGUL FILLER U+3164', cp(0x3164), 'no_visible_content'],
  ['BRAILLE BLANK U+2800', cp(0x2800), 'no_visible_content'],
  ['combining stack x59', 'x' + cp(0x301).repeat(59), 'combining_run'],
  ['LRM allowed', 'abc' + cp(0x200e) + 'def', 'ok'],
  ['RLM allowed', 'abc' + cp(0x200f) + 'def', 'ok'],
  ['ALM allowed', 'abc' + cp(0x61c) + 'def', 'ok'],
  ['Persian with ZWNJ', cp(0x645, 0x6cc, 0x200c, 0x62e, 0x648, 0x627, 0x647, 0x645), 'ok'],
  ['Devanagari with ZWJ', cp(0x915, 0x94d, 0x200d, 0x937), 'ok'],
  ['Arabic', cp(0x645, 0x631, 0x62d, 0x628, 0x627, 0x20, 0x628, 0x627, 0x644, 0x639, 0x627, 0x644, 0x645), 'ok'],
  ['Hebrew', cp(0x5e9, 0x5dc, 0x5d5, 0x5dd, 0x20, 0x5e2, 0x5d5, 0x5dc, 0x5dd), 'ok'],
  ['Hindi', cp(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947), 'ok'],
  ['Thai', cp(0xe2a, 0xe27, 0xe31, 0xe2a, 0xe14, 0xe35), 'ok'],
  ['emoji ZWJ sequence', cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467), 'ok'],
  ['heart + VS16', cp(0x2764, 0xfe0f), 'ok'],
  ['four stacked marks', 'x' + cp(0x301, 0x302, 0x303, 0x304), 'ok'],
  ['soft hyphen inside word', 'co' + cp(0xad) + 'operate', 'ok'],
];
let bad = 0;
for (const [name, text, expected] of cases) {
  const got = displaySafe(text);
  if (got !== expected) {
    bad += 1;
    console.log('MISMATCH', name, 'expected', expected, 'got', got);
  }
}
console.log('text_policy_sketch cases', cases.length, 'mismatches', bad);
process.exitCode = bad === 0 ? 0 : 1;
