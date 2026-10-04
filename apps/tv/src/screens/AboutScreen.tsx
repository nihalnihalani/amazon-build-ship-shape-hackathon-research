import * as React from 'react';
import { View } from 'react-native';
import { APP_VERSION } from '../config';
import { text } from '../copy';
import { AppText } from '../ui/AppText';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';
import { useUiScale } from '../ui/scale';

/** About: version, the unencrypted-storage disclosure (ADR-0005) and licence notices. */
export function AboutScreen(props: ScreenProps): React.ReactElement {
  const ui = useUiScale();
  return (
    <ScreenFrame {...props} hideStatus>
      <View testID="about" style={{ width: '100%' }}>
        <AppText testID="about-version" kind="label">
          {text.aboutVersion + ' ' + APP_VERSION}
        </AppText>
        <AppText testID="about-storage" kind="body" style={{ marginTop: ui.space(16) }}>
          {text.aboutStorage}
        </AppText>
        <AppText kind="label" style={{ marginTop: ui.space(24) }}>
          {text.aboutLicenseHeading}
        </AppText>
        {text.aboutLicenses.map((line) => (
          <AppText key={line} testID="about-license" kind="body">
            {line}
          </AppText>
        ))}
      </View>
    </ScreenFrame>
  );
}
