import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_VERSION } from '../config';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');
const pkg = JSON.parse(read('package.json')) as {
  version: string;
  engines: { node: string };
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides: Record<string, string>;
  kepler: { projectType: string; appName: string; targets: string[] };
};
const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string }> };
const manifest = read('manifest.toml');
const manifestCode = manifest
  .split('\n')
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter((line) => line.length > 0)
  .join('\n');

describe('versions and pins (ADR-0007)', () => {
  it('keeps one version across package.json, config.ts and manifest.toml', () => {
    expect(pkg.version).toBe(APP_VERSION);
    expect(manifestCode).toContain('version = "' + APP_VERSION + '"');
  });

  it('pins the Vega React Native line', () => {
    expect(pkg.dependencies['react']).toBe('19.2.0');
    expect(pkg.dependencies['react-native']).toBe('0.83.0');
    expect(pkg.dependencies['@amazon-devices/react-native-kepler']).toBe('~4.0.0+rn0.83.0');
    expect(pkg.dependencies['@amazon-devices/react-native-svg']).toBe('~3.0.0');
    expect(pkg.dependencies['@amazon-devices/kepler-a11y-settings-interface-turbo']).toBe('1.0.0');
    expect(pkg.devDependencies['typescript']).toBe('5.8.3');
    expect(pkg.devDependencies['react-test-renderer']).toBe('19.2.0');
    expect(pkg.devDependencies['@react-native/babel-preset']).toBe('0.83.0');
    expect(pkg.devDependencies['@react-native/metro-config']).toBe('0.83.0');
    expect(pkg.devDependencies['@amazon-devices/kepler-cli-platform']).toBe('~0.22.0');
    expect(pkg.engines.node).toBe('>=22');
    expect(read('.nvmrc').trim()).toBe('22.22.2');
  });

  it('aliases AsyncStorage to the Vega package, with a matching override', () => {
    const alias = 'npm:@amazon-devices/react-native-async-storage__async-storage@~2.1.0';
    expect(pkg.dependencies['@react-native-async-storage/async-storage']).toBe(alias);
    expect(pkg.overrides['@react-native-async-storage/async-storage']).toBe(alias);
  });

  it('declares the workspace packages as file: dependencies and stays out of the root workspaces', () => {
    expect(pkg.dependencies['@atr/session-core']).toBe('file:../../packages/session-core');
    expect(pkg.dependencies['@atr/ten-foot-meter']).toBe('file:../../packages/ten-foot-meter');
    expect(pkg.dependencies['@atr/protocol']).toBe('file:../../packages/protocol');
    const rootPkg = JSON.parse(fs.readFileSync(path.resolve(root, '../../package.json'), 'utf8')) as { workspaces: string[] };
    expect(rootPkg.workspaces.some((w) => w.includes('apps/tv'))).toBe(false);
  });

  it('has the kepler project block', () => {
    expect(pkg.kepler).toEqual({ projectType: 'application', appName: 'farsidecheck', targets: ['tv'] });
  });

  it('resolved the expected packages in the lockfile', () => {
    const version = (name: string): string | undefined => lock.packages['node_modules/' + name]?.version;
    expect(version('react')).toBe('19.2.0');
    expect(version('react-native')).toBe('0.83.0');
    expect(version('react-test-renderer')).toBe('19.2.0');
    expect(version('typescript')).toBe('5.8.3');
    expect(version('@amazon-devices/react-native-kepler')).toMatch(/^4\.0\.\d+$/);
    expect(version('@amazon-devices/react-native-svg')).toMatch(/^3\.0\./);
    expect(version('@amazon-devices/kepler-a11y-settings-interface-turbo')).toBe('1.0.0');
    expect(version('@amazon-devices/kepler-cli-platform')).toMatch(/^0\.22\./);
    expect(version('@react-native-async-storage/async-storage')).toMatch(/^2\.1\./);
  });

  it('has the scripts the integrator needs', () => {
    for (const name of ['start', 'test', 'typecheck', 'build:debug', 'build:release', 'build:packages', 'bundle:js']) {
      expect(pkg.scripts[name]).toBeDefined();
    }
  });
});

describe('manifest.toml (documented unvalidated until the Vega SDK runs)', () => {
  it('declares the package, OS level and the single main interactive component', () => {
    expect(manifestCode).toContain('schema-version = 1');
    expect(manifestCode).toContain('id = "com.acrosstheroom.farsidecheck"');
    expect(manifestCode).toContain('title = "Across the Room"');
    expect(manifestCode).toContain('icon = "@image/farsidecheck-icon.png"');
    expect(manifestCode).toMatch(/\[os\.version\]\s+min = "1\.2"\s+target = "1\.2"/);
    expect(manifestCode).toContain('id = "com.acrosstheroom.farsidecheck.main"');
    expect(manifestCode).toContain('runtime-module = "/com.amazon.kepler.runtime.react_native_kepler_4@IReactNativeKepler_0"');
    expect(manifestCode).toContain('categories = ["com.amazon.category.main"]');
    expect(manifestCode).toContain('launch-type = "singleton"');
    expect(manifestCode).toContain('id = "/com.amazon.vega.os@IVega_1_2"');
    expect(manifestCode.match(/\[\[components\.interactive\]\]/g)).toHaveLength(1);
  });

  it('wants the remote, network and accessibility entries', () => {
    expect(manifestCode).toContain('id = "com.amazon.inputd.service"');
    expect(manifestCode).toContain('id = "com.amazon.network.service"');
    expect(manifestCode).toContain('id = "com.amazon.devconf.privilege.accessibility"');
  });

  it('has NO microphone, audio, media, DRM or input-method entry (the TV never captures audio)', () => {
    expect(manifestCode).not.toMatch(/microphone|\bmic\b|audio|media|drm|inputmethod|record|capture/i);
  });

  it('keeps the interactive component id equal to the registered app name', () => {
    const app = JSON.parse(read('app.json')) as { name: string };
    expect(app.name).toBe('com.acrosstheroom.farsidecheck.main');
    expect(manifestCode).toContain('id = "' + app.name + '"');
    expect(manifestCode).toContain('id = "' + app.name.replace(/\.main$/, '') + '"');
  });

  it('says in plain words that native validation is pending', () => {
    expect(manifest).toMatch(/NATIVE VALIDATION IS PENDING/);
  });

  it('references an icon that exists and is a PNG', () => {
    const file = fs.readFileSync(path.join(root, 'assets/image/farsidecheck-icon.png'));
    expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});

describe('copy hygiene (K5): no program name, treatment or outcome claim in authored UI strings', () => {
  const FORBIDDEN = /\btherap(y|ist|ies)\b|treatment|recalibrat|patient|\bcure[sd]?\b|LSVT|parkinson|\bdiagnos(is|ed)\b/i;

  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === '__fixtures__' ? [] : sources(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it('finds none in src (tests and fixtures excluded)', () => {
    const offenders = sources(path.join(root, 'src')).filter((file) => FORBIDDEN.test(fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
