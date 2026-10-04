// Jest configuration: React Native preset with the Vega native packages replaced by hand-written mocks.
// These tests prove component logic and accessibility props only. They do not prove native rendering
// on a Vega Virtual Device or a Fire TV (evidence class: automated).
module.exports = {
  preset: 'react-native',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest/setup.ts'],
  // Resolves NodeNext-style "./file.js" imports inside ../../packages/*/src to the .ts sources.
  resolver: '<rootDir>/jest/resolver.js',
  moduleNameMapper: {
    '^@atr/session-core$': '<rootDir>/../../packages/session-core/src/index.ts',
    '^@atr/ten-foot-meter$': '<rootDir>/../../packages/ten-foot-meter/src/index.ts',
    '^@amazon-devices/react-native-kepler$': '<rootDir>/jest/mocks/react-native-kepler.tsx',
    '^@amazon-devices/react-native-svg$': '<rootDir>/jest/mocks/react-native-svg.tsx',
    '^@amazon-devices/kepler-a11y-settings-interface-turbo$': '<rootDir>/jest/mocks/kepler-a11y.tsx',
    '^@react-native-async-storage/async-storage$': '<rootDir>/jest/mocks/async-storage.ts',
  },
  watchPathIgnorePatterns: ['<rootDir>/node_modules/'],
};
