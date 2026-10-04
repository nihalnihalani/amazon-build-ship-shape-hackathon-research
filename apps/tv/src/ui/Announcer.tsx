import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';

export interface AnnouncerProps {
  announcement: string | null;
  capturing: boolean;
}

const hidden = StyleSheet.create({
  region: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
});

/**
 * Screen-reader live region (aria-live polite). Routine announcements are suppressed while a precheck or
 * capture window is open (ADR-0008): the region stays mounted but empty and is switched off, so nothing is
 * spoken over the measurement. It never carries level or verdict text before reveal because the view does
 * not contain any.
 */
export function Announcer({ announcement, capturing }: AnnouncerProps): React.ReactElement {
  const text = !capturing && announcement !== null && announcement.length > 0 ? announcement : null;
  return (
    <View testID="live-region" aria-live={capturing ? 'off' : 'polite'} style={hidden.region} pointerEvents="none">
      {text !== null ? <AppText testID="live-region-text">{text}</AppText> : null}
    </View>
  );
}
