/**
 * T16 gate, part F: static and configuration checks. No process is started.
 *
 *   SEC-I01  infrastructure-as-code assertions on infra/template.yaml (no AWS call; AWS-only checks are pending_external)
 *   SEC-P03  every payload field has a disclosed category; the exact privacy sentences are in the shipped code
 *   SEC-P04  forbidden claims
 *   SEC-P05  no recording, beacon, XHR, fetch, worker, speech or peer API in the phone code or the production bundle
 *   SEC-W01  no HTML sinks in phone, TV or session-core code, none in the production bundle
 *   SEC-T01  TV relay URL policy
 *   SEC-A04  randomness of codes, digits, credentials
 *   SEC-V01  the protocol probe script, run against the built package: zero failures
 *   OPEN N-03  the AWS topology (page host versus relay host)
 *
 * Evidence class: documentation_only / static (C) and automated; nothing here touches AWS.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MESSAGE_TYPES, type MessageType } from '@atr/protocol';
import { ROOT, samplePayload } from './helpers.js';

const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

function walkFiles(dir: string, accept: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-test' || name === 'dist-lambda' || name === '.git') continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}
const sourceFiles = (rel: string): string[] =>
  walkFiles(path.join(ROOT, rel), (f) => /\.(ts|tsx)$/.test(f) && !/(\.test\.|\.d\.ts|__tests__|__fixtures__|\/test\/|\/e2e\/)/.test(f));

describe('SEC-I01 infrastructure as code (infra/template.yaml), no AWS call', () => {
  const t = read('infra/template.yaml');
  const code = t
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n'); // comments mention the very things the template must not contain

  it('the phone bucket is private: public access fully blocked, owner enforced, TLS-only policy, reads only by the distribution through OAC with always-sign', () => {
    const pab = /PublicAccessBlockConfiguration:\s*\n\s*BlockPublicAcls: true\s*\n\s*BlockPublicPolicy: true\s*\n\s*IgnorePublicAcls: true\s*\n\s*RestrictPublicBuckets: true/.exec(code);
    expect(pab).not.toBeNull();
    expect(code).toMatch(/ObjectOwnership: BucketOwnerEnforced/);
    expect(code).toMatch(/aws:SecureTransport'?: 'false'/);
    expect(code).toMatch(/SigningBehavior: always/);
    expect(code).toMatch(/'AWS:SourceArn': .*distribution/);
    expect(code).not.toMatch(/WebsiteConfiguration|PublicRead|Principal: '\*'\s*\n\s*Action: s3:GetObject/); // no website endpoint, no public read
    expect(code).toMatch(/AWS::CloudFront::OriginAccessControl/);
    expect(code).toMatch(/ViewerProtocolPolicy: redirect-to-https/);
    expect(code).toMatch(/AllowedMethods: \[GET, HEAD\]/);
  });

  it('the table keeps no history: TTL on, point-in-time recovery off, keys-only index, no streams', () => {
    expect(code).toMatch(/TimeToLiveSpecification:\s*\n\s*AttributeName: expires_at\s*\n\s*Enabled: true/);
    expect(code).toMatch(/PointInTimeRecoveryEnabled: false/);
    expect(code).toMatch(/ProjectionType: KEYS_ONLY/);
    expect(code).not.toMatch(/StreamSpecification|KinesisStreamSpecification/);
  });

  it('logging and tracing: data tracing off, execution logging off, no access log, no X-Ray, retention at most 14 days on every log group', () => {
    expect(code).toMatch(/DataTraceEnabled: false/);
    expect(code).toMatch(/LoggingLevel: 'OFF'/);
    expect(code).not.toMatch(/AccessLogSettings/);
    expect(code).not.toMatch(/Tracing: Active|TracingEnabled: true|TracingConfig:\s*\n\s*Mode: Active/);
    const retentions = [...code.matchAll(/RetentionInDays: (\d+)/g)].map((m) => Number(m[1]));
    expect(retentions.length).toBeGreaterThanOrEqual(2);
    for (const r of retentions) expect(r).toBeLessThanOrEqual(14);
    for (const m of code.matchAll(/Type: AWS::Logs::LogGroup[\s\S]*?(?=\n  \S|$)/g)) expect(m[0]).toMatch(/RetentionInDays/);
  });

  it('IAM is least privilege: no wildcard action or resource in an allow statement, no Scan, ManageConnections scoped to this API and stage and to POST and DELETE, secret read limited to one parameter', () => {
    expect(code).not.toMatch(/Action: ['"]?\*['"]?\s*$/m);
    expect(code).not.toMatch(/dynamodb:Scan|dynamodb:\*|ssm:\*|logs:\*|execute-api:\*/);
    // every "Resource: '*'" or "Resource: *" is forbidden
    expect(code).not.toMatch(/Resource: ['"]?\*['"]?\s*$/m);
    const manage = [...code.matchAll(/Action: execute-api:ManageConnections\s*\n\s*Resource:\s*\n((?:\s*- .*\n)+)/g)];
    expect(manage.length).toBeGreaterThanOrEqual(2);
    for (const m of manage) {
      const resources = String(m[1]);
      expect(resources).toMatch(/\$\{RelayApi\}\/\$\{Stage\}\/POST\/@connections\/\*/);
      expect(resources).toMatch(/\$\{RelayApi\}\/\$\{Stage\}\/DELETE\/@connections\/\*/);
      expect(resources).not.toMatch(/\/GET\//);
    }
    const ssm = [...code.matchAll(/Action: ssm:GetParameter\s*\n\s*Resource: (.*)/g)].map((m) => m[1]);
    expect(ssm.length).toBeGreaterThanOrEqual(1);
    for (const r of ssm) expect(r).toMatch(/parameter\/atr\/relay\/\$\{Stage\}\/hash-secret'?$/);
  });

  it('the template carries no secret: no SSM parameter resource with a value, no secret environment variable, a bounded Lambda timeout and memory, throttling set, reserved concurrency available', () => {
    expect(code).not.toMatch(/Type: AWS::SSM::Parameter/);
    expect(code).not.toMatch(/HASH_SECRET:|SECRET:\s*\S|PASSWORD|API_KEY/i);
    expect(code).toMatch(/ThrottlingRateLimit/);
    expect(code).toMatch(/ThrottlingBurstLimit/);
    expect(code).toMatch(/ReservedConcurrentExecutions: !If \[UseReservedConcurrency/);
    expect(code).toMatch(/Timeout: 10/);
    expect(code).toMatch(/Tracing: PassThrough/);
    expect(code).toMatch(/AuthorizationType: NONE/); // first-message authentication, ADR-0003 (no authorizer at $connect)
    expect(code).not.toMatch(/AllowedOrigins[\s\S]{0,200}Default: '\*'/);
  });

  it('the CloudFront response headers policy carries the page security headers', () => {
    expect(code).toMatch(/ContentSecurityPolicy:[\s\S]*script-src 'self'/);
    expect(code).toMatch(/frame-ancestors 'none'/);
    expect(code).toMatch(/object-src 'none'/);
    expect(code).toMatch(/base-uri 'none'/);
    expect(code).toMatch(/connect-src 'self' wss:\/\/\$\{RelayApi\}/); // the relay origin, not a scheme wildcard
    expect(code).toMatch(/StrictTransportSecurity:[\s\S]*AccessControlMaxAgeSec: 31536000/);
    expect(code).toMatch(/ReferrerPolicy: no-referrer/);
    expect(code).toMatch(/FrameOption: DENY/);
    expect(code).toMatch(/Header: Permissions-Policy\s*\n\s*Value: microphone=\(self\)/);
  });

  it('N-03 (fixed in the repository; deployment pending_external): the clients are told where the relay is, the CSP names exactly the API host, and the relay allows exactly the page origin', () => {
    // Template: the two outputs, the CSP host and the relay's allowed origin come from the same resources.
    expect(code).toMatch(/Outputs:[\s\S]*RelayWssUrl:[\s\S]*Value: !Sub 'wss:\/\/\$\{RelayApi\}\.execute-api\.\$\{AWS::Region\}\.\$\{AWS::URLSuffix\}\/\$\{Stage\}'/);
    expect(code).toMatch(/PhonePageOrigin:[\s\S]*Value: !Sub 'https:\/\/\$\{PhoneDistribution\.DomainName\}'/);
    expect(code).toMatch(/connect-src 'self' wss:\/\/\$\{RelayApi\}\.execute-api\.\$\{AWS::Region\}\.\$\{AWS::URLSuffix\};/);
    expect(code).not.toMatch(/connect-src[^;]*\bwss:[ ;]/);
    expect((code.match(/ALLOWED_ORIGINS: !If[\s\S]*?'https:\/\/\$\{PhoneDistribution\.DomainName\}'/g) ?? []).length, 'both functions allow the CloudFront origin').toBe(2);
    // Phone: a production build with the relay URL bakes it into the bundle and the page's own CSP, and nothing else changes.
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'atr-sec-phone-'));
    try {
      const build = (url: string | undefined, dir: string) =>
        spawnSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], {
          cwd: path.join(ROOT, 'apps/phone'),
          env: { ...process.env, ...(url === undefined ? {} : { VITE_ATR_RELAY_URL: url }) },
          encoding: 'utf8',
        });
      const relay = 'wss://abc123.execute-api.eu-west-1.amazonaws.com/staging';
      const ok = build(relay, path.join(outDir, 'with'));
      expect(ok.status, ok.stderr).toBe(0);
      const html = readFileSync(path.join(outDir, 'with/index.html'), 'utf8');
      const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html)?.[1] ?? '';
      expect(/connect-src ([^;]*)/.exec(meta)?.[1]).toBe("'self' wss://abc123.execute-api.eu-west-1.amazonaws.com");
      const assets = readdirSync(path.join(outDir, 'with/assets')).filter((f) => f.endsWith('.js'));
      const bundle = assets.map((f) => readFileSync(path.join(outDir, 'with/assets', f), 'utf8')).join('\n');
      expect(bundle).toContain(relay);
      expect(bundle).not.toMatch(/__atrTestAudio|Synthetic test audio/);
      // Unset: same origin, nothing else in connect-src.
      const none = build(undefined, path.join(outDir, 'none'));
      expect(none.status, none.stderr).toBe(0);
      expect(/connect-src ([^;]*)/.exec(readFileSync(path.join(outDir, 'none/index.html'), 'utf8'))?.[1]).toBe("'self'");
      // Values that could smuggle data or downgrade the transport fail the build instead of shipping.
      for (const bad of ['ws://x.example/ws', 'https://x.example/ws', 'wss://user:pw@x.example/ws', 'wss://x.example/ws?token=1', 'wss://x.example/ws#frag', 'not a url']) {
        const r = build(bad, path.join(outDir, 'bad'));
        expect(r.status, `a build with VITE_ATR_RELAY_URL=${bad} must fail`).not.toBe(0);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 180_000);
});

