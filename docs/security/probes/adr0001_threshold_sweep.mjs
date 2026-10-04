// ADR-0001 follow-up: how often does a SILENT speaker in a room that PASSED the quiet check get
// "active_ms >= 400" (i.e. a scored attempt instead of no_voice), as a function of the VAD
// candidate threshold T and the quiet-check stability limit S?
// Model (synthetic, NOT measured room noise): per-frame dB level = Gaussian with std sigma, AR(1) correlation rho.
// Everything else follows ADR-0001 literally (nearest-rank percentiles, hangover < 6 frames, accepted >= 4 candidate frames).
function nearestRank(a, k) { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.min(s.length - 1, Math.ceil((k / 100) * s.length) - 1))]; }
let seed = 99; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const gauss = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
function ar1(n, sigma, rho) { const o = []; let z = gauss(); for (let i = 0; i < n; i++) { z = rho * z + Math.sqrt(1 - rho * rho) * gauss(); o.push(sigma * z); } return o; }
function activeMs(rel, T) {
  let act = false, onset = 0, cand = 0, gap = 0, last = 0, total = 0;
  const close = () => { if (cand >= 4) total += (last + 1 - onset) * 50; act = false; cand = 0; gap = 0; };
  for (let i = 0; i < rel.length; i++) {
    const c = rel[i] >= T;
    if (!act) { if (c) { act = true; onset = i; cand = 1; gap = 0; last = i; } }
    else if (c) { cand++; gap = 0; last = i; } else { gap++; if (gap >= 6) close(); }
  }
  if (act) close();
  return total;
}
const TRIALS = 8000;
console.log('sigma rho | S(stability limit) T(candidate) -> P(quiet check passes) ; P(active_ms>=400 | silent, passed)');
for (const [sigma, rho] of [[2.5, 0.9], [3.0, 0.8], [3.5, 0.9]]) {
  for (const S of [6, 4, 3]) {
    const row = [];
    for (const T of [6, 8, 9, 10, 12]) {
      let pass = 0, hit = 0;
      for (let t = 0; t < TRIALS; t++) {
        const q = ar1(100, sigma, rho);
        const floor = nearestRank(q, 50);
        if (!(nearestRank(q, 80) - nearestRank(q, 20) <= S && nearestRank(q, 95) - floor <= 10)) continue;
        pass++;
        const win = ar1(160, sigma, rho).map((d) => d - floor);
        if (activeMs(win, T) >= 400) hit++;
      }
      row.push(`T=${T}: ${(pass / TRIALS).toFixed(2)};${(hit / Math.max(pass, 1)).toFixed(3)}`);
    }
    console.log(`sigma=${sigma} rho=${rho} S=${S} | ${row.join('  ')}`);
  }
}
