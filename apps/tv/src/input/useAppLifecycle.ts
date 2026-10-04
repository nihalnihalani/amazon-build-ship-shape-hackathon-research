import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { TvInput } from '@atr/session-core';

/** Reports launch once and then foreground / background transitions to the session store. */
export function useAppLifecycle(dispatch: (input: TvInput) => void): void {
  useEffect(() => {
    dispatch({ kind: 'app', event: 'launched' });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') dispatch({ kind: 'app', event: 'foregrounded' });
      else dispatch({ kind: 'app', event: 'backgrounded' });
    });
    return () => subscription.remove();
  }, [dispatch]);
}
