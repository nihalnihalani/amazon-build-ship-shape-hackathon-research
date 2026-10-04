// Throwaway independent checks of ADR-0001 arithmetic (reviewer T02-review). Not shipped.
// Implements the ADR text literally; no code from the repo is used.

const FRAME_MS = 50;

function nearestRank(sortedAsc, k) {
  const n = sortedAsc.length;
  if (n === 0) return null;
  const idx = Math.ceil((k / 100) * n) - 1;
  return sortedAsc[Math.max(0, Math.min(n - 1, idx))];
}
const sorted = (a) => [...a].sort((x, y) => x - y);

// ---- ADR-0001 section 3 VAD ----
function vad(relFrames) {
  // relFrames: array of rel dB (dbfs - session_floor) or NaN for non-finite
  const segs = [];
  let active = false, onset = -1, cand = 0, gap = 0, last = -1;
  const close = () => {
    segs.push({ onset, endFrame: last + 1, cand, accepted: cand >= 4 });
    active = false; onset = -1; cand = 0; gap = 0; last = -1;
  };
  for (let i = 0; i < relFrames.length; i++) {
    const c = Number.isFinite(relFrames[i]) && relFrames[i] >= 6;
    if (!active) {
      if (c) { active = true; onset = i; cand = 1; gap = 0; last = i; }
    } else if (c) { cand++; gap = 0; last = i; }
    else { gap++; if (gap >= 6) close(); }
  }
  if (active) close();
  const acc = segs.filter((s) => s.accepted);
  const activeMs = acc.reduce((a, s) => a + (s.endFrame - s.onset) * FRAME_MS, 0);
  const longest = acc.reduce((a, s) => Math.max(a, (s.endFrame - s.onset) * FRAME_MS), 0);
  return { segs, acc, activeMs, longest };
}

// ---- A. coherence grid: cal_margin >= 13, rise <= 3 never trips the two inequalities ----
function blocks(calMargin, rise) { return rise >= 6 || calMargin - rise < 10; }
let violations = 0, checked = 0;
for (let cm = 13; cm <= 60; cm += 0.01) {
  for (let r = -30; r <= 3 + 1e-9; r += 0.01) {
    checked++;
    if (blocks(+cm.toFixed(2), +r.toFixed(2))) violations++;
  }
}
console.log('A1 grid cal_margin in [13,60], rise in [-30,3]: checked', checked, 'blocked', violations);
console.log('A2 boundary: (13,3)->', blocks(13, 3), ' (13,3.01)->', blocks(13, 3.01), ' (12.99,0)->', blocks(12.99, 0), ' (12.99,2.99)->', blocks(12.99, 2.99));
// maximum tolerated rise for a given cal_margin
for (const cm of [13, 14, 15, 16, 20, 30]) {
  let lo = -50, hi = 50;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (blocks(cm, mid)) hi = mid; else lo = mid; }
  console.log(`A3 cal_margin=${cm}: max rise not blocked = ${lo.toFixed(3)} dB`);
}

// ---- D. nearest-rank index checks ----
for (const n of [1, 2, 20, 40, 100, 160]) {
  const a = Array.from({ length: n }, (_, i) => i + 1);
  console.log(`D n=${n}: p20=${nearestRank(a, 20)} p50=${nearestRank(a, 50)} p80=${nearestRank(a, 80)} p95=${nearestRank(a, 95)} (rank from top for p95: ${n - nearestRank(a, 95) + 1})`);
}

// ---- B. transient sweep with real sample-level framing ----
const SR = 48000, FS = Math.round(SR * 0.05); // 2400
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const FLOOR_RMS = 10 ** (-60 / 20);

function frameDb(samples) {
  const out = [];
  for (let f = 0; f + FS <= samples.length; f += FS) {
    let s = 0; for (let i = f; i < f + FS; i++) s += samples[i] * samples[i];
    out.push(20 * Math.log10(Math.max(Math.sqrt(s / FS), 1e-7)));
  }
  return out;
}
function median(a) { return nearestRank(sorted(a), 50); }

// session floor from 5 s of noise only
const calNoise = new Float32Array(SR * 5).map(() => gauss() * FLOOR_RMS);
const sessionFloor = median(frameDb(calNoise));
console.log('B session floor dBFS', sessionFloor.toFixed(2));

