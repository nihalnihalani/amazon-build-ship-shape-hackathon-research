import * as React from 'react';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';

/**
 * Settings: controls whose labels carry their current state (for example family mode on or off). Up to four
 * stack in a column; more wrap into rows so the list fits one 1080 px screen.
 */
export function SettingsScreen(props: ScreenProps): React.ReactElement {
  return <ScreenFrame {...props} actionsDirection={props.view.actions.length > 4 ? 'row' : 'column'} />;
}
