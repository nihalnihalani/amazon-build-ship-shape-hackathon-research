import * as React from 'react';
import { View } from 'react-native';
import type { CueChip as CueChipView } from '@atr/session-core';
import { text } from '../copy';
import { colors } from '../theme';
import { AppText } from './AppText';
import { useUiScale } from './scale';
import { useNow } from './useNow';

/** Neutral cue chip, hidden once its expiry time passes (3 s after arrival). Never alters a verdict. */
export function CueChip({ cue }: { cue: CueChipView }): React.ReactElement | null {
  const ui = useUiScale();
  const now = useNow(250);
  if (now >= cue.expiresAt) return null;
  const label = text.cuePrefix + ': ' + cue.text;
  return (
    <View
      testID="cue-chip"
      accessible
     
      aria-label={label}
      style={{ borderWidth: 3, borderColor: colors.neutral, borderRadius: ui.size(16), paddingHorizontal: ui.space(24), paddingVertical: ui.space(8), marginTop: ui.space(16) }}
    >
      <AppText kind="label">{label}</AppText>
    </View>
  );
}
