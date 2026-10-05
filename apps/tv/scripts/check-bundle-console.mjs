// A5-05 release check: the production JS bundle must contain no console.log / warn / info / debug call and only the
// few console.error references that belong to React Native's own fatal-error reporter (it logs the error object,
// never app data; the app throws no phrase, code or credential into error messages).
// Run: npm run check:bundle  (builds build/farsidecheck.bundle first)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../build/farsidecheck.bundle');
const bundle = readFileSync(file, 'utf8');
const count = (method) => (bundle.match(new RegExp('console\\.' + method + '\\b', 'g')) ?? []).length;
const counts = Object.fromEntries(['log', 'warn', 'info', 'debug', 'error', 'trace'].map((m) => [m, count(m)]));
console.log('console references in ' + file + ': ' + JSON.stringify(counts));
const stripped = ['log', 'warn', 'info', 'debug', 'trace'].filter((m) => counts[m] > 0);
if (stripped.length > 0) {
  console.error('FAIL: console.' + stripped.join(', console.') + ' still present: build with the production Babel environment (--dev false).');
  process.exit(1);
}
if (counts.error > 3) {
  console.error('FAIL: ' + counts.error + ' console.error references (expected at most the 3 in the React Native error reporter).');
  process.exit(1);
}
console.log('OK');
