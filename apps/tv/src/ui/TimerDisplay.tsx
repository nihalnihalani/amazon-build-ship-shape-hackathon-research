import * as React from 'react';
import { View } from 'react-native';
import type { TimerView } from '@atr/session-core';
import { text } from '../copy';
import { colors } from '../theme';
import { AppText } from './AppText';
import { useUiScale } from './scale';

/** Seconds with one decimal, e.g. 14.2. Negative or non-finite input shows 0.0. */
export function formatSeconds(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return (Math.floor(safe / 100) / 10).toFixed(1);
}

/** Whole seconds remaining for a countdown, rounded up, never below 0. */
export function remainingSeconds(timer: TimerView): number {
  if (timer.maxMs === null) return 0;
  return Math.max(0, Math.ceil((timer.maxMs - timer.elapsedMs) / 1000));
}

/**
 * Timer readout. With a maximum it counts down in whole seconds and draws a shrinking bar; without one it
 * counts up (sustained sound). Hidden from the screen-reader tree while a window is open so it never talks
 * over the measurement.
 */
export function TimerDisplay({ timer, capturing }: { timer: TimerView; capturing: boolean }): React.ReactElement {
  const ui = useUiScale();
  const countdown = timer.maxMs !== null;
  const shown = countdown ? String(remainingSeconds(timer)) : formatSeconds(timer.elapsedMs);
  const fraction = countdown && timer.maxMs !== null && timer.maxMs > 0 ? Math.min(1, Math.max(0, 1 - timer.elapsedMs / timer.maxMs)) : 0;
  const barWidth = ui.size(480);
  return (
    <View
      testID="timer"
      accessible={!capturing}
      role="timer"
      aria-label={timer.label + ': ' + shown + ' ' + text.timerSeconds}
      aria-hidden={capturing}
      importantForAccessibility={capturing ? 'no-hide-descendants' : 'auto'}
      style={{ alignItems: 'center' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <AppText testID="timer-value" kind="counter">
          {shown}
        </AppText>
        <AppText kind="label" style={{ marginLeft: ui.space(12), marginBottom: ui.space(20) }}>
          {text.timerSeconds}
        </AppText>
      </View>
      <AppText testID="timer-label" kind="muted" center>
        {timer.label + (countdown ? ' (' + text.timerRemaining + ')' : '')}
      </AppText>
      {countdown ? (
        <View
          testID="timer-bar"
          style={{ width: barWidth, height: ui.size(16), marginTop: ui.space(12), backgroundColor: colors.arcTrack, borderRadius: ui.size(8) }}
        >
          <View
            testID="timer-bar-fill"
            style={{ width: Math.round(barWidth * fraction), height: ui.size(16), backgroundColor: colors.arcFill, borderRadius: ui.size(8) }}
          />
        </View>
      ) : null}
    </View>
  );
}
