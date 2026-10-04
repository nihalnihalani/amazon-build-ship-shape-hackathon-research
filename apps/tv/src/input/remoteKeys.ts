import type { RemoteKey, TvView } from '@atr/session-core';

/** Shape of a TV remote event as delivered by useTVEventHandler (HWEvent in the installed types). */
export interface RemoteEvent {
  eventType: string;
  /** 0 = key down, 1 = key up (Vega TVTypes.d.ts). Absent is treated as a key down. */
  eventKeyAction?: number;
}

/** Maps a Vega remote event name to the contract's RemoteKey, or null for keys the app does not use. */
export function mapRemoteEvent(event: RemoteEvent): RemoteKey | null {
  switch (event.eventType) {
    case 'select':
    case 'enter':
      return 'ok';
    case 'back':
      return 'back';
    case 'up':
      return 'up';
    case 'down':
      return 'down';
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'playpause':
      return 'play_pause';
    default:
      return null;
  }
}

/** Only the press (key down) is acted on; the release must not repeat the action. */
export function isKeyDown(event: RemoteEvent): boolean {
  return event.eventKeyAction === undefined || event.eventKeyAction === 0;
}

/** True when the screen has at least one control the focus system can reach and press. */
export function hasFocusableActions(view: TvView): boolean {
  if (view.dialog !== null) return true;
  return view.actions.some((action) => action.disabled !== true);
}

/**
 * Decides whether a remote key goes to the session store as a `remote` input.
 *  - Back is delivered through BackHandler only (forwarding it here as well would pop two screens).
 *  - While a focusable control exists, the focus engine owns D-pad movement and OK: OK on a focused
 *    control arrives as that control's onPress (a `ui` input). Forwarding OK too would run the screen's
 *    default action as well as the focused one.
 *  - With nothing focusable (capture windows), every other key goes to the store, which decides.
 */
export function shouldForwardRemoteKey(view: TvView, key: RemoteKey): boolean {
  if (key === 'back') return false;
  return !hasFocusableActions(view);
}
