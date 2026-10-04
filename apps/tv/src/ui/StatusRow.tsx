import * as React from 'react';
import { View } from 'react-native';
import type { LinkView, MicView } from '@atr/session-core';
import { linkText, micText, text } from '../copy';
import { colors } from '../theme';
import { AppText } from './AppText';
import { useUiScale } from './scale';
import { statusA11y } from './visualOnly';

function Chip({
  id,
  label,
  value,
  color,
  capturing,
}: {
  id: string;
  label: string;
  value: string;
  color: string;
  capturing: boolean;
}): React.ReactElement {
  const ui = useUiScale();
  return (
    <View
      testID={id}
      nativeID={id}
      {...statusA11y(capturing, label + ': ' + value)}
      style={{
        borderWidth: 2,
        borderColor: color,
        borderRadius: ui.size(12),
        flexShrink: 1,
        paddingHorizontal: ui.space(20),
        paddingVertical: ui.space(8),
        marginRight: ui.space(24),
        marginBottom: ui.space(8),
      }}
    >
      <AppText kind="body" color={color}>
        {label + ': ' + value}
      </AppText>
    </View>
  );
}

/** Phone microphone state and relay link, always as words. Never says "off" without phone acknowledgement. */
export function StatusRow({ mic, link, capturing = false }: { mic: MicView; link: LinkView; capturing?: boolean }): React.ReactElement {
  const micColor = mic === 'measuring' ? colors.reached : mic === 'not_paired' || mic === 'off' ? colors.neutral : colors.below;
  const linkColor = link === 'connected' ? colors.reached : link === 'offline' ? colors.neutral : colors.below;
  return (
    <View testID="status-row" style={{ flexDirection: 'row', flexWrap: 'wrap', flexShrink: 1 }}>
      <Chip id="status-mic" label={text.statusPhoneMic} value={micText(mic)} color={micColor} capturing={capturing} />
      <Chip id="status-link" label={text.statusRelay} value={linkText(link)} color={linkColor} capturing={capturing} />
    </View>
  );
}
