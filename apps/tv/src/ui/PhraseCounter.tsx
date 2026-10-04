import * as React from 'react';
import type { TvView } from '@atr/session-core';
import { text } from '../copy';
import { colors } from '../theme';
import { AppText } from './AppText';

/** "3 of 10" with "Attempt 2" after a retry. */
export function PhraseCounter({ phrase }: { phrase: NonNullable<TvView['phrase']> }): React.ReactElement {
  const attempt = phrase.attemptNumber > 1 ? ' · ' + text.phraseAttempt + ' ' + phrase.attemptNumber : '';
  return (
    <AppText testID="phrase-counter" kind="label" color={colors.textMuted} center>
      {phrase.position + ' ' + text.phraseOf + ' ' + phrase.total + attempt}
    </AppText>
  );
}
