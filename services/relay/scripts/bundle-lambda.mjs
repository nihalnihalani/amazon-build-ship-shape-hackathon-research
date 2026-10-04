// Bundles the Lambda handler into services/relay/dist-lambda/ (relay.mjs, ESM, Node 24 / arm64 compatible).
// The AWS SDK v3 clients are bundled (not taken from the runtime) so the deployed code is the code that was tested.
// @atr/protocol is bundled from its TypeScript sources, so no prior package build is required.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist-lambda');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [resolve(root, 'src/aws/lambda.ts')],
  outfile: resolve(out, 'relay.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
  alias: { '@atr/protocol': resolve(root, '../../packages/protocol/src/index.ts') },
  // Some bundled CommonJS dependencies call require(); provide it in the ES module scope.
  banner: { js: "import { createRequire as __atrCreateRequire } from 'node:module'; const require = __atrCreateRequire(import.meta.url);" },
});

const file = resolve(out, 'relay.mjs');
const bytes = readFileSync(file);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const inputs = Object.keys(result.metafile.inputs).length;
writeFileSync(resolve(out, 'MANIFEST.txt'), `file: relay.mjs\nbytes: ${statSync(file).size}\nsha256: ${sha256}\ninputs: ${inputs}\nhandler: relay.handler\nruntime: nodejs24.x (bundle targets node22 syntax)\narchitecture: arm64 (pure JavaScript, no native modules)\n`);
console.log(`bundle: ${file}\nbytes: ${statSync(file).size}\nsha256: ${sha256}\nhandler: relay.handler`);
