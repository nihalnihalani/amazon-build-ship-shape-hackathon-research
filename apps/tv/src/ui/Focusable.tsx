import * as React from 'react';
import { useState } from 'react';
import { Pressable } from 'react-native';
import type { ActionId, ViewAction } from '@atr/session-core';
import { colors, layout } from '../theme';
import { AppText } from './AppText';
import { useUiScale } from './scale';

export interface FocusableProps {
  action: ViewAction;
  /** True for the single control on the screen that takes focus when the screen appears. */
  preferred: boolean;
  onPress: (id: ActionId) => void;
  /** nativeIDs of static text VoiceView should read with this control (Vega accessibilityDescribedBy). */
  describedBy?: string[];
}

/**
 * The one focusable control used everywhere. Focus is shown with a 6 px ring and a 1.05 scale (shape and
 * size, not colour alone). Every control carries a role, a label and, when the view provides one, a hint.
 */
export function Focusable({ action, preferred, onPress, describedBy }: FocusableProps): React.ReactElement {
  const ui = useUiScale();
  const [focused, setFocused] = useState(false);
  const disabled = action.disabled === true;
  const ring = ui.size(layout.focusRing);
  return (
    <Pressable
      testID={'action-' + action.id}
      role="button"
      aria-label={action.label}
      accessibilityHint={action.hint}
      accessibilityDescribedBy={describedBy}
      aria-disabled={disabled}
      focusable={!disabled}
      hasTVPreferredFocus={preferred && !disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => {
        if (!disabled) onPress(action.id);
      }}
      style={{
        minWidth: ui.size(320),
        minHeight: ui.size(104),
        paddingHorizontal: ui.space(40),
        paddingVertical: ui.space(20),
        marginRight: ui.space(32),
        marginBottom: ui.space(24),
        justifyContent: 'center',
        borderRadius: ui.size(16),
        borderWidth: ring,
        borderColor: focused ? colors.focusRing : 'transparent',
        backgroundColor: focused ? colors.surfaceFocused : colors.surface,
        opacity: disabled ? 0.5 : 1,
        transform: [{ scale: focused ? layout.focusScale : 1 }],
      }}
    >
      <AppText kind="label" center color={action.destructive === true ? colors.danger : colors.text}>
        {action.label}
      </AppText>
    </Pressable>
  );
}
