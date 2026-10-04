// Usage: ATR_PROTOCOL_DIST=/tmp/atr-protocol-dist/index.js node docs/security/probes/sparse_array_cost.mjs
import { pathToFileURL } from 'node:url';
const P = await import(pathToFileURL(process.env.ATR_PROTOCOL_DIST).href);
const base = {protocol_version:1,type:'ping',message_id:'m_AAAAAAAAAAAAAAAA',room_id:null,session_id:null,window_id:null,attempt_id:null,sender_role:'phone',producer_generation:1,sequence:1,event_timestamp:1800000000000,payload:{}};
for (const n of [1e7, 5e7, 1e8]) {
  const t=performance.now(); let r; try { r = P.validateMessageObject({...base,payload:{x:new Array(n)}},{now:1800000000000}); } catch(e){ r={code:'THROW '+e.message}; }
  console.log(n, r.code, (performance.now()-t).toFixed(0)+' ms', Math.round(process.memoryUsage().rss/1e6)+' MB rss');
}
