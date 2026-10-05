// Bundles the Lambda handlers into services/relay/dist-lambda/: relay.mjs (API Gateway routes) and deadline.mjs
// (SQS delay-queue consumer), ESM, Node 24 / arm64 compatible.
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

const entries = { relay: 'src/aws/lambda.ts', deadline: 'src/aws/deadline-lambda.ts' };

const result = await build({
  entryPoints: Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, resolve(root, file)])),
  outdir: out,
  outExtension: { '.js': '.mjs' },
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

const lines = [];
for (const name of Object.keys(entries)) {
  const file = resolve(out, `${name}.mjs`);
  const bytes = readFileSync(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  lines.push(`file: ${name}.mjs`, `bytes: ${statSync(file).size}`, `sha256: ${sha256}`, `handler: ${name}.handler`, '');
  console.log(`bundle: ${file}\nbytes: ${statSync(file).size}\nsha256: ${sha256}\nhandler: ${name}.handler`);
}
const inputs = Object.keys(result.metafile.inputs).length;
lines.push(`inputs: ${inputs}`, 'runtime: nodejs24.x (bundle targets node22 syntax)', 'architecture: arm64 (pure JavaScript, no native modules)');
writeFileSync(resolve(out, 'MANIFEST.txt'), `${lines.join('\n')}\n`);
