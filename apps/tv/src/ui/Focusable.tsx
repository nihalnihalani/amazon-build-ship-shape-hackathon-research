import * as React from 'react';
import { useRef, useState } from 'react';
import { Pressable } from 'react-native';
import type { View } from 'react-native';
import type { ActionId, ViewAction } from '@atr/session-core';
import { colors, layout } from '../theme';
import { AppText } from './AppText';
import { useFocusScrollApi } from './FocusScroll';
import { useUiScale } from './scale';

export interface FocusableProps {
  action: ViewAction;
  /** True for the single control on the screen that takes focus when the screen appears. */
  preferred: boolean;
  onPress: (id: ActionId) => void;
  /** nativeIDs of static text VoiceView should read with this control (Vega accessibilityDescribedBy). */
  describedBy?: string[];
  /** Visible text when it should differ from the accessible label (for example a bare number). */
  text?: string;
  /** Large number style used by the join-confirmation choices (all choices share one style). */
  large?: boolean;
}

/**
 * The one focusable control used everywhere. Focus is shown with a 6 px ring and a 1.05 scale (shape and
 * size, not colour alone). Every control carries a role, a label and, when the view provides one, a hint.
 */
export function Focusable({ action, preferred, onPress, describedBy, text, large = false }: FocusableProps): React.ReactElement {
  const ui = useUiScale();
  const [focused, setFocused] = useState(false);
  const ref = useRef<View>(null);
  const scroll = useFocusScrollApi();
  const disabled = action.disabled === true;
  const ring = ui.size(layout.focusRing);
  return (
    <Pressable
      testID={'action-' + action.id}
      role="button"
      aria-label={action.label}
      accessibilityHint={action.hint}
      accessibilityDescribedBy={describedBy}
      // A11Y-01: all three, because platforms honour different ones. The Vega Pressable derives `focusable` from
      // `focusable`, `disabled` and `aria-disabled`; react-native-web ignores `focusable` and builds aria-disabled
      // and tabindex from `disabled`.
      disabled={disabled}
      aria-disabled={disabled}
      focusable={!disabled}
      hasTVPreferredFocus={preferred && !disabled}
      ref={ref}
      onFocus={() => {
        setFocused(true);
        scroll?.onControlFocus(ref.current);
      }}
      onBlur={() => setFocused(false)}
      onPress={() => {
        if (!disabled) onPress(action.id);
      }}
      style={{
        // Large (number) buttons cap at 420 px so three of them and their gaps fit one row at any UI scale.
        minWidth: large ? ui.size(280, 420) : ui.size(320),
        minHeight: ui.size(large ? 180 : 80),
        paddingHorizontal: ui.space(40),
        paddingVertical: ui.space(12),
        marginRight: ui.space(32),
        marginBottom: ui.space(16),
        justifyContent: 'center',
        borderRadius: ui.size(16),
        borderWidth: ring,
        borderColor: focused ? colors.focusRing : 'transparent',
        backgroundColor: focused ? colors.surfaceFocused : colors.surface,
        opacity: disabled ? 0.5 : 1,
        transform: [{ scale: focused ? layout.focusScale : 1 }],
      }}
    >
      <AppText
        kind="label"
        baseSize={large ? 96 : undefined}
        maxSize={large ? 120 : undefined}
        bold={large}
        center
        color={action.destructive === true ? colors.danger : colors.text}
      >
        {text ?? action.label}
      </AppText>
    </Pressable>
  );
}
