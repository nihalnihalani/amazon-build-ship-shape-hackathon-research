import * as React from 'react';
import { View } from 'react-native';
import { toneShape } from '@atr/ten-foot-meter';
import type { ResultView } from '@atr/session-core';
import { colors } from '../theme';
import { AppText } from './AppText';
import { ToneGlyph } from './ToneGlyph';
import { useUiScale } from './scale';

const toneColor = {
  reached: colors.reached,
  below: colors.below,
  not_scored: colors.neutral,
  neutral: colors.neutral,
} as const;

/**
 * Result of an attempt: shape icon, mandatory text label and optional detail lines. The tone colour is
 * decoration only; the label and the shape (check / ring / dash / dot) always carry the result.
 */
export function ResultBadge({ result }: { result: ResultView }): React.ReactElement {
  const ui = useUiScale();
  const color = toneColor[result.tone];
  // The store writes every sentence of the result (label, detail incl. the borderline note, listener answer and
  // the speaker's rating with their own prefixes); the UI renders them verbatim and adds no wording of its own.
  const summary = [result.label, result.detail, result.speakerRating, result.listener]
    .filter((part): part is string => part !== null && part.length > 0)
    .join('. ');
  return (
    <View testID="result" nativeID="atr-result" accessible role="summary" aria-label={summary} style={{ alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <ToneGlyph testID="result-glyph" shape={toneShape(result.tone)} color={color} baseSize={96} />
        <AppText testID="result-label" kind="title" color={color} style={{ marginLeft: ui.space(32) }}>
          {result.label}
        </AppText>
      </View>
      {result.detail !== null && result.detail.length > 0 ? (
        <AppText testID="result-detail" kind="label" center style={{ marginTop: ui.space(12) }}>
          {result.detail}
        </AppText>
      ) : null}
      {result.speakerRating !== null ? (
        <AppText testID="result-rating" kind="body" center style={{ marginTop: ui.space(8) }}>
          {result.speakerRating}
        </AppText>
      ) : null}
      {result.listener !== null ? (
        <AppText testID="result-listener" kind="body" center>
          {result.listener}
        </AppText>
      ) : null}
    </View>
  );
}
