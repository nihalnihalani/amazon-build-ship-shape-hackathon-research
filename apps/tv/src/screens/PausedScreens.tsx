import * as React from 'react';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';

/** Paused or invalid: what happened and how to continue, in words (title, banner, body come from the view). */
export function PausedOrInvalidScreen(props: ScreenProps): React.ReactElement {
  return <ScreenFrame {...props} />;
}

/** After an interrupted session: Resume or Discard. Focus order and the preferred control come from the view. */
export function ResumeOrDiscardScreen(props: ScreenProps): React.ReactElement {
  return <ScreenFrame {...props} />;
}
