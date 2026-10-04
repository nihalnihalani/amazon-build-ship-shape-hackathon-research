import * as React from 'react';
import type { TvView } from '@atr/session-core';
import { ArcMeter } from './ArcMeter';

/**
 * Mounts the arc ONLY when the view carries a meter. The session core removes the meter from the view for
 * hidden first attempts, so in that case nothing meter-related exists in the tree.
 */
export function MeterBlock({ view }: { view: TvView }): React.ReactElement | null {
  if (view.meter === null) return null;
  return <ArcMeter meter={view.meter} capturing={view.capturing} />;
}