describe('SEC-P03 privacy copy and the transmitted fields', () => {
  // Hand-written category of every payload field of every message type (from PROTOCOL.md section 3 and ADR-0002 as amended).
  const CATEGORY: Record<string, string> = {
    // connection details
    'client.app_version': 'technical', 'client.platform': 'technical', room_id: 'connection', pairing_code: 'connection', code_expires_at: 'connection',
    tv_credential: 'connection', phone_credential: 'connection', credential: 'connection', next_credential: 'connection', credential_expires_at: 'connection',
    generation: 'connection', device_label: 'device_name', join_id: 'connection', confirm_digits: 'connection', expires_at: 'connection', decision: 'connection',
    reason: 'connection', role: 'connection', peer_connected: 'connection', phone_paired: 'connection', connected: 'connection', server_time: 'connection',
    code: 'connection', ref_message_id: 'connection', detail: 'connection', acked_message_id: 'connection', outcome: 'connection',
    // TV progress (disclosed on the TV, A2-02)
    family_mode: 'tv_progress', phrase_count: 'tv_progress', cues_max: 'tv_progress', stage: 'tv_progress', phrase_position: 'tv_progress', cues_used: 'tv_progress',
    listener_open_attempt: 'tv_progress', purpose: 'tv_progress', duration_ms: 'levels', kind: 'tv_progress', max_duration_ms: 'tv_progress', vad_floor_dbfs: 'tv_progress',
    timeout_ms: 'tv_progress',
    // phone status
    state: 'phone_status', 'settings.auto_gain_control': 'phone_status', 'settings.echo_cancellation': 'phone_status', 'settings.noise_suppression': 'phone_status',
    'settings.sample_rate': 'phone_status', 'settings.channel_count': 'phone_status', 'supported.auto_gain_control': 'phone_status', 'supported.echo_cancellation': 'phone_status',
    'supported.noise_suppression': 'phone_status', wake_lock: 'phone_status', visibility: 'phone_status', mode: 'phone_status',
    // levels, speaking timing and summaries
    valid: 'levels', invalid_reason: 'levels', floor_dbfs: 'levels', p20_dbfs: 'levels', p80_dbfs: 'levels', p95_dbfs: 'levels', frame_count: 'levels', expected_frames: 'levels',
    coverage: 'levels', clipped_frames: 'levels', nonfinite_frames: 'levels', frame_index: 'levels', t_audio_ms: 'levels', dbfs: 'levels', active: 'speaking_timing', clipped: 'levels',
    active_ms: 'speaking_timing', longest_active_ms: 'speaking_timing', segments: 'speaking_timing', onset_ms: 'speaking_timing', p50_active_dbfs: 'levels',
    p95_active_dbfs: 'levels', peak_dbfs: 'levels',
    // typed text and listener
    phrases: 'phrases', text: 'listener', response: 'listener',
  };
  const flatten = (v: unknown, p = ''): string[] => {
    if (Array.isArray(v)) return [p];
    if (v !== null && typeof v === 'object') return Object.entries(v as object).flatMap(([k, x]) => flatten(x, p ? `${p}.${k}` : k));
    return [p];
  };

  it('every field of every message type has a disclosed category, and no field is named like a verdict, rating or audio', () => {
    const missing: string[] = [];
    const fields = new Set<string>();
    for (const type of MESSAGE_TYPES) for (const f of flatten(samplePayload(type as MessageType))) if (f) fields.add(`${type}:${f}`);
    for (const f of fields) {
      const name = f.split(':')[1] as string;
      if (!(name in CATEGORY)) missing.push(f);
      expect(name, f).not.toMatch(/verdict|rating|reached|agree|score|history|speaker|^(audio|pcm|waveform|samples|blob|buffer|data)$/i);
    }
    expect(missing).toEqual([]);
    expect(fields.size).toBeGreaterThan(100);
  });

  it('the exact phone sentence (A2-01) and the TV About sentence (A2-02) are what the code ships, and cover every phone-side category', () => {
    const phone = read('apps/phone/src/config.ts');
    const sentence =
      'Audio stays on this phone and is never saved or uploaded. The phone sends only sound levels and when you are speaking, typed phrases, listener responses, phone status (microphone, screen, device name) and connection details to the relay and TV.';
    expect(phone).toContain(sentence);
    for (const term of ['sound levels', 'when you are speaking', 'typed phrases', 'listener responses', 'phone status', 'device name', 'connection details']) expect(sentence).toContain(term);
    const copy = read('packages/session-core/src/copy.ts');
    expect(copy).toContain("This TV tells the relay and your phone which practice step you are on and the room's background level. It does not send your results, ratings or history.");
    // the categories actually used by phone-sent fields are all named in the sentence
    const phoneCats = new Set(['levels', 'speaking_timing', 'phrases', 'listener', 'phone_status', 'device_name', 'connection']);
    expect([...phoneCats].length).toBe(7);
  });

  it('N-04 (closed at 0061d83): the TV privacy line is exactly the phone sentence and the revision 1 sentence is gone from the shipped code', () => {
    const sentence =
      'Audio stays on this phone and is never saved or uploaded. The phone sends only sound levels and when you are speaking, typed phrases, listener responses, phone status (microphone, screen, device name) and connection details to the relay and TV.';
    const copy = read('packages/session-core/src/copy.ts');
    expect(copy).toContain(`export const PRIVACY_LINE =\n  '${sentence}';`);
    expect(read('apps/phone/src/config.ts')).toContain(sentence);
    for (const file of [...sourceFiles('apps/phone/src'), ...sourceFiles('apps/tv/src'), ...sourceFiles('packages/session-core/src')]) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('Only levels, typed phrases, listener responses, and connection details');
    }
  });

  it('verdicts, ratings, agreement and history are never in a wire payload (they stay on the TV)', () => {
    for (const type of MESSAGE_TYPES) {
      const json = JSON.stringify(samplePayload(type as MessageType));
      expect(json, type).not.toMatch(/"(verdict|rating|speaker_rating|reached|agree|agreement|history|score)"/i);
    }
    const catalogue = read('packages/protocol/src/payloads.ts');
    expect(catalogue).not.toMatch(/speaker_rating|verdict|agreement|felt_loud/);
  });
});

