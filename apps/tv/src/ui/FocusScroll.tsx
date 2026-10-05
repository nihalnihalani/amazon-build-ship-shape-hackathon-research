import * as React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { ScrollView } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { createFocusScroller } from './focusScroller';
import type { FocusScroller, Rect } from './focusScroller';
import { useUiScale } from './scale';

interface FocusScrollApi {
  /** A control received focus: bring it fully on screen if the screen is scrolled. */
  onControlFocus(node: unknown): void;
}

const FocusScrollContext = createContext<FocusScrollApi | null>(null);

/** Controls call this from onFocus. Null outside a FocusScrollView (nothing to scroll). */
export function useFocusScrollApi(): FocusScrollApi | null {
  return useContext(FocusScrollContext);
}

type Measurable = { measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void } | null;

function measure(node: unknown): Promise<Rect | null> {
  const target = node as Measurable;
  return new Promise((resolve) => {
    if (target === null || target === undefined || typeof target.measureInWindow !== 'function') {
      resolve(null);
      return;
    }
    target.measureInWindow((_x, y, _width, height) => resolve({ top: y, height }));
  });
}

/** How long to wait for the focus engine to move focus before treating an Up/Down key as "no neighbour". */
export const FOCUS_SETTLE_MS = 120;

/**
 * Vertical scroll container for a screen's content, with focus-driven scrolling. The footer lives outside it, so
 * it is always visible. Two things move the content:
 *  1. a control receiving focus is scrolled fully into view (works for any control, whatever the platform does);
 *  2. Up or Down with no control to move to scrolls one page, so text above the first control (or below the last)
 *     can still be read. "No control to move to" = the focus engine did not move focus within FOCUS_SETTLE_MS.
 * With content that fits (scale 1.0, most screens) nothing scrolls and nothing changes.
 */
export function FocusScrollView({
  children,
  enabled = true,
  resetKey,
}: {
  children: React.ReactNode;
  enabled?: boolean;
  /** When this changes (a new screen or stage) the content scrolls back to the top. */
  resetKey?: string;
}): React.ReactElement {
  const ui = useUiScale();
  const scrollRef = useRef<ScrollView>(null);
  const marginRef = useRef(ui.space(32));
  marginRef.current = ui.space(32);
  const focusEpoch = useRef(0);
  const scroller: FocusScroller = useMemo(
    () =>
      createFocusScroller({
        measureViewport: () => measure(scrollRef.current),
        measureNode: measure,
        scrollTo: (y) => scrollRef.current?.scrollTo({ y, animated: false }),
        margin: () => marginRef.current,
      }),
    [],
  );

  const api = useMemo<FocusScrollApi>(
    () => ({
      onControlFocus(node) {
        focusEpoch.current += 1;
        void scroller.reveal(node);
      },
    }),
    [scroller],
  );

  useEffect(() => {
    scroller.reset();
  }, [resetKey, scroller]);

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current);
    },
    [],
  );
  useTVEventHandler((event) => {
    if (!enabled || (event.eventKeyAction !== undefined && event.eventKeyAction !== 0)) return;
    if (event.eventType !== 'up' && event.eventType !== 'down') return;
    if (!scroller.overflowing) return;
    const direction = event.eventType;
    const epoch = focusEpoch.current;
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      if (focusEpoch.current === epoch) scroller.page(direction);
    }, FOCUS_SETTLE_MS);
  });

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => scroller.setOffset(event.nativeEvent.contentOffset.y),
    [scroller],
  );

  return (
    <FocusScrollContext.Provider value={api}>
      <ScrollView
        ref={scrollRef}
        testID="screen-scroll"
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        focusable={false}
        showsVerticalScrollIndicator={false}
        bounces={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onContentSizeChange={(_w, h) => scroller.setContentHeight(h)}
        onLayout={(event) => scroller.setViewportHeight(event.nativeEvent.layout.height)}
      >
        {children}
      </ScrollView>
    </FocusScrollContext.Provider>
  );
}
