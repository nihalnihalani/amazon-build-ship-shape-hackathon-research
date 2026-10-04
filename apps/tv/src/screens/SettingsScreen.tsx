import * as React from 'react';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';

/** Settings: a vertical list of controls whose labels carry their current state (for example family mode on or off). */
export function SettingsScreen(props: ScreenProps): React.ReactElement {
  return <ScreenFrame {...props} actionsDirection="column" />;
}
