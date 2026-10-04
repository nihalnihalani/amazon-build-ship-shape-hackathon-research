import { useRef } from 'react';
import { useTVEventHandler } from '@amazon-devices/react-native-kepler';
import type { TvInput, TvView } from '@atr/session-core';
import { isKeyDown, mapRemoteEvent, shouldForwardRemoteKey } from './remoteKeys';

/** Subscribes to remote events and forwards the ones the session store should see (see remoteKeys.ts). */
export function useRemoteInput(view: TvView, dispatch: (input: TvInput) => void): void {
  const viewRef = useRef(view);
  viewRef.current = view;
  useTVEventHandler((event) => {
    if (!isKeyDown(event)) return;
    const key = mapRemoteEvent(event);
    if (key === null) return;
    if (!shouldForwardRemoteKey(viewRef.current, key)) return;
    dispatch({ kind: 'remote', key });
  });
}
