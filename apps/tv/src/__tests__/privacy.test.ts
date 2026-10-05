import * as fs from 'node:fs';
import * as path from 'node:path';
import { transformSync } from '@babel/core';

const root = path.resolve(__dirname, '../..');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === '__fixtures__' ? [] : sources(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('A5-05: no phrases, credentials or codes in console logs', () => {
  it('the app source contains no console call at all', () => {
    const offenders = sources(path.join(root, 'src')).filter((file) => /\bconsole\s*\./.test(fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  const probe = [
    "const phrase = 'Buy Bobby a puppy';",
    "console.log('pairing code ACDEFH', phrase);",
    "console.info('credential', 'abc');",
    "console.warn('phrase', phrase);",
    "console.error('token', 'xyz');",
    "console.debug('debug', phrase);",
    'export const kept = phrase.length;',
  ].join('\n');

  function transform(envName: string): string {
    const result = transformSync(probe, {
      filename: path.join(root, 'src/probe.ts'),
      configFile: path.join(root, 'babel.config.js'),
      babelrc: false,
      envName,
    });
    return result?.code ?? '';
  }

  it('the production Babel environment strips every console method', () => {
    const output = transform('production');
    expect(output).not.toMatch(/console/);
    expect(output).not.toContain('ACDEFH');
    expect(output).not.toContain('credential');
    expect(output).toContain('kept');
  });

  it('the development environment keeps console calls (so the strip is really the production plugin)', () => {
    const output = transform('development');
    expect(output).toMatch(/console\.log/);
  });

  it('the production plugin is declared and installed', () => {
    const config = fs.readFileSync(path.join(root, 'babel.config.js'), 'utf8');
    expect(config).toContain("env: {");
    expect(config).toContain("'transform-remove-console'");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies['babel-plugin-transform-remove-console']).toBe('6.9.4');
    expect(fs.existsSync(path.join(root, 'node_modules/babel-plugin-transform-remove-console/package.json'))).toBe(true);
  });

  it('Diagnostics renders only what the store provides and the UI adds no sensitive field of its own', () => {
    const diagnostics = fs.readFileSync(path.join(root, 'src/screens/DiagnosticsScreen.tsx'), 'utf8');
    expect(diagnostics).not.toMatch(/phrase|credential|pairing\.code|qrPayload/i);
  });
});
