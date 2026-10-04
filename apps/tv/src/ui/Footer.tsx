import * as React from 'react';
import { View } from 'react-native';
import { FOOTER_FALLBACK } from '../copy';
import { colors } from '../theme';
import { AppText } from './AppText';
import { useUiScale } from './scale';

/** Present on every screen. The text comes from the view; an empty footer falls back to the fixed statement. */
export function Footer({ text }: { text: string }): React.ReactElement {
  const ui = useUiScale();
  const shown = text.trim().length > 0 ? text : FOOTER_FALLBACK;
  return (
    <View
      testID="footer-bar"
      style={{ borderTopWidth: 2, borderTopColor: colors.arcTrack, paddingTop: ui.space(16), marginTop: ui.space(16) }}
    >
      <AppText testID="footer" kind="footer">
        {shown}
      </AppText>
    </View>
  );
}
