import * as React from 'react';
import { View } from 'react-native';
import { barHeights } from '@atr/ten-foot-meter';
import type { HistoryDayView } from '@atr/session-core';
import { text } from '../copy';
import { colors, layout } from '../theme';
import { AppText } from '../ui/AppText';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';
import { formatSeconds } from '../ui/TimerDisplay';
import { useUiScale } from '../ui/scale';

/** Bar fraction: reached of scored. null = no session that day (a missing day, never a zero). */
export function dayFraction(day: HistoryDayView): number | null {
  if (day.sessions === null) return null;
  if (day.scored !== null && day.scored > 0 && day.reached !== null) return day.reached / day.scored;
  return 0;
}

/** Words for one day, used for the on-screen caption and the accessibility label. */
export function dayCaption(day: HistoryDayView): string {
  if (day.sessions === null) return text.noSession;
  if (day.scored === null || day.scored === 0 || day.reached === null) return text.noScoredAttempts;
  return day.reached + ' of ' + day.scored + ' reached';
}

export function dayAccessibleLabel(day: HistoryDayView): string {
  const parts = [day.weekdayLabel + ' ' + day.date, dayCaption(day)];
  if (day.sessions !== null) parts.push(day.sessions + (day.sessions === 1 ? ' session' : ' sessions'));
  if (day.longestActiveMs !== null) parts.push('longest steady sound ' + formatSeconds(day.longestActiveMs) + ' seconds');
  if (day.incomplete) parts.push(text.incompleteDay);
  return parts.join(', ');
}

/** Seven bars with weekday labels. Days without a session read "No session"; they are not drawn as zero. */
export function HistoryScreen(props: ScreenProps): React.ReactElement {
  const ui = useUiScale();
  const days = props.view.history ?? [];
  // The bars do not grow with the UI scale (the labels around them do): 220 px, or 180 px at scales of 1.4 and above.
  const maxHeightBase = ui.factor >= layout.largeScaleFactor ? layout.historyBarMaxLarge : layout.historyBarMax;
  const maxHeight = ui.size(maxHeightBase, maxHeightBase);
  const bars = barHeights(days.map(dayFraction), maxHeight, ui.size(8));
  return (
    <ScreenFrame {...props}>
      <View testID="history" style={{ width: '100%' }}>
        <AppText kind="muted" style={{ marginBottom: ui.space(8) }}>
          {text.historyDaysLabel}
        </AppText>
        <View style={{ flexDirection: 'row' }}>
          {days.map((day, index) => {
            const bar = bars[index];
            const missing = bar === undefined || bar.missing;
            return (
              <View
                key={day.date}
                testID={'history-day-' + day.date}
                accessible
               
                aria-label={dayAccessibleLabel(day)}
                style={{ flex: 1, alignItems: 'center', paddingHorizontal: ui.space(6) }}
              >
                <View style={{ height: maxHeight, width: '70%', justifyContent: 'flex-end' }}>
                  {missing ? null : (
                    <View
                      testID={'history-bar-' + day.date}
                      style={{
                        height: bar.height,
                        backgroundColor: day.incomplete ? 'transparent' : colors.arcFill,
                        borderWidth: 4,
                        borderColor: colors.arcFill,
                        borderStyle: day.incomplete ? 'dashed' : 'solid',
                        borderRadius: ui.size(6),
                      }}
                    />
                  )}
                </View>
                <AppText testID={'history-caption-' + day.date} kind="body" center color={missing ? colors.neutral : colors.text}>
                  {dayCaption(day)}
                </AppText>
                <AppText kind="label" center>
                  {day.weekdayLabel}
                </AppText>
                {day.longestActiveMs !== null ? (
                  <AppText kind="footer" center>
                    {formatSeconds(day.longestActiveMs) + ' s'}
                  </AppText>
                ) : null}
                {day.incomplete ? (
                  <AppText kind="footer" center color={colors.below}>
                    {text.incompleteDay}
                  </AppText>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    </ScreenFrame>
  );
}