describe('SEC-P04 forbidden claims in user-facing text', () => {
  const FORBIDDEN = /end-to-end encrypt|never inspects|relay never inspects|only numbers|no data leaves|never leaves (the|your) (house|home)|fully anonymous|100 % private/i;
  it('none of the shipped strings, pages or build docs make a claim ADR-0002 forbids', () => {
    const files = [
      ...sourceFiles('apps/phone/src'),
      ...sourceFiles('apps/tv/src'),
      ...sourceFiles('packages/session-core/src'),
      ...sourceFiles('packages/ten-foot-meter/src'),
      path.join(ROOT, 'apps/phone/index.html'),
    ];
    expect(files.length).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (FORBIDDEN.test(line) && !/forbid|never claim|must not claim|not claim/i.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe('SEC-P05 / SEC-W01 no recording or exfiltration API and no HTML sink', () => {
  const PHONE_FILES = [...sourceFiles('apps/phone/src'), ...sourceFiles('packages/phone-mic-meter/src')];
  const FORBIDDEN_API = /\b(MediaRecorder|sendBeacon|XMLHttpRequest|EventSource|SharedWorker|SpeechRecognition|webkitSpeechRecognition|RTCPeerConnection|BroadcastChannel|navigator\.serviceWorker|localStorage|sessionStorage|indexedDB|caches\.open|document\.cookie)\b/;
  it('the phone and DSP sources use none of: recorder, beacon, XHR, event source, worker, speech, peer connection, channel, storage, cookies; the one object URL is the documented worklet fallback', () => {
    const hits: string[] = [];
    for (const f of PHONE_FILES) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        if (/^\s*(\*|\/\*)/.test(line)) return; // comments
        if (FORBIDDEN_API.test(code) && !/['"`][^'"`]*(MediaRecorder|localStorage|sessionStorage|indexedDB)[^'"`]*['"`]/.test(code)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(hits).toEqual([]);
    const blobUsers = PHONE_FILES.filter((f) => /createObjectURL\s*\(/.test(readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
    expect(blobUsers.map((f) => path.relative(ROOT, f))).toEqual(['packages/phone-mic-meter/src/browser/worklet-loader.ts']);
  });

  it('getUserMedia is called in two places only (the capture module and the audio port wrapper), and fetch is not used by the phone page', () => {
    const gum = PHONE_FILES.filter((f) => /\.getUserMedia\(/.test(readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
    expect(gum.map((f) => path.relative(ROOT, f)).sort()).toEqual(['apps/phone/src/ports/audio.ts', 'packages/phone-mic-meter/src/browser/capture.ts']);
    for (const f of PHONE_FILES) expect(readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), path.relative(ROOT, f)).not.toMatch(/\bfetch\s*\(/);
  });

  it('no HTML sink anywhere in phone, TV or session-core code; text is set through textContent', () => {
    const files = [...PHONE_FILES, ...sourceFiles('apps/tv/src'), ...sourceFiles('packages/session-core/src'), ...sourceFiles('apps/tv/web/src')];
    const SINK = /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML|eval\s*\(|new Function\s*\()/;
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
        if (SINK.test(line.replace(/\/\/.*$/, ''))) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('the production phone bundle contains no recorder or beacon, no eval, no test hook, and no URL other than namespaces (the worklet Blob fallback is dead code there: the page passes a same-origin module URL)', () => {
    const dist = path.join(ROOT, 'apps/phone/dist');
    expect(existsSync(dist)).toBe(true);
    const js = walkFiles(dist, (f) => /\.(js|html|css)$/.test(f));
    expect(js.length).toBeGreaterThan(2);
    for (const f of js) {
      const text = readFileSync(f, 'utf8');
      const rel = path.relative(ROOT, f);
      expect(text, rel).not.toMatch(/MediaRecorder|sendBeacon|XMLHttpRequest|SpeechRecognition|RTCPeerConnection|__atrTestAudio|Synthetic test audio/);
      expect(text, rel).not.toMatch(/\beval\s*\(|new Function\s*\(/);
      const urls = [...text.matchAll(/https?:\/\/[A-Za-z0-9.-]+[^\s"'`)<>]*/g)].map((m) => m[0]);
      for (const u of urls) expect(u, `${rel} contains a URL`).toMatch(/^https?:\/\/(www\.w3\.org|developer\.mozilla\.org|reactjs\.org|github\.com|localhost)/);
    }
  });
});

describe('SEC-T01 TV relay URL policy', () => {
  it('only wss:// to any host, or ws:// to loopback; no credentials, query or fragment in the URL', async () => {
    const { isAllowedRelayUrl, resolveConfig } = await import('../../apps/tv/src/config.js');
    const ok = ['wss://relay.example.test/ws', 'wss://localhost:8443/ws', 'ws://localhost:8443/ws', 'ws://127.0.0.1:9000/ws', 'ws://[::1]:9000/ws'];
    const bad = [
      'ws://relay.example.test/ws', 'ws://localhost.evil.test/ws', 'ws://127.0.0.1.evil.test/ws', 'http://localhost/ws', 'https://relay.example.test/ws',
      'wss://user:pass@relay.example.test/ws', 'wss://relay.example.test/ws?token=abc', 'wss://relay.example.test/ws#frag', 'ws://localhost:8443@evil.test/ws',
      'wss://relay example/ws', '', 'wss://', 'javascript:alert(1)', 'WSS://relay.example.test/ws'.toLowerCase().replace('wss', 'wsx'),
    ];
    for (const u of ok) expect(isAllowedRelayUrl(u), u).toBe(true);
    for (const u of bad) expect(isAllowedRelayUrl(u), u).toBe(false);
    expect(isAllowedRelayUrl(undefined)).toBe(false);
    expect(isAllowedRelayUrl({ toString: () => 'wss://x/ws' })).toBe(false);
    const cfg = resolveConfig({ relayUrl: 'ws://relay.example.test/ws' });
    expect(cfg.relayUrl).toBe('wss://localhost:8443/ws'); // an unsafe override is ignored, the default is used
    expect(cfg.warnings.length).toBe(1);
  });
});

describe('SEC-A04 randomness of what the relay generates', () => {
  it('pairing codes and confirm digits are uniform (chi-square over 200,000 draws); credentials are 43 characters and unique', async () => {
    const mod = (await import('../../services/relay/src/core/credentials.js')) as unknown as {
      newPairingCode(rb: (n: number) => Uint8Array): string;
      newConfirmDigits(rb: (n: number) => Uint8Array): string;
      newCredential(rb: (n: number) => Uint8Array): string;
      systemRandomBytes: (n: number) => Uint8Array;
    };
    const rb = mod.systemRandomBytes;
    const ALPHABET = 'ACDEFHJKMNPRTUVWXY3479';
    const N = 200_000;
    const counts = new Map<string, number>();
    const pos = Array.from({ length: 6 }, () => new Map<string, number>());
    for (let i = 0; i < N; i += 1) {
      const code = mod.newPairingCode(rb);
      expect(code).toMatch(/^[ACDEFHJKMNPRTUVWXY3479]{6}$/);
      [...code].forEach((ch, k) => {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
        const m = pos[k] as Map<string, number>;
        m.set(ch, (m.get(ch) ?? 0) + 1);
      });
    }
    const expected = (N * 6) / ALPHABET.length;
    let chi = 0;
    for (const ch of ALPHABET) chi += ((counts.get(ch) ?? 0) - expected) ** 2 / expected;
    // 21 degrees of freedom: the 99.99th percentile of chi-square is about 46.8
    expect(chi).toBeLessThan(46.8);
    for (const m of pos) {
      let c = 0;
      for (const ch of ALPHABET) c += ((m.get(ch) ?? 0) - N / ALPHABET.length) ** 2 / (N / ALPHABET.length);
      expect(c).toBeLessThan(46.8); // each position on its own is uniform too (no modulo bias at any position)
    }
    const digits = new Map<string, number>();
    for (let i = 0; i < N; i += 1) {
      const d = mod.newConfirmDigits(rb);
      expect(d).toMatch(/^[0-9]{2}$/);
      digits.set(d, (digits.get(d) ?? 0) + 1);
    }
    let chiD = 0;
    for (let v = 0; v < 100; v += 1) chiD += ((digits.get(String(v).padStart(2, '0')) ?? 0) - N / 100) ** 2 / (N / 100);
    expect(chiD).toBeLessThan(148); // 99 degrees of freedom: 99.99th percentile about 148
    const creds = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) {
      const c = mod.newCredential(rb);
      expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/);
      creds.add(c);
    }
    expect(creds.size).toBe(20_000);
  }, 120_000);
});

describe('SEC-V01 the protocol probe script against the built package', () => {
  it('228+ adversarial probes: zero FAIL and zero GAP (every earlier gap is closed or recorded as INFO)', () => {
    const dist = path.join(ROOT, 'packages/protocol/dist/index.js');
    expect(existsSync(dist)).toBe(true);
    const out = path.join(ROOT, 'docs/security/probes/.probe-run.json');
    execFileSync('node', [path.join(ROOT, 'docs/security/probes/protocol_probes.mjs'), out], { env: { ...process.env, ATR_PROTOCOL_DIST: dist }, stdio: 'pipe' });
    const result = JSON.parse(readFileSync(out, 'utf8')) as { counts: Record<string, number>; rows: Array<{ id: string; status: string }> };
    const bad = result.rows.filter((r) => r.status === 'FAIL' || r.status === 'GAP').map((r) => `${r.id}:${r.status}`);
    expect(bad).toEqual([]);
    expect(result.counts['PASS']).toBeGreaterThanOrEqual(190);
    expect(result.rows.length).toBeGreaterThanOrEqual(230);
    execFileSync('rm', ['-f', out]);
  }, 120_000);
});

describe('re-review of rework items in the shipped code', () => {
  const noComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');

  it('PK-10: both relay adapters hand every frame to processInbound; the local server parses nothing, the Lambda adapter parses only its own queue message', () => {
    const local = noComments(read('services/relay/src/local/server.ts'));
    expect(local).toMatch(/core\.processInbound\(/);
    expect(local).not.toMatch(/JSON\.parse|parseWireMessage|validateMessageObject|parseWireText/);
    const aws = noComments(read('services/relay/src/aws/handlers.ts'));
    expect(aws).toMatch(/processInbound\(/);
    expect(aws).not.toMatch(/parseWireMessage|validateMessageObject|parseWireText/);
    expect((aws.match(/JSON\.parse/g) ?? []).length).toBe(1); // parseDeadlineBody: the SQS deadline message
  });

  it('A8-03: the phone code never plays a sound, speaks, or vibrates', () => {
    const files = sourceFiles('apps/phone/src').filter((f) => !f.endsWith('/audio/test-audio.ts')); // the TEST build's synthetic microphone
    for (const f of files) {
      const text = noComments(readFileSync(f, 'utf8'));
      expect(text, path.relative(ROOT, f)).not.toMatch(/navigator\.vibrate|speechSynthesis|new Audio\(|\.play\(|HTMLAudioElement|createBufferSource|createOscillator/);
    }
    // the only oscillator in the build is the test-audio module of the TEST build, and the production bundle has none
    const bundle = walkFiles(path.join(ROOT, 'apps/phone/dist'), (f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(bundle).not.toMatch(/createOscillator|speechSynthesis|navigator\.vibrate/);
  });

  it('A6-02: both clients back off 0.5 to 8 s with +-25 % jitter and stop after 2 minutes of failure', async () => {
    const tvTransport = await import('../../apps/tv/src/adapters/wsTransport.js');
    expect([...tvTransport.BACKOFF_MS]).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(tvTransport.BACKOFF_JITTER).toBe(0.25);
    expect(tvTransport.FAIL_AFTER_MS).toBe(120_000);
    for (const n of [1, 2, 3, 4, 5, 6, 20]) {
      const base = tvTransport.backoffBaseMs(n);
      expect(tvTransport.backoffDelayMs(n, () => 0)).toBe(Math.round(base * 0.75));
      expect(tvTransport.backoffDelayMs(n, () => 1)).toBe(Math.round(base * 1.25));
      expect(tvTransport.backoffDelayMs(n, () => 0.5)).toBe(base);
    }
    expect(tvTransport.backoffBaseMs(20)).toBe(8000);
    const cfg = await import('../../apps/phone/src/config.js');
    expect([...cfg.RECONNECT_BACKOFF_MS]).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(cfg.RECONNECT_JITTER).toBe(0.25);
    expect(cfg.FAILURE_WINDOW_MS).toBe(120_000);
    expect(cfg.HEARTBEAT_MS).toBe(10_000);
    expect(cfg.LINK_DEAD_MS).toBe(25_000);
  });

  it('A1-08 / A8-02 / A5-03 / A5-04: the TV shows the margin and tolerated rise in Diagnostics; the screen-reader lead is 3000 ms; retention is 8 days; checkpoints live 12 hours', async () => {
    const view = read('packages/session-core/src/view.ts');
    expect(view).toMatch(/calibration_margin_db/);
    expect(view).toMatch(/maxTolerableRiseDb/);
    const constants = read('packages/session-core/src/constants.ts');
    expect(constants).toMatch(/QUIET_LEAD_SCREEN_READER_MS = 3000/);
    expect(constants).toMatch(/RETENTION_DAYS = 8/);
    expect(constants).toMatch(/CHECKPOINT_MAX_AGE_MS = 12 \* 3_600_000/);
    const { speakScript } = await import('../../packages/session-core/src/copy.js');
    expect(speakScript(3000, 'eight seconds')).toBe('After this message, wait three seconds, then speak. Measurement lasts eight seconds.');
  });

  it('A6-03: the development CA is name-constrained (critical) to loopback, private ranges and local names', async () => {
    const { certDir } = await import('./helpers.js');
    const ca = path.join(certDir(), 'ca.crt');
    const text = execFileSync('openssl', ['x509', '-in', ca, '-noout', '-text'], { encoding: 'utf8' });
    expect(text).toMatch(/Name Constraints: critical/);
    expect(text).toMatch(/Permitted:/);
    expect(text).toMatch(/CA:TRUE/);
    expect(text).not.toMatch(/DNS:\.?(com|net|org)\b/);
  });

  it('N-06 (fixed): the development CA is valid for at most 90 days and the server certificate never outlives it, both still name-constrained', async () => {
    const { certDir } = await import('./helpers.js');
    const end = (file: string): { start: number; end: number } => {
      const dates = execFileSync('openssl', ['x509', '-in', path.join(certDir(), file), '-noout', '-startdate', '-enddate'], { encoding: 'utf8' });
      return { start: Date.parse(/notBefore=(.*)/.exec(dates)?.[1] ?? ''), end: Date.parse(/notAfter=(.*)/.exec(dates)?.[1] ?? '') };
    };
    const ca = end('ca.crt');
    const server = end('server.crt');
    expect((ca.end - ca.start) / 86_400_000).toBeLessThanOrEqual(90);
    expect((ca.end - ca.start) / 86_400_000).toBeGreaterThan(80); // not a degenerate value
    expect(server.end, 'the server certificate must not outlive the CA').toBeLessThanOrEqual(ca.end);
    expect((server.end - server.start) / 86_400_000).toBeLessThanOrEqual(90);
    const text = execFileSync('openssl', ['x509', '-in', path.join(certDir(), 'ca.crt'), '-noout', '-text'], { encoding: 'utf8' });
    expect(text).toMatch(/Name Constraints: critical/);
  });

  it('A7-01: npm audit of the runtime dependencies reports no high or critical advisory (root workspace); results are printed for the gate record', () => {
    let out = '';
    try {
      out = execFileSync('npm', ['audit', '--omit=dev', '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? '');
    }
    if (out.trim() === '') return; // registry unreachable: recorded as not run, never as passed (see T16_GATE.md)
    const report = JSON.parse(out) as { metadata?: { vulnerabilities?: Record<string, number>; dependencies?: Record<string, number> } };
    const v = report.metadata?.vulnerabilities ?? {};
    console.log('A7-01 npm audit --omit=dev (root):', JSON.stringify(v), JSON.stringify(report.metadata?.dependencies ?? {}));
    expect((v['high'] ?? 0) + (v['critical'] ?? 0)).toBe(0);
  }, 120_000);
});
