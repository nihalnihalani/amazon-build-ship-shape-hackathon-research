import * as React from 'react';
import { View } from 'react-native';
import type { SummaryView } from '@atr/session-core';
import { text } from '../copy';
import { AppText } from '../ui/AppText';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';
import { formatSeconds } from '../ui/TimerDisplay';
import { useUiScale } from '../ui/scale';

function agreementLine(label: string, agreement: { agree: number; eligible: number }): string {
  if (agreement.eligible === 0) return label + ': ' + text.noEligibleListener;
  return label + ': agreed on ' + agreement.agree + ' of ' + agreement.eligible;
}

/**
 * Every count the summary shows carries its denominator. Zero eligible listener responses is stated in words,
 * never shown as 0 of 0. Incomplete sessions are labelled and never compared with completed ones. One short
 * line per statistic (related counts share a line) so the summary fits a screen at UI scales up to 1.25. The
 * wording follows ADR-0001 section 8: a relative level band, never "loud enough" or "heard".
 */
export function summaryLines(summary: SummaryView): string[] {
  const lines: string[] = [];
  lines.push(summary.complete ? text.summaryComplete : text.summaryIncomplete);
  lines.push('Phrases completed: ' + summary.phrasesCompleted + ' of ' + summary.phrasesAttempted + ' attempted, ' + summary.phrasesSkipped + ' skipped');
  const reasons = Object.keys(summary.invalidReasons)
    .sort()
    .map((reason) => reason.replace(/_/g, ' ') + ' ' + summary.invalidReasons[reason]);
  lines.push('Attempts not scored: ' + summary.attemptsInvalid + (reasons.length > 0 ? ' (' + reasons.join(', ') + ')' : ''));
  lines.push(text.reachedBand + ', blind checks: ' + summary.reachedHidden + ' of ' + summary.scoredHidden);
  lines.push(text.reachedBand + ', other phrases: ' + summary.reachedVisible + ' of ' + summary.scoredVisible);
  lines.push(
    'Longest steady sound: ' + (summary.longestActiveMs === null ? 'none recorded' : formatSeconds(summary.longestActiveMs) + ' s'),
  );
  const ratingsTotal = summary.hiddenRatings.feltLoud + summary.hiddenRatings.feltNormal + summary.hiddenRatings.skipped;
  lines.push(
    'Blind check ratings (' + ratingsTotal + '): felt loud ' + summary.hiddenRatings.feltLoud + ', felt normal ' +
      summary.hiddenRatings.feltNormal + ', skipped ' + summary.hiddenRatings.skipped,
  );
  lines.push(agreementLine('Meter and listener, blind checks', summary.agreementHidden));
  lines.push(agreementLine('Meter and listener, other phrases', summary.agreementVisible));
  lines.push(
    'Late listener responses (not counted in agreement): ' + summary.lateListenerResponses + '. Borderline results: ' + summary.borderlineCount,
  );
  if (summary.calibrationMarginDb !== null) {
    lines.push('Band margin today: ' + summary.calibrationMarginDb + ' dB above room noise (relative, not sound level)');
  }
  return lines;
}

export function SummaryScreen(props: ScreenProps): React.ReactElement {
  const ui = useUiScale();
  const summary = props.view.summary;
  const lines = summary === null ? [] : summaryLines(summary);
  return (
    <ScreenFrame {...props}>
      {summary !== null ? (
        <View testID="summary" style={{ width: '100%' }}>
          {lines.map((line, index) => (
            <AppText key={index + ':' + line} testID="summary-line" kind="body" style={{ marginBottom: ui.space(2) }}>
              {line}
            </AppText>
          ))}
          {summary.lines.length > 0 ? (
            <View testID="summary-notes" style={{ marginTop: ui.space(6) }}>
              {summary.lines.map((line, index) => (
                <AppText key={index + ':' + line} kind="muted">
                  {line}
                </AppText>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </ScreenFrame>
  );
}
