// Recorded finding for fixtures/dsp/README.md (not asserted by any test).
// How often does a SILENT 8 s phrase window in a room that PASSED the quiet check contain an accepted
// segment, for alternative VAD thresholds? Standalone, independent of the shipped package.
//   columns: open threshold O, continuation threshold C, quiet-check stability limit S (dB)
//   rule:    open at rel >= O, continue at rel >= C, bridge gaps < 6 frames, accept with >= 4 candidate
//            frames and a run of >= 3 (the revision 2 acceptance rule), 10,000 valid rooms per cell, seed 7.
//   model:   per-frame level -70 + sigma * z, z AR(1) with correlation rho (SYNTHETIC, not measured noise).
// Run: node fixtures/dsp/tools/ar1_threshold_comparison.mjs
function mulberry32(seed){let a=seed>>>0;return()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const mk=(seed)=>{const r=mulberry32(seed);return ()=>{let u=0;while(u===0)u=r();const v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};};
const nr=(a,k)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.max(0,Math.min(s.length-1,Math.ceil(k*s.length/100)-1))];};
const q1=(x)=>{const v=Math.round(x*10)/10;return v===0?0:v;};
function ar1(n,sigma,rho,g){const o=[];let z=g();for(let i=0;i<n;i++){z=rho*z+Math.sqrt(1-rho*rho)*g();o.push(-70+sigma*z);}return o;}
function accepted(rel,O,C){let open=false,cnt=0,run=0,best=0,gap=0,any=false;
  const close=()=>{if(cnt>=4&&best>=3)any=true;open=false;cnt=0;run=0;best=0;gap=0;};
  for(const r of rel){const cand=r>=O-1e-9||(open&&r>=C-1e-9);
    if(cand){if(!open){open=true;cnt=0;run=0;best=0;}cnt++;run++;best=Math.max(best,run);gap=0;}
    else{run=0;if(open){gap++;if(gap>=6)close();}}}
  if(open)close();return any;}
function sim(sigma,rho,S,O,C,trials=10000,seed=7){const g=mk(seed);let valid=0,att=0,hit=0;
  while(valid<trials){att++;const q=ar1(100,sigma,rho,g).map(q1);
    const fl=nr(q,50);if(!(nr(q,80)-nr(q,20)<=S+1e-9&&nr(q,95)-fl<=10+1e-9))continue;valid++;
    const w=ar1(160,sigma,rho,g);if(accepted(w.map(d=>d-fl),O,C))hit++;}
  return (hit/trials*100).toFixed(2)+'%';}
const configs=[['spec O10/C6 S6',6,10,6],['O12/C6 S6',6,12,6],['O12/C8 S6',6,12,8],['O10/C8 S6',6,10,8],['O10/C6 S4',4,10,6],['O12/C6 S4',4,12,6],['O12/C8 S4',4,12,8]];
console.log('model | '+configs.map(c=>c[0]).join(' | '));
for(const [s,r] of [[2.5,0.9],[3.0,0.8],[3.0,0.9],[3.5,0.5],[3.5,0.8],[3.5,0.9]]){
  console.log(`σ${s} ρ${r} | `+configs.map(([n,S,O,C])=>sim(s,r,S,O,C)).join(' | '));}
