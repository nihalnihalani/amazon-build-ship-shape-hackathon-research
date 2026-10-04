import { useEffect } from 'react';
import { KeplerA11ySettingsInterface } from '@amazon-devices/kepler-a11y-settings-interface-turbo';
import type { TvInput } from '@atr/session-core';

/**
 * Reports the platform screen-reader state to the session store as `{ kind: 'a11y', screenReader }` (A8-02),
 * so the store can lengthen the quiet lead and add the spoken-script wording when VoiceView is on.
 *
 * READ-ONLY use of @amazon-devices/kepler-a11y-settings-interface-turbo (installed 1.0.0 type definitions):
 *   isScreenReaderEnabled(): Promise<boolean>                      initial state, dispatched at start
 *   addScreenReaderStateListener(handler): Promise<boolean>        true when a listener now exists
 *   removeScreenReaderStateListener(): Promise<void>               cleanup
 * The setters (setScreenReaderEnabled and friends) are never called: the app never changes a user setting and
 * never turns VoiceView off (ADR-0008). Changes are dispatched only when the listener was registered; if
 * registration reports failure, only the initial state is known and no later change can be observed.
 */
export function useScreenReaderState(dispatch: (input: TvInput) => void): void {
  useEffect(() => {
    let alive = true;
    let listening = false;
    const report = (screenReader: boolean): void => {
      if (alive) dispatch({ kind: 'a11y', screenReader });
    };
    KeplerA11ySettingsInterface.isScreenReaderEnabled().then(report, () => undefined);
    KeplerA11ySettingsInterface.addScreenReaderStateListener(report).then(
      (registered) => {
        listening = registered;
        // Unmounted while registering: take the listener straight back off.
        if (!alive && registered) void KeplerA11ySettingsInterface.removeScreenReaderStateListener().catch(() => undefined);
      },
      () => undefined,
    );
    return () => {
      alive = false;
      if (listening) void KeplerA11ySettingsInterface.removeScreenReaderStateListener().catch(() => undefined);
    };
  }, [dispatch]);
}
