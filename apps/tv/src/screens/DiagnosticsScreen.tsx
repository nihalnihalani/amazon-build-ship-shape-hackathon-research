import * as React from 'react';
import { View } from 'react-native';
import { text } from '../copy';
import { AppText } from '../ui/AppText';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';

/** Diagnostics: the key / value pairs the session core exposes, sorted by key. Shows no secrets by construction. */
export function DiagnosticsScreen(props: ScreenProps): React.ReactElement {
  const entries = props.view.diagnostics === null ? [] : Object.entries(props.view.diagnostics).sort(([a], [b]) => a.localeCompare(b));
  return (
    <ScreenFrame {...props} hideStatus>
      <View testID="diagnostics" style={{ width: '100%' }}>
        {entries.length === 0 ? (
          <AppText testID="diagnostics-empty" kind="body">
            {text.diagnosticsEmpty}
          </AppText>
        ) : (
          entries.map(([key, value]) => (
            <AppText key={key} testID="diagnostics-entry" kind="body">
              {key + ': ' + value}
            </AppText>
          ))
        )}
      </View>
    </ScreenFrame>
  );
}
