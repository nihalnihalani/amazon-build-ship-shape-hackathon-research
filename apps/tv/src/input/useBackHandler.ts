import { useEffect } from 'react';
import { BackHandler } from 'react-native';
import type { TvInput } from '@atr/session-core';

/**
 * Hardware Back goes to the session store as `remote back` and is always consumed (return true): Back
 * means "one screen up" and never exits the app or does anything destructive; Home leaves the app.
 */
export function useBackHandler(dispatch: (input: TvInput) => void): void {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dispatch({ kind: 'remote', key: 'back' });
      return true;
    });
    return () => subscription.remove();
  }, [dispatch]);
}
