// "@amazon-devices/react-native-kepler" for the web preview.
//  - TVFocusGuideView renders a plain View (data attributes expose the guide props to tests); trapFocus is
//    enforced by the spatial navigation below when a trapped guide contains the focused control.
//  - useTVEventHandler listens to the keyboard and emits Vega-style remote events:
//      ArrowUp/Down/Left/Right -> up/down/left/right, Enter -> select, Escape or Backspace -> back,
//      Space or P -> playpause. Arrows also move DOM focus between role="button" controls (spatial).
//    Each key produces a key-down (eventKeyAction 0) followed by a key-up (1), like the device.
import * as React from 'react';
import { View } from 'react-native-web';
import { pressHardwareBack } from './react-native';

export interface HWEvent {
  eventType: string;
  eventKeyAction?: number;
}

type Handler = (event: HWEvent) => void;
const handlers = new Set<{ current: Handler }>();
let installed = false;

const KEY_TO_EVENT: Record<string, string> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'select',
  Escape: 'back',
  Backspace: 'back',
  ' ': 'playpause',
  p: 'playpause',
};

function focusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="button"]:not([aria-disabled="true"])'));
}

function center(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Nearest control in a direction (simple spatial navigation, restricted to a trapped guide if there is one). */
function moveFocus(direction: 'up' | 'down' | 'left' | 'right'): void {
  const all = focusables();
  if (all.length === 0) return;
  const current = document.activeElement instanceof HTMLElement && all.includes(document.activeElement) ? document.activeElement : null;
  if (current === null) {
    (all.find((el) => el.dataset['preferredFocus'] === 'true') ?? all[0])?.focus();
    return;
  }
  const trap = current.closest('[data-trap-focus="true"]');
  const pool = trap === null ? all : all.filter((el) => trap.contains(el));
  const from = center(current);
  let best: { el: HTMLElement; score: number } | null = null;
  for (const el of pool) {
    if (el === current) continue;
    const c = center(el);
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    const forward = direction === 'up' ? -dy : direction === 'down' ? dy : direction === 'left' ? -dx : dx;
    if (forward <= 1) continue;
    const lateral = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = forward + 2 * lateral;
    if (best === null || score < best.score) best = { el, score };
  }
  best?.el.focus();
}

function install(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (event) => {
    const type = KEY_TO_EVENT[event.key];
    if (type === undefined || event.repeat) return;
    if (type === 'up' || type === 'down' || type === 'left' || type === 'right') {
      event.preventDefault();
      moveFocus(type);
    }
    if (type === 'back') {
      event.preventDefault();
      pressHardwareBack();
    }
    for (const entry of Array.from(handlers)) entry.current({ eventType: type, eventKeyAction: 0 });
  });
  window.addEventListener('keyup', (event) => {
    const type = KEY_TO_EVENT[event.key];
    if (type === undefined) return;
    for (const entry of Array.from(handlers)) entry.current({ eventType: type, eventKeyAction: 1 });
  });
}

export function useTVEventHandler(handler: Handler): void {
  const ref = React.useRef<Handler>(handler);
  ref.current = handler;
  React.useEffect(() => {
    install();
    const entry = { current: (event: HWEvent) => ref.current(event) };
    handlers.add(entry);
    return () => {
      handlers.delete(entry);
    };
  }, []);
}

export interface FocusGuideProps extends React.ComponentProps<typeof View> {
  autoFocus?: boolean;
  trapFocusUp?: boolean;
  trapFocusDown?: boolean;
  trapFocusLeft?: boolean;
  trapFocusRight?: boolean;
  enabled?: boolean;
  destinations?: unknown[];
}

export const TVFocusGuideView = React.forwardRef<unknown, FocusGuideProps>(function TVFocusGuideView(props, ref) {
  const { autoFocus, trapFocusUp, trapFocusDown, trapFocusLeft, trapFocusRight, enabled, destinations, ...rest } = props;
  void enabled;
  void destinations;
  const trapped = !!(trapFocusUp && trapFocusDown && trapFocusLeft && trapFocusRight);
  return (
    <View
      {...rest}
      ref={ref as never}
      dataSet={{ focusGuide: 'true', autoFocus: autoFocus ? 'true' : 'false', trapFocus: trapped ? 'true' : 'false' }}
    />
  );
});
