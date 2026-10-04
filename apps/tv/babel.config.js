// Our own Babel configuration. The React Native preset handles TypeScript, JSX and Hermes-safe output.
//
// Privacy (amendment A5-05): release bundles are built with Metro's production environment, which strips every
// console.* call from our code AND from the dependencies it bundles, so no phrase, pairing code or credential
// can reach a device log. The app itself contains no console calls either (checked by a unit test).
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  env: {
    production: {
      plugins: ['transform-remove-console'],
    },
  },
};
