// Jest stand-in for @amazon-devices/react-native-kepler (the Vega React Native fork).
// Only the exports the app uses are provided: TVFocusGuideView and useTVEventHandler.
import * as React from 'react';
import { View } from 'react-native';
import type { ViewProps } from 'react-native';

export interface MockHWEvent {
  eventType: string;
  eventKeyAction?: number;
}

type Handler = (event: MockHWEvent) => void;
const handlers = new Set<{ current: Handler }>();

export function resetKeplerMock(): void {
  handlers.clear();
}

/** Test helper: deliver a remote event to every mounted useTVEventHandler. */
export function emitTVEvent(event: MockHWEvent): void {
  for (const entry of Array.from(handlers)) entry.current(event);
}

export function mountedTVEventHandlerCount(): number {
  return handlers.size;
}

export function useTVEventHandler(handler: Handler): void {
  const ref = React.useRef<Handler>(handler);
  ref.current = handler;
  React.useEffect(() => {
    const entry = { current: (event: MockHWEvent) => ref.current(event) };
    handlers.add(entry);
    return () => {
      handlers.delete(entry);
    };
  }, []);
}

export interface MockFocusGuideProps extends ViewProps {
  autoFocus?: boolean;
  trapFocusUp?: boolean;
  trapFocusDown?: boolean;
  trapFocusLeft?: boolean;
  trapFocusRight?: boolean;
  enabled?: boolean;
  destinations?: unknown[];
}

export const TVFocusGuideView = React.forwardRef<View, MockFocusGuideProps>(function TVFocusGuideView(
  props,
  ref,
) {
  // The focus-guide props (autoFocus, trapFocus*, destinations) are read in tests from the composite
  // element via UNSAFE_getByType(TVFocusGuideView).props; they are not forwarded to the host View.
  const { autoFocus, trapFocusUp, trapFocusDown, trapFocusLeft, trapFocusRight, enabled, destinations, ...rest } =
    props;
  void autoFocus;
  void trapFocusUp;
  void trapFocusDown;
  void trapFocusLeft;
  void trapFocusRight;
  void enabled;
  void destinations;
  return <View ref={ref} {...rest} />;
});
