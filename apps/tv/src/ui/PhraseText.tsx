import * as React from 'react';
import { useWindowDimensions } from 'react-native';
import { fitPhrase } from '../layout/fitPhrase';
import { layout } from '../theme';
import { AppText } from './AppText';
import { useUiScale } from './scale';

/** Largest drawn size of the phrase at any UI scale. */
export const PHRASE_MAX_PX = 108;

/** The phrase to say: 72 to 96 px, auto-shrunk so it stays within two lines. Never truncated. */
export function PhraseText({ phrase }: { phrase: string }): React.ReactElement {
  const ui = useUiScale();
  const { width } = useWindowDimensions();
  const available = Math.max(200, width - 2 * ui.space(layout.pagePadding));
  // Display-size phrase text is capped at 108 px at large UI scales (the fit uses the capped pixel size).
  const fitted = fitPhrase(phrase, available, (base) => ui.text(base, PHRASE_MAX_PX));
  return (
    <AppText testID="phrase-text" nativeID="atr-phrase-text" kind="title" baseSize={fitted.baseSize} maxSize={PHRASE_MAX_PX} center>
      {phrase}
    </AppText>
  );
}
