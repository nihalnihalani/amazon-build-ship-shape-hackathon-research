import * as React from 'react';
import { View } from 'react-native';
import { APP_VERSION } from '../config';
import { text } from '../copy';
import { AppText } from '../ui/AppText';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';
import { useUiScale } from '../ui/scale';

/**
 * About. The privacy and storage disclosure (what is kept on the TV, what the TV tells the relay, abuse counters, phone
 * qualification) is rendered from view.body, the single source in session-core; this screen holds no copy of it.
 * It adds only what the session core does not carry: the licence notices, and the app version when the view body
 * has no "Version" line of its own.
 */
export function AboutScreen(props: ScreenProps): React.ReactElement {
  const ui = useUiScale();
  const bodyHasVersion = props.view.body.some((line) => line.startsWith(text.aboutVersion + ' '));
  return (
    <ScreenFrame {...props} hideStatus>
      <View testID="about" style={{ width: '100%' }}>
        {bodyHasVersion ? null : (
          <AppText testID="about-version" kind="label">
            {text.aboutVersion + ' ' + APP_VERSION}
          </AppText>
        )}
        <AppText testID="about-license" kind="body" style={{ marginTop: ui.space(6) }}>
          {text.aboutLicences}
        </AppText>
      </View>
    </ScreenFrame>
  );
}
