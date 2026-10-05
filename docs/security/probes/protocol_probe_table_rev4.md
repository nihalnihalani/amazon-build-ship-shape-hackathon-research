| ID | Input class | Input | Expected | Observed | Status |
|---|---|---|---|---|---|
| A01 | control | valid ping | ok | ok(ping) | PASS |
| A02 | control | valid phrases.update (1 phrase) | ok | ok(phrases.update) | PASS |
| A03 | control | valid cue | ok | ok(cue) | PASS |
| A04 | control | valid join.request | ok | ok(join.request) | PASS |
| A05 | control | valid window.result | ok | ok(window.result) | PASS |
| A06 | control | valid precheck.result | ok | ok(precheck.result) | PASS |
| A07 | control | valid level | ok | ok(level) | PASS |
| B01 | prototype pollution | 13th envelope key "__proto__":{"polluted":"yes"} (raw JSON) | bad_schema | bad_schema: envelope has an unknown field | PASS |
| B02 | prototype pollution | ping payload {"__proto__":{"polluted":1}} | bad_schema | bad_schema: payload: unknown field | PASS |
| B03 | prototype pollution | cue payload with "constructor":{"prototype":{"x":1}} | bad_schema | bad_schema: payload: unknown field | PASS |
| B04 | prototype pollution | "message_id" renamed to "__proto__" (still 12 keys) | bad_schema | bad_schema: envelope has an unknown field | PASS |
| B05 | prototype pollution | phrases element is object {"__proto__":{}} | bad_schema | bad_schema: payload.phrases[0]: expected string | PASS |
| B06 | prototype pollution | validateMessageObject(Object.create({polluted:1}) with envelope fields) | bad_schema | bad_schema: message is not plain data | PASS |
| B07 | prototype pollution | validateMessageObject(JSON.parse(B01)) with own "__proto__" key | bad_schema | bad_schema: envelope has an unknown field | PASS |
| B08 | prototype pollution | global state after B01-B07: ({}).polluted, ({}).x, Object.prototype own keys | clean | clean | PASS |
| C01 | duplicate keys | "type" appears twice ("ping" then "unpair") | ok | ok(unpair) (validator: last wins (type=unpair); the relay forwards the canonical re-serialization (PK-04), verified end to end in tests/security (SEC-V03)) | INFO |
| C02 | duplicate keys | "message_id" twice (B..., then A...) | ok | ok(ping) (clean copy carries m_AAAAAAAAAAAAAAAA; raw frame still contains both ids) | INFO |
| C03 | duplicate keys | cue payload "text" twice | ok | ok(cue) (kept: Volume) | INFO |
| C04 | duplicate keys | "payload" twice (first invalid, last valid) | ok | ok(ping) (first payload is never validated; only the last survives parsing) | INFO |
| D01 | deep nesting | ping payload nested 9 objects deep (raw) | bad_schema | bad_schema: payload nested too deeply | PASS |
| D02 | deep nesting | payload = 3900 nested arrays (8040 bytes raw, under the cap) | bad_schema | bad_schema: message nested too deeply | PASS |
| D03 | deep nesting | 8190 x "[" raw frame (parser stress) | bad_schema | bad_schema: invalid JSON | PASS |
| D04 | deep nesting | validateMessageObject, payload 200000 levels deep (programmatic) | bad_schema\|payload_too_large | bad_schema: message nested too deeply (no crash; 0.1 ms) | PASS |
| D05 | deep nesting | validateMessageObject, circular payload | bad_schema | bad_schema: message nested too deeply | PASS |
| D06 | deep nesting | validateMessageObject, BigInt in payload | bad_schema | bad_schema: payload: unknown field | PASS |
| D07 | deep nesting | validateMessageObject, non-enumerable toJSON that hides content from the size check | bad_schema | bad_schema: message is not plain data | PASS |
| D08 | TOCTOU | stateful Proxy whose 4th read of "payload" (the clone step) returns {injected:"unvalidated"} | no_leak | no_leak (ok(ping); reads=0) (PK-01: rev 4 snapshots the input once and validates and returns the snapshot) | PASS |
| E01 | huge numbers | sequence 1e999 (raw, parses to Infinity) | bad_schema | bad_schema: sequence: out of range | PASS |
| E02 | huge numbers | sequence -1e999 | bad_schema | bad_schema: sequence: out of range | PASS |
| E03 | huge numbers | sequence 9007199254740993 (rounds to 2^53) | bad_schema | bad_schema: sequence: out of range | PASS |
| E04 | huge numbers | sequence 9007199254740991 (MAX_SAFE_INTEGER) | ok | ok(ping) (legal; a producer that sends it exhausts its own sequence space until it resumes with a new generation) | INFO |
| E05 | negative zero | sequence -0 (raw): clean copy must not contain -0 | normalised | normalised (PK-05) | PASS |
| E06 | negative zero | level.dbfs -0: clean copy must not contain -0 | normalised | normalised (PK-05) | PASS |
| E07 | huge numbers | producer_generation 2147483648 (2^31) | bad_schema | bad_schema: producer_generation: out of range | PASS |
| E08 | huge numbers | producer_generation 2147483647 | ok | ok(ping) | PASS |
| E09 | huge numbers | level.dbfs 1e308 | bad_schema | bad_schema: payload.dbfs: out of range | PASS |
| E10 | numbers | sequence as string "5" | bad_schema | bad_schema: sequence: out of range | PASS |
| E11 | numbers | sequence 1.5 | bad_schema | bad_schema: sequence: out of range | PASS |
| E12 | numbers | sequence 1e2 and 100.0 (non-canonical integer spellings) | ok | ok(ping) (accepted; spelling is not preserved by JSON.parse, so no differential) | INFO |
| E13 | numbers | NaN literal in raw JSON | bad_schema | bad_schema: invalid JSON | PASS |
| E14 | numbers | Infinity literal in raw JSON | bad_schema | bad_schema: invalid JSON | PASS |
| E15 | numbers | level.frame_index 701 | bad_schema | bad_schema: payload.frame_index: out of range | PASS |
| E16 | numbers | level.dbfs = -23.123456789012345 (15 digits) | bad_schema | bad_schema: payload.dbfs: not a multiple of 0.1 (PK-06: dB fields are multiples of 0.1) | PASS |
| E16b | numbers | level.dbfs = -23.1 (one decimal) | ok | ok(level) | PASS |
| E16c | numbers | level.dbfs = -23.15 (two decimals) | bad_schema | bad_schema: payload.dbfs: not a multiple of 0.1 | PASS |
| E16d | numbers | window.result.coverage = 0.9996 (not a multiple of 0.001) | bad_schema | bad_schema: payload.coverage: not a multiple of 0.001 | PASS |
| E16e | numbers | level.t_audio_ms = 1000.5 (not an integer) | bad_schema | bad_schema: payload.t_audio_ms: expected integer | PASS |
| E17 | numbers | window.result.coverage 1.0000001 | bad_schema | bad_schema: payload.coverage: out of range | PASS |
| F-U+0000 | escaped control char | phrase "aU+0000b" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-U+001F | escaped control char | phrase "aU+001Fb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-U+007F | escaped control char | phrase "aU+007Fb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-U+0080 | escaped control char | phrase "aU+0080b" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-U+0085 NEL | escaped control char | phrase "aU+0085 NELb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-U+009F | escaped control char | phrase "aU+009Fb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-TAB | escaped control char | phrase "aTABb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-LF | escaped control char | phrase "aLFb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-CR | escaped control char | phrase "aCRb" via JSON escape | bad_schema | bad_schema: payload.phrases[0]: control characters | PASS |
| F-U+2028 LINE SEP | format/invisible char | phrase "aU+2028 LINE SEPb" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| F-U+2029 PARA SEP | format/invisible char | phrase "aU+2029 PARA SEPb" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| F-U+200B ZWSP | format/invisible char | phrase "aU+200B ZWSPb" | ok | ok(phrases.update) (allowed by design (ZWNJ and ZWJ are needed for Persian, Urdu, Devanagari and emoji sequences)) | INFO |
| F-U+200C ZWNJ | format/invisible char | phrase "aU+200C ZWNJb" | ok | ok(phrases.update) (allowed by design (ZWNJ and ZWJ are needed for Persian, Urdu, Devanagari and emoji sequences)) | INFO |
| F-U+200D ZWJ | format/invisible char | phrase "aU+200D ZWJb" | ok | ok(phrases.update) (allowed by design (ZWNJ and ZWJ are needed for Persian, Urdu, Devanagari and emoji sequences)) | INFO |
| F-U+2060 WORD JOINER | format/invisible char | phrase "aU+2060 WORD JOINERb" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| F-U+FEFF BOM mid-string | format/invisible char | phrase "aU+FEFF BOM mid-stringb" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| F-U+00AD SOFT HYPHEN | format/invisible char | phrase "aU+00AD SOFT HYPHENb" | ok | ok(phrases.update) (allowed by design (ZWNJ and ZWJ are needed for Persian, Urdu, Devanagari and emoji sequences)) | INFO |
| F-U+FFFE noncharacter | format/invisible char | phrase "aU+FFFE noncharacterb" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| F-U+FFF9 interlinear | format/invisible char | phrase "aU+FFF9 interlinearb" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| F-U+E000 private use | format/invisible char | phrase "aU+E000 private useb" | ok | ok(phrases.update) (allowed by design (ZWNJ and ZWJ are needed for Persian, Urdu, Devanagari and emoji sequences)) | INFO |
| F-U+E0041 TAG LATIN A (surrogate pair) | format/invisible char | phrase "aU+E0041 TAG LATIN A (surrogate pair)b" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| F-3 x U+200B only | visually empty phrase | phrase = 3 x U+200B only | bad_schema | bad_schema: payload.phrases[0]: no visible content (PK-03) | PASS |
| F-U+3164 HANGUL FILLER | visually empty phrase | phrase = U+3164 HANGUL FILLER | bad_schema | bad_schema: payload.phrases[0]: no visible content (PK-03) | PASS |
| F-U+2800 BRAILLE BLANK | visually empty phrase | phrase = U+2800 BRAILLE BLANK | bad_schema | bad_schema: payload.phrases[0]: no visible content (PK-03) | PASS |
| F-leading-space | trim | phrase " Hello" | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| F-trailing-nbsp | trim | phrase "Hello\u00a0" | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| F-trailing-2028 | trim | phrase "Hello\u2028" (edge) | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| F-whitespace-only | trim | phrase "   " | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| F-empty | length | phrase "" | bad_schema | bad_schema: payload.phrases[0]: too short | PASS |
| F-1char | length | phrase "I" (1 code point) | ok | ok(phrases.update) (see ADR-0001 finding: a 1-syllable phrase cannot reach active_ms >= 400) | INFO |
| F-60ascii | length | phrase 60 x "a" | ok | ok(phrases.update) | PASS |
| F-61ascii | length | phrase 61 x "a" | bad_schema | bad_schema: payload.phrases[0]: too long | PASS |
| F-60emoji | length | phrase 60 x U+1F600 (120 UTF-16 units, 240 bytes) | ok | ok(phrases.update) | PASS |
| F-61emoji | length | phrase 61 x U+1F600 | bad_schema | bad_schema: payload.phrases[0]: too long | PASS |
| F-zwj-family | length | 9 x family emoji (7 code points each = 63) | bad_schema | bad_schema: payload.phrases[0]: too long (length is code points, not grapheme clusters: 9 visible glyphs are rejected) | INFO |
| F-combining-stack | combining marks | "x" + 59 x U+0301 (NFC-stable, 60 code points) | bad_schema | bad_schema: payload.phrases[0]: too many combining marks (PK-03) | PASS |
| F-combining-4 | combining marks | "x" + 4 combining marks | ok | ok(phrases.update) | PASS |
| F-device-label-24emoji | length | device_label 24 emoji (96 bytes) | ok | ok(join.request) | PASS |
| F-device-label-25 | length | device_label 25 chars | bad_schema | bad_schema: payload.device_label: too long | PASS |
| G-lone high U+D800 | surrogate | phrase lone high U+D800 | bad_schema | bad_schema: payload.phrases[0]: invalid text | PASS |
| G-lone low U+DC00 | surrogate | phrase lone low U+DC00 | bad_schema | bad_schema: payload.phrases[0]: invalid text | PASS |
| G-high at end | surrogate | phrase high at end | bad_schema | bad_schema: payload.phrases[0]: invalid text | PASS |
| G-high before ASCII | surrogate | phrase high before ASCII | bad_schema | bad_schema: payload.phrases[0]: invalid text | PASS |
| G-reversed pair low,high | surrogate | phrase reversed pair low,high | bad_schema | bad_schema: payload.phrases[0]: invalid text | PASS |
| G-valid pair U+1F600 | surrogate | phrase valid pair U+1F600 | ok | ok(phrases.update) | PASS |
| G-key | surrogate | payload key "\ud800" (lone surrogate as key name) | bad_schema | bad_schema: payload: unknown field | PASS |
| G-pairing-code | surrogate | pairing_code containing lone high surrogate | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| G-app-version | surrogate | room.create app_version lone surrogate | bad_schema | bad_schema: payload.client.app_version: invalid text | PASS |
| G-utf8-len | surrogate | utf8ByteLength vs TextEncoder over 20000 random strings with lone/paired surrogates | match | match | PASS |
| H-valid | pairing code | join.request pairing_code "ACDEFH" | ok | ok(join.request) | PASS |
| H-lowercase | pairing code | join.request pairing_code "acdefh" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-Cyrillic A U+0410 | pairing code | join.request pairing_code "<U+0410>CDEFH" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-Greek Alpha U+0391 | pairing code | join.request pairing_code "<U+0391>CDEFH" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-fullwidth A U+FF21 | pairing code | join.request pairing_code "<U+FF21>CDEFH" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-Latin O (not in alphabet) | pairing code | join.request pairing_code "ACDEFO" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-digit zero | pairing code | join.request pairing_code "ACDEF0" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-digit one | pairing code | join.request pairing_code "ACDEF1" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-letter I | pairing code | join.request pairing_code "ACDEFI" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-letter L | pairing code | join.request pairing_code "ACDEFL" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-digit 5 | pairing code | join.request pairing_code "ACDEF5" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-letter S | pairing code | join.request pairing_code "ACDEFS" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-digit 8 | pairing code | join.request pairing_code "ACDEF8" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-letter B | pairing code | join.request pairing_code "ACDEFB" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-trailing newline | pairing code | join.request pairing_code "ACDEFH\n" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-5 chars | pairing code | join.request pairing_code "ACDEF" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-7 chars | pairing code | join.request pairing_code "ACDEFHJ" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-zero-width inside | pairing code | join.request pairing_code "AC<U+200B>DEFH" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-leading space | pairing code | join.request pairing_code " ACDEF" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-NUL | pairing code | join.request pairing_code "ACDEF\u0000" | bad_schema | bad_schema: payload.pairing_code: bad format | PASS |
| H-alphabet | pairing code | alphabet "ACDEFHJKMNPRTUVWXY3479": 22 distinct symbols; 22^6 = 113379904 | 22 | 22 (residual look-alike pairs at 3 m for human review: U/V, M/N, E/F, 7/T, 4/A) | INFO |
| I01 | BOM | leading U+FEFF before a valid frame | bad_schema | bad_schema: invalid JSON | PASS |
| I02 | BOM | trailing U+FEFF after a valid frame | bad_schema | bad_schema: invalid JSON | PASS |
| I03 | BOM | UTF-8 BOM bytes EF BB BF + JSON as a Buffer (binary) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-null | non-object JSON | raw "null" | bad_schema | bad_schema: message is not an object | PASS |
| J-empty array | non-object JSON | raw "[]" | bad_schema | bad_schema: message is not an object | PASS |
| J-number | non-object JSON | raw "1" | bad_schema | bad_schema: message is not an object | PASS |
| J-string | non-object JSON | raw "\"x\"" | bad_schema | bad_schema: message is not an object | PASS |
| J-true | non-object JSON | raw "true" | bad_schema | bad_schema: message is not an object | PASS |
| J-empty object | non-object JSON | raw "{}" | bad_schema | bad_schema: envelope is missing a field | PASS |
| J-batch [valid message] | non-object JSON | raw "[{\"protocol_version\":1,\"type\":\"ping\",..." | bad_schema | bad_schema: message is not an object | PASS |
| J-empty string | non-object JSON | raw "" | bad_schema | bad_schema: invalid JSON | PASS |
| J-whitespace only | non-object JSON | raw "   " | bad_schema | bad_schema: invalid JSON | PASS |
| J-valid + trailing garbage | non-object JSON | raw "{\"protocol_version\":1,\"type\":\"ping\",\"..." | bad_schema | bad_schema: invalid JSON | PASS |
| J-trailing comma | non-object JSON | raw "{\"a\":1,}" | bad_schema | bad_schema: invalid JSON | PASS |
| J-comment | non-object JSON | raw "/*c*/{}" | bad_schema | bad_schema: invalid JSON | PASS |
| J-single quotes | non-object JSON | raw "{'a':1}" | bad_schema | bad_schema: invalid JSON | PASS |
| J-input-Buffer | non-string input | parseWireMessage(Buffer) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-Uint8Array | non-string input | parseWireMessage(Uint8Array) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-ArrayBuffer | non-string input | parseWireMessage(ArrayBuffer) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-Blob | non-string input | parseWireMessage(Blob) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-number | non-string input | parseWireMessage(number) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-undefined | non-string input | parseWireMessage(undefined) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-null | non-string input | parseWireMessage(null) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| J-input-parsed object | non-string input | parseWireMessage(parsed object) | binary_rejected | binary_rejected: only text frames are accepted | PASS |
| K01 | message_id | record then has: same id is a duplicate | true | true | PASS |
| K02 | message_id | after 1024 further distinct ids the first id is evicted | false | false (after eviction only the sequence check stops a replay; at 40 msgs/s the window is ~26 s) | INFO |
| K03 | message_id | id recorded for role "phone" is NOT a duplicate for role "tv" (PK-08 scoping) | false | false | PASS |
| K03b | message_id | has() does not record: a message dropped later can be retransmitted with the same id | false | false | PASS |
| K04 | message_id | ids differing only in case are distinct | false | false | PASS |
| K05 | message_id | length 16 and 32 accepted, 15 and 33 rejected | ok,ok,bad_schema,bad_schema | ok,ok,bad_schema,bad_schema (format allows low-entropy chosen ids (e.g. 16 x "A"); uniqueness is not enforced by the validator) | PASS |
| K06 | sequence | SequenceTracker.accept(expected=1, generation=2147483647, sequence=0): a jump is stale | stale | stale (PK-07; afterwards the legitimate generation-1 sequence 6 is ok) | PASS |
| K07 | sequence | tracker: same sequence twice | replay | replay | PASS |
| K08 | sequence | old two-argument call form throws instead of silently rejecting | TypeError | TypeError | PASS |
| K09 | sequence | expectedGeneration must not decrease | RangeError | RangeError | PASS |
| L-now | timestamp | event_timestamp now (receiver now fixed) | ok | ok(ping) | PASS |
| L-now+24h | timestamp | event_timestamp now+24h (receiver now fixed) | ok | ok(ping) | PASS |
| L-now+24h+1ms | timestamp | event_timestamp now+24h+1ms (receiver now fixed) | bad_schema | bad_schema: event_timestamp: outside allowed skew | PASS |
| L-now-24h | timestamp | event_timestamp now-24h (receiver now fixed) | ok | ok(ping) | PASS |
| L-now-24h-1ms | timestamp | event_timestamp now-24h-1ms (receiver now fixed) | bad_schema | bad_schema: event_timestamp: outside allowed skew | PASS |
| L-0 | timestamp | event_timestamp 0 (receiver now fixed) | bad_schema | bad_schema: event_timestamp: outside allowed skew | PASS |
| L--1 | timestamp | event_timestamp -1 (receiver now fixed) | bad_schema | bad_schema: event_timestamp: expected integer | PASS |
| L-1.5 | timestamp | event_timestamp 1.5 (receiver now fixed) | bad_schema | bad_schema: event_timestamp: expected integer | PASS |
| L-MAX_SAFE_INTEGER | timestamp | event_timestamp MAX_SAFE_INTEGER (receiver now fixed) | bad_schema | bad_schema: event_timestamp: outside allowed skew | PASS |
| L-now-NaN | timestamp | opts.now = NaN (caller bug) with ts = real Date.now() | ok | ok(ping) (falls back to Date.now(); relay must never take opts.now from the peer) | INFO |
| L-maxBytes-raise | size | opts.maxBytes = 1e9 (attempt to raise the cap) | ok | ok(ping) (cap is min(opts.maxBytes, 8192)) | INFO |
| M-NFD e+U+0301 | normalization | phrase NFD e+U+0301 | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| M-NFC precomposed | normalization | phrase NFC precomposed | ok | ok(phrases.update) | PASS |
| M-Angstrom sign U+212B | normalization | phrase Angstrom sign U+212B | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| M-Kelvin sign U+212A | normalization | phrase Kelvin sign U+212A | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| M-Hangul decomposed jamo | normalization | phrase Hangul decomposed jamo | bad_schema | bad_schema: payload.phrases[0]: text not normalized | PASS |
| M-ligature U+FB01 (NFKC differs) | normalization | phrase ligature U+FB01 (NFKC differs) | ok | ok(phrases.update) (literal text preserved; NFKC would corrupt user text and is not recommended for phrases) | INFO |
| M-fullwidth A (NFKC differs) | normalization | phrase fullwidth A (NFKC differs) | ok | ok(phrases.update) (literal text preserved; NFKC would corrupt user text and is not recommended for phrases) | INFO |
| M-circled digit (NFKC differs) | normalization | phrase circled digit (NFKC differs) | ok | ok(phrases.update) (literal text preserved; NFKC would corrupt user text and is not recommended for phrases) | INFO |
| M-Devanagari with ZWJ (legit) | normalization | phrase Devanagari with ZWJ (legit) | ok | ok(phrases.update) | PASS |
| M-normalize-available | normalization | String.prototype.normalize present in this runtime | true | true (on Hermes/Vega this is unverified; if absent, normalizeUserText is the identity and non-NFC text would pass the TV-side check (relay still enforces on Node)) | INFO |
| N-phrase-U+202A LRE | bidi control | phrase "abcU+202A LREdef" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| N-phrase-U+202B RLE | bidi control | phrase "abcU+202B RLEdef" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| N-phrase-U+202C PDF | bidi control | phrase "abcU+202C PDFdef" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| N-phrase-U+202D LRO | bidi control | phrase "abcU+202D LROdef" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| N-phrase-U+202E RLO | bidi control | phrase "abcU+202E RLOdef" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| N-phrase-U+2066 LRI | bidi control | phrase "abcU+2066 LRIdef" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| N-phrase-U+2067 RLI | bidi control | phrase "abcU+2067 RLIdef" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| N-phrase-U+2068 FSI | bidi control | phrase "abcU+2068 FSIdef" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| N-phrase-U+2069 PDI | bidi control | phrase "abcU+2069 PDIdef" | bad_schema | bad_schema: payload.phrases[0]: forbidden character (PK-03) | PASS |
| N-phrase-U+200E LRM | bidi control | phrase "abcU+200E LRMdef" | ok | ok(phrases.update) (implicit marks are legitimate in mixed-direction text; kept allowed) | INFO |
| N-phrase-U+200F RLM | bidi control | phrase "abcU+200F RLMdef" | ok | ok(phrases.update) (implicit marks are legitimate in mixed-direction text; kept allowed) | INFO |
| N-phrase-U+061C ALM | bidi control | phrase "abcU+061C ALMdef" | ok | ok(phrases.update) (implicit marks are legitimate in mixed-direction text; kept allowed) | INFO |
| N-label-RLO | bidi control | device_label "Mom\u202es phone" (shown on the TV at pairing) | bad_schema | bad_schema: payload.device_label: forbidden character (PK-03) | PASS |
| N-cue-RLO | bidi control | cue "Vol\u202eume" | bad_schema | bad_schema: payload.text: forbidden character (PK-03) | PASS |
| N-appver-RLO | bidi control | room.create app_version "1.0\u202e" | bad_schema | bad_schema: payload.client.app_version: forbidden character (PK-03) | PASS |
| O01 | audio guard | cue payload extra key "Data" | audio_rejected | audio_rejected: payload contains an audio-like field | PASS |
| O02 | audio guard | key spelled "d\u0061ta" (escaped) | audio_rejected | audio_rejected: payload contains an audio-like field | PASS |
| O03 | audio guard | cue.text of 257 code points | audio_rejected | audio_rejected: payload contains an oversized string | PASS |
| O04 | audio guard | cue.text of 256 code points (schema says max 12) | bad_schema | bad_schema: payload.text: too long | PASS |
| O05 | audio guard | phrases array of 17 items | audio_rejected | audio_rejected: payload contains an oversized array | PASS |
| O06 | audio guard | phrases array of 11 items (schema max 10, guard max 16) | bad_schema | bad_schema: payload.phrases: too many items | PASS |
| O-Float32Array | audio guard | validateMessageObject, payload.x = Float32Array | audio_rejected\|bad_schema | audio_rejected: payload contains binary data | PASS |
| O-Uint8Array | audio guard | validateMessageObject, payload.x = Uint8Array | audio_rejected\|bad_schema | audio_rejected: payload contains binary data | PASS |
| O-ArrayBuffer | audio guard | validateMessageObject, payload.x = ArrayBuffer | audio_rejected\|bad_schema | audio_rejected: payload contains binary data | PASS |
| O-Buffer | audio guard | validateMessageObject, payload.x = Buffer | audio_rejected\|bad_schema | audio_rejected: payload contains binary data | PASS |
| O-Blob | audio guard | validateMessageObject, payload.x = Blob | audio_rejected\|bad_schema | audio_rejected: payload contains binary data | PASS |
| O-covert-capacity | audio guard | level.dbfs after PK-06 quantisation: multiples of 0.1 over -140..20 = 1601 values at 20 frames/s | n/a | 212 bit/s per dB field (was 1040 bit/s with a free 52-bit mantissa) (residual R4: below low-rate speech codecs (0.7-2.4 kbit/s) per field but not zero; enforced by review, CSP connect-src and network inspection) | INFO |
| P01 | cross-field semantics | valid:true with coverage 0.01 | bad_schema | bad_schema: payload.coverage: does not match frame counts (PK-02) | PASS |
| P02 | cross-field semantics | frame_count 700 > expected_frames 160 | bad_schema | bad_schema: payload.frame_count: exceeds expected_frames (PK-02) | PASS |
| P03 | cross-field semantics | active_ms 35000 > duration_ms 8000 | bad_schema | bad_schema: payload.active_ms: inconsistent durations (PK-02) | PASS |
| P04 | cross-field semantics | longest_active_ms 8000 > active_ms 3000 | bad_schema | bad_schema: payload.active_ms: inconsistent durations (PK-02) | PASS |
| P05 | cross-field semantics | valid:true but p95_active/p50/peak all null | bad_schema | bad_schema: payload: statistics required when valid (PK-02) | PASS |
| P06 | cross-field semantics | p50 (-10) > p95 (-20) and peak (-30) < p95 | bad_schema | bad_schema: payload: statistics out of order (PK-02) | PASS |
| P07 | cross-field semantics | segments 0 but onset_ms 300 and active_ms 3000 | bad_schema | bad_schema: payload.segments: inconsistent with active_ms and onset_ms (PK-02) | PASS |
| P08 | cross-field semantics | valid:true with clipped_frames 160 (all frames) | ok | ok(window.result) (accepted: the TV cannot recompute accepted-active frames, so it cannot check the clipped share of a window the phone calls valid; a phone able to send this can send any self-consistent numbers (residual R11)) | INFO |
| P09 | cross-field semantics | window.result kind "calibration" with duration_ms 100 | bad_schema | bad_schema: payload.expected_frames: does not match duration_ms (PK-02) | PASS |
| P10 | cross-field semantics | precheck valid:true with floor_dbfs null | bad_schema | bad_schema: payload.floor_dbfs: required when valid (PK-02) | PASS |
| P11 | cross-field semantics | precheck p20 (-40) > p80 (-70), floor outside [p20,p80] | bad_schema | bad_schema: payload: percentiles out of order (PK-02) | PASS |
| P12 | cross-field semantics | precheck valid:true with floor_dbfs 0 (loud) and clipped_frames 100 | bad_schema | bad_schema: payload: percentiles out of order (PK-02) | PASS |
| P13 | cross-field semantics | level frame_index 0 with t_audio_ms 35000 | ok | ok(level) (accepted by design: gaps are allowed, so only the lower bound t_audio_ms >= 50*frame_index - 1 is a protocol rule; the TV bounds it by its own window timing) | INFO |
| P14 | cross-field semantics | level frame_index 5 repeated with new message_id/sequence (replayed frame) | ok | ok(level) (stateful: the TV ignores a repeated frame_index (tests/security SEC-T07 and session-core tests)) | INFO |
| P15 | cross-field semantics | level dbfs 20 (above full scale) active:true clipped:false | ok | ok(level) (plausible reading; a level above 0 dBFS is allowed by the range) | INFO |
| P16 | cross-field semantics | window.result invalid_reason "no_voice" with active_ms 3000 | ok | ok(window.result) (accepted: a phone-claimed invalid reason only makes the attempt unscored (fails closed); the TV reports it as claimed) | INFO |
| P17 | cross-field semantics | window.start vad_floor_dbfs 0 (ADR: floor <= -30) | bad_schema | bad_schema: payload.vad_floor_dbfs: out of range (PK-02) | PASS |
| Q01 | direction | relay-only type room.created sent with sender_role "phone" | ok | ok(room.created) (validator is direction-blind by design; isAllowedSender("room.created","phone")=false) | INFO |
| Q02 | direction | client sends sender_role "relay" ping | ok | ok(ping) (isAllowedSender("ping","relay")=false) | INFO |
| Q03 | direction | phone sends TV-only window.start | ok | ok(window.start) (isAllowedSender("window.start","phone")=false) | INFO |
| Q04 | identity | ping with session_id set | bad_schema | bad_schema: session_id: must be null | PASS |
| Q05 | identity | join.request with room_id set | bad_schema | bad_schema: room_id: must be null | PASS |
| Q06 | identity | level with null room_id | bad_schema | bad_schema: room_id: required | PASS |
| Q07 | identity | auth.resume envelope room differs from payload room | bad_schema | bad_schema: room_id: differs from payload | PASS |
| Q08 | identity | pre-auth type with generation 1 | bad_schema | bad_schema: producer_generation: must be 0 | PASS |
| S01 | size | valid ping padded with trailing spaces to exactly 8192 bytes | ok | ok(ping) | PASS |
| S02 | size | 8193 bytes | payload_too_large | payload_too_large: message exceeds the size limit | PASS |
| S03 | size | largest legal phrase bank: 10 x 60 emoji (600 code points x 4 bytes = 2400 B + envelope) | ok | ok(phrases.update) (2709 bytes; the 8192-byte cap has about 3x headroom for every schema-legal message) | INFO |
| S04 | size | legal phrase bank 10 x 60 CJK (3 bytes each = 1800 B) | ok | ok(phrases.update) | PASS |
| S05 | size | 10 MB string frame | payload_too_large | payload_too_large: message exceeds the size limit (0.00 ms) | PASS |
| S06 | size | object with 800 unknown keys (7091 B, under the cap) | bad_schema | bad_schema: envelope has an unknown field (1.22 ms) | PASS |
| S07 | timing | worst single parse over 1800 runs of 6 hostile 8 KB frames | fast | fast (worst 0.57 ms on this host (Node v25.2.1); not a load test) | INFO |
| S08 | serialize-then-check | validateMessageObject with payload.x = sparse Array(1e8) (programmatic object) | bad_schema\|payload_too_large | payload_too_large: message exceeds the size limit (0 ms (rev 1: about 2300 ms and 2.8 GB RSS); PK-09 snapshot bound) | PASS |
| T01 | information leak | marker string placed in 10 different fields; any in detail/ref_message_id? | none | none | PASS |
| T02 | information leak | unknown type: ref_message_id echoes only a well-formed client id | m_AAAAAAAAAAAAAAAA | m_AAAAAAAAAAAAAAAA | INFO |
| T03 | information leak | malformed message_id is never echoed | null | null | PASS |

COUNTS {"PASS":200,"INFO":36} TOTAL 236