function transientTrial(durMs, relDb, offsetSamples) {
  const total = SR * 2; // 2 s window of noise + one burst
  const x = new Float32Array(total).map(() => gauss() * FLOOR_RMS);
  const amp = FLOOR_RMS * 10 ** (relDb / 20);
  const start = SR * 0.5 + offsetSamples;
  const n = Math.round((durMs / 1000) * SR);
  for (let i = 0; i < n; i++) x[start + i] += gauss() * amp; // noise burst, rms = amp
  const rel = frameDb(x).map((d) => d - sessionFloor);
  const r = vad(rel);
  const cands = rel.filter((v) => v >= 6).length;
  return { accepted: r.acc.length > 0, cands, activeMs: r.activeMs };
}
console.log('B transient sweep (fraction of frame-phase offsets accepted as voice; max candidate frames)');
for (const relDb of [10, 15, 20, 30]) {
  const row = [];
  for (const durMs of [50, 100, 125, 150, 175, 200, 250]) {
    let acc = 0, tot = 0, maxC = 0;
    for (let off = 0; off < FS; off += 60) { // 40 phase offsets across one frame
      const t = transientTrial(durMs, relDb, off);
      tot++; if (t.accepted) acc++; maxC = Math.max(maxC, t.cands);
    }
    row.push(`${durMs}ms:${acc}/${tot} (maxCand ${maxC})`);
  }
  console.log(`  burst +${relDb} dB: ${row.join(' | ')}`);
}

// ---- C. quiet-room-valid noise false activity ----
function ar1Levels(n, mu, sigma, rho) {
  const out = []; let z = gauss();
  for (let i = 0; i < n; i++) { z = rho * z + Math.sqrt(1 - rho * rho) * gauss(); out.push(mu + sigma * z); }
  return out;
}
function quietCheckValid(levels) { // ADR section 2 stats on 100 frames
  const s = sorted(levels);
  const floor = nearestRank(s, 50), p20 = nearestRank(s, 20), p80 = nearestRank(s, 80), p95 = nearestRank(s, 95);
  return { floor, ok: p80 - p20 <= 6 && p95 - floor <= 10 };
}
function preWindowStats(levels, mode) {
  const s = sorted(levels);
  const floor = nearestRank(s, 50), p20 = nearestRank(s, 20), p80 = nearestRank(s, 80), p95 = nearestRank(s, 95);
  const burst = p95 - floor <= 10;
  const stable = p80 - p20 <= 6;
  return { floor, ok: mode === 'burst_only' ? burst : burst && stable };
}
console.log('C silent-speaker 8 s phrase window in a room that PASSED the 5 s quiet check (Gaussian per-frame dB, AR(1) rho)');
console.log('  sigma rho | P(quiet valid) | P(active_ms>=400 | silent) | P(any accepted seg) | P(prewindow false-fail: burst only) | P(false-fail: burst+stability)');
const TRIALS = 6000;
for (const sigma of [1.5, 2.5, 3.0, 3.5]) {
  for (const rho of [0, 0.5, 0.8, 0.9]) {
    let valid = 0, act400 = 0, anySeg = 0, pwB = 0, pwBS = 0, pwN = 0;
    for (let t = 0; t < TRIALS; t++) {
      const mu = -70;
      const q = quietCheckValid(ar1Levels(100, mu, sigma, rho));
      if (!q.ok) continue;
      valid++;
      const win = ar1Levels(160, mu, sigma, rho).map((d) => d - q.floor);
      const r = vad(win);
      if (r.activeMs >= 400) act400++;
      if (r.acc.length > 0) anySeg++;
      const pw = ar1Levels(40, mu, sigma, rho);
      pwN++;
      if (!preWindowStats(pw, 'burst_only').ok) pwB++;
      if (!preWindowStats(pw, 'both').ok) pwBS++;
    }
    console.log(`  ${sigma.toFixed(1)} ${rho.toFixed(1)} | ${(valid / TRIALS).toFixed(3)} | ${(act400 / Math.max(valid, 1)).toFixed(4)} | ${(anySeg / Math.max(valid, 1)).toFixed(4)} | ${(pwB / Math.max(pwN, 1)).toFixed(4)} | ${(pwBS / Math.max(pwN, 1)).toFixed(4)}`);
  }
}

// ---- E. phrase min active vs short utterances (illustrative durations, not measured speech) ----
console.log('E phrase of D ms of continuous candidate frames -> accepted active_ms and valid(>=400)?');
for (const candFrames of [3, 4, 5, 7, 8, 9]) {
  const rel = Array(10).fill(0).concat(Array(candFrames).fill(15), Array(100).fill(0));
  const r = vad(rel);
  console.log(`  ${candFrames * 50} ms voiced -> active_ms=${r.activeMs} (>=400: ${r.activeMs >= 400})`);
}
// non-contiguous candidates accepted?
{
  const rel = Array(10).fill(0); // X.X.X.X : four isolated candidate frames separated by one quiet frame
  for (let k = 0; k < 4; k++) { rel.push(15); rel.push(0); }
  rel.push(...Array(100).fill(0));
  const r = vad(rel);
  console.log('  four isolated 50 ms clicks 100 ms apart -> accepted segs', r.acc.length, 'active_ms', r.activeMs);
}
// digital silence floor
console.log('F floor of exact digital silence:', 20 * Math.log10(Math.max(0, 1e-7)), 'dBFS -> quiet check passes floor<=-30 and p80-p20=0');
