import * as React from 'react';
import { View } from 'react-native';
import { Path, Svg } from '@amazon-devices/react-native-svg';
import { glyph } from '@atr/ten-foot-meter';
import type { ShapeKind } from '@atr/ten-foot-meter';
import { colors } from '../theme';
import { useUiScale } from './scale';

export interface ToneGlyphProps {
  shape: ShapeKind;
  color?: string;
  /** Base size (px at UI scale 1.0). */
  baseSize?: number;
  testID?: string;
}

/**
 * A non-colour cue drawn as SVG path data (check, ring, dash, dot). Decorative for screen readers: the
 * sentence next to it carries the meaning, so the glyph is hidden from the accessibility tree.
 */
export function ToneGlyph({ shape, color = colors.text, baseSize = 56, testID }: ToneGlyphProps): React.ReactElement {
  const ui = useUiScale();
  const size = ui.size(baseSize);
  const stroke = Math.max(3, Math.round(size / 9));
  const g = glyph(shape, size / 2, size / 2, size * 0.8);
  return (
    <View testID={testID} accessible={false} aria-hidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size}>
        <Path
          d={g.d}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={g.filled ? color : 'none'}
        />
      </Svg>
    </View>
  );
}
