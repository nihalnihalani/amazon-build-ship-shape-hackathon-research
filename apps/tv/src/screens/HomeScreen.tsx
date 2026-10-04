import * as React from 'react';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';

/** Home: a vertical list of controls, the preferred one first. Back here does nothing destructive. */
export function HomeScreen(props: ScreenProps): React.ReactElement {
  return <ScreenFrame {...props} actionsDirection="column" />;
}

/** First-launch statement shown full screen; body text is set larger than elsewhere. */
export function OnboardingScreen(props: ScreenProps): React.ReactElement {
  return <ScreenFrame {...props} bodyKind="label" actionsDirection="column" />;
}
