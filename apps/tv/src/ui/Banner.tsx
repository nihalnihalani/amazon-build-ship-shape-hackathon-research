import * as React from 'react';
import { View } from 'react-native';
import { bannerPrefix } from '../copy';
import { colors } from '../theme';
import { AppText } from './AppText';
import { useUiScale } from './scale';
import { statusA11y } from './visualOnly';

const toneColor = { info: colors.textMuted, warning: colors.below, error: colors.danger } as const;

/**
 * Banner with a word prefix (Note / Warning / Problem) so severity never depends on colour. Plain text role on
 * purpose: an alert role would be announced immediately, including while a window is open (ADR-0008).
 */
export function Banner({
  banner,
  capturing = false,
}: {
  banner: { kind: 'info' | 'warning' | 'error'; text: string };
  /** While a window is open the banner is visual only (A8-01). */
  capturing?: boolean;
}): React.ReactElement {
  const ui = useUiScale();
  const label = bannerPrefix[banner.kind] + ': ' + banner.text;
  return (
    <View
      testID="banner"
      {...statusA11y(capturing, label)}
      style={{
        borderLeftWidth: ui.size(10),
        borderLeftColor: toneColor[banner.kind],
        paddingLeft: ui.space(24),
        paddingVertical: ui.space(8),
        marginBottom: ui.space(16),
      }}
    >
      <AppText kind="body">{label}</AppText>
    </View>
  );
}
