import { useEffect, useState } from 'react';
import type { SessionStore, TvView } from '@atr/session-core';

/**
 * Subscribes to the session store and returns the latest view. State-based (not useSyncExternalStore) so a
 * getView() that builds a fresh object on every call cannot cause a render loop; the store notifies on every
 * change and the effect re-reads once after subscribing to close the gap between render and subscription.
 */
export function useSessionView(store: SessionStore): TvView {
  const [view, setView] = useState<TvView>(() => store.getView());
  useEffect(() => {
    setView(store.getView());
    return store.subscribe(setView);
  }, [store]);
  return view;
}
