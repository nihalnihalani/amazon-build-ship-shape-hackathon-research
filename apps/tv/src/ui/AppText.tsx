import * as React from 'react';
import { Text } from 'react-native';
import type { TextProps } from 'react-native';
import { colors, type } from '../theme';
import { useUiScale } from './scale';

export type TextKind = 'footer' | 'body' | 'muted' | 'label' | 'title' | 'counter';

/**
 * Largest size (px) a kind may reach at any UI scale. Body text and labels are never capped (accessibility);
 * display sizes are, because at 1.5x and above a 160 px counter or a 56 px title would not leave room for the
 * controls and the footer (Vega's ScalingProps.maxSize exists for exactly this).
 */
const MAX_SIZE: Partial<Record<TextKind, number>> = {
  title: 72,
  counter: 208,
};

const BASE_SIZE: Record<TextKind, number> = {
  footer: type.footer,
  body: type.body,
  muted: type.body,
  label: type.label,
  title: type.title,
  counter: type.counter,
};

export interface AppTextProps extends TextProps {
  kind?: TextKind;
  /** Base size override (px at scale 1.0) for sizes that are computed, such as the fitted phrase. */
  baseSize?: number;
  /** Cap (px) for a baseSize override. */
  maxSize?: number;
  color?: string;
  bold?: boolean;
  center?: boolean;
}

/** Text that takes its size through the UI-scale hook. System font scaling is off: the TV scales instead. */
export function AppText({
  kind = 'body',
  baseSize,
  maxSize,
  color,
  bold,
  center,
  style,
  children,
  ...rest
}: AppTextProps): React.ReactElement {
  const ui = useUiScale();
  const fontSize = ui.text(baseSize ?? BASE_SIZE[kind], baseSize === undefined ? MAX_SIZE[kind] : maxSize);
  return (
    <Text
      allowFontScaling={false}
      {...rest}
      style={[
        {
          fontSize,
          lineHeight: Math.round(fontSize * 1.2),
          color: color ?? (kind === 'muted' || kind === 'footer' ? colors.textMuted : colors.text),
          fontWeight: bold === true || kind === 'title' || kind === 'counter' ? '700' : '400',
          textAlign: center === true ? 'center' : 'left',
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
