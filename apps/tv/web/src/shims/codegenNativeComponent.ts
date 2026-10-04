// react-native-svg's Fabric native-component files deep-import this React Native internal (Flow source, which
// Vite's dependency optimiser cannot parse). The web build never renders those components, so a stub is enough.
export default function codegenNativeComponent(name: string): string {
  return name;
}
