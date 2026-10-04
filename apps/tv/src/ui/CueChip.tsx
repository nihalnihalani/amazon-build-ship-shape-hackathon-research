import * as React from 'react';
import { View } from 'react-native';
import type { CueChip as CueChipView } from '@atr/session-core';
import { text } from '../copy';
import { colors } from '../theme';
import { AppText } from './AppText';
import { useUiScale } from './scale';
import { useNow } from './useNow';
import { statusA11y } from './visualOnly';

/**
 * Neutral cue chip, hidden once its expiry time passes (3 s after arrival). Never alters a verdict. Visual only
 * while a window is open (A8-01).
 */
export function CueChip({ cue, capturing = false }: { cue: CueChipView; capturing?: boolean }): React.ReactElement | null {
  const ui = useUiScale();
  const now = useNow(250);
  if (now >= cue.expiresAt) return null;
  const label = text.cuePrefix + ': ' + cue.text;
  return (
    <View
      testID="cue-chip"
      {...statusA11y(capturing, label)}
      style={{ borderWidth: 3, borderColor: colors.neutral, borderRadius: ui.size(16), paddingHorizontal: ui.space(24), paddingVertical: ui.space(8) }}
    >
      <AppText kind="label">{label}</AppText>
    </View>
  );
}
