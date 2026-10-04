// Jest stand-in for @amazon-devices/react-native-svg: every primitive is a host element named after
// the SVG tag so tests can read the props (d, x, y, width, ...) that would reach the native renderer.
import * as React from 'react';

type Props = Record<string, unknown> & { children?: React.ReactNode };

function primitive(tag: string): React.FC<Props> {
  const Component: React.FC<Props> = (props) => React.createElement(tag, props);
  Component.displayName = tag;
  return Component;
}

export const Svg = primitive('Svg');
export const Path = primitive('Path');
export const Rect = primitive('Rect');
export const G = primitive('G');
export const Circle = primitive('Circle');
export const Line = primitive('Line');
export default Svg;
