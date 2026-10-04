// Our own Metro configuration.
//
// Workspace packages (@atr/session-core, @atr/ten-foot-meter) are declared as file: dependencies, so
// node_modules/@atr/* are symlinks into ../../packages. Metro must watch the real location and resolve
// them through their package.json (dist/ output), so run `npm run build:packages` before bundling.
// tsc and jest read the packages from source instead and need no build step.
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const packagesRoot = path.resolve(__dirname, '../../packages');

/** @type {import('metro-config').MetroConfig} */
const config = {
  watchFolders: [packagesRoot],
  resolver: {
    // Resolve third-party modules from this project only, never from the repository root.
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
