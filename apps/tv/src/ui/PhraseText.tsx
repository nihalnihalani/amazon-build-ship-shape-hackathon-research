import * as React from 'react';
import { useWindowDimensions } from 'react-native';
import { fitPhrase } from '../layout/fitPhrase';
import { layout } from '../theme';
import { AppText } from './AppText';
import { useUiScale } from './scale';

/** The phrase to say: 72 to 96 px, auto-shrunk so it stays within two lines. Never truncated. */
export function PhraseText({ phrase }: { phrase: string }): React.ReactElement {
  const ui = useUiScale();
  const { width } = useWindowDimensions();
  const available = Math.max(200, width - 2 * ui.space(layout.pagePadding));
  const fitted = fitPhrase(phrase, available, ui.text(100) / 100);
  return (
    <AppText testID="phrase-text" nativeID="atr-phrase-text" kind="title" baseSize={fitted.baseSize} center>
      {phrase}
    </AppText>
  );
}
