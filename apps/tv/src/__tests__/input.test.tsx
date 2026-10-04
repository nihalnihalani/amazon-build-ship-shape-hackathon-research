import { AppState, BackHandler } from 'react-native';
import { act, render } from '@testing-library/react-native';
import type { TvInput, TvView } from '@atr/session-core';
import { emitTVEvent, mountedTVEventHandlerCount } from '../../jest/mocks/react-native-kepler';
import { home, phraseActiveHidden, confirmDialogDestructive, makeView } from '../__fixtures__/views';
import { hasFocusableActions, isKeyDown, mapRemoteEvent, shouldForwardRemoteKey } from '../input/remoteKeys';
import { useAppLifecycle } from '../input/useAppLifecycle';
import { useBackHandler } from '../input/useBackHandler';
import { useRemoteInput } from '../input/useRemoteInput';
import { TICK_INTERVAL_MS, useTicker } from '../input/useTicker';

function RemoteHarness({ view, dispatch }: { view: TvView; dispatch: (input: TvInput) => void }) {
  useRemoteInput(view, dispatch);
  return null;
}

describe('mapRemoteEvent: Vega remote events to contract keys', () => {
  it.each([
    ['select', 'ok'],
    ['enter', 'ok'],
    ['back', 'back'],
    ['up', 'up'],
    ['down', 'down'],
    ['left', 'left'],
    ['right', 'right'],
    ['playpause', 'play_pause'],
  ])('%s -> %s', (eventType, key) => {
    expect(mapRemoteEvent({ eventType })).toBe(key);
  });

  it.each(['menu', 'volume_up', 'skip_forward', 'num_1', 'power', ''])('ignores %p', (eventType) => {
    expect(mapRemoteEvent({ eventType })).toBeNull();
  });

  it('acts on key down only (eventKeyAction 0 or absent), never on key up', () => {
    expect(isKeyDown({ eventType: 'select', eventKeyAction: 0 })).toBe(true);
    expect(isKeyDown({ eventType: 'select' })).toBe(true);
    expect(isKeyDown({ eventType: 'select', eventKeyAction: 1 })).toBe(false);
  });
});

describe('who owns a key: focus engine, BackHandler or the session store', () => {
  it('knows when a screen has something focusable', () => {
    expect(hasFocusableActions(home)).toBe(true);
    expect(hasFocusableActions(phraseActiveHidden)).toBe(false);
    expect(hasFocusableActions(confirmDialogDestructive)).toBe(true);
    expect(hasFocusableActions(makeView({ screen: 'home', stage: 'idle', actions: [{ id: 'done', label: 'Done', disabled: true }] }))).toBe(false);
  });

  it('never forwards back (BackHandler owns it) and never forwards keys while controls are focusable', () => {
    for (const key of ['ok', 'up', 'down', 'left', 'right', 'play_pause'] as const) {
      expect(shouldForwardRemoteKey(home, key)).toBe(false);
    }
    expect(shouldForwardRemoteKey(phraseActiveHidden, 'back')).toBe(false);
  });

  it('forwards the other keys when nothing is focusable (capture windows)', () => {
    for (const key of ['ok', 'up', 'down', 'left', 'right', 'play_pause'] as const) {
      expect(shouldForwardRemoteKey(phraseActiveHidden, key)).toBe(true);
    }
  });
});

describe('useRemoteInput', () => {
  it('dispatches remote inputs when nothing is focusable', () => {
    const dispatch = jest.fn();
    render(<RemoteHarness view={phraseActiveHidden} dispatch={dispatch} />);
    emitTVEvent({ eventType: 'select', eventKeyAction: 0 });
    emitTVEvent({ eventType: 'playpause', eventKeyAction: 0 });
    emitTVEvent({ eventType: 'left' });
    expect(dispatch.mock.calls.map((call) => call[0])).toEqual([
      { kind: 'remote', key: 'ok' },
      { kind: 'remote', key: 'play_pause' },
      { kind: 'remote', key: 'left' },
    ]);
  });

  it('does not dispatch OK or arrows while the focus engine owns them (a focused control handles OK itself)', () => {
    const dispatch = jest.fn();
    render(<RemoteHarness view={home} dispatch={dispatch} />);
    emitTVEvent({ eventType: 'select', eventKeyAction: 0 });
    emitTVEvent({ eventType: 'down', eventKeyAction: 0 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores key-up, back and unmapped keys', () => {
    const dispatch = jest.fn();
    render(<RemoteHarness view={phraseActiveHidden} dispatch={dispatch} />);
    emitTVEvent({ eventType: 'select', eventKeyAction: 1 });
    emitTVEvent({ eventType: 'back', eventKeyAction: 0 });
    emitTVEvent({ eventType: 'volume_up', eventKeyAction: 0 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('follows the latest view without resubscribing', () => {
    const dispatch = jest.fn();
    const screen = render(<RemoteHarness view={home} dispatch={dispatch} />);
    emitTVEvent({ eventType: 'select', eventKeyAction: 0 });
    expect(dispatch).not.toHaveBeenCalled();
    screen.rerender(<RemoteHarness view={phraseActiveHidden} dispatch={dispatch} />);
    expect(mountedTVEventHandlerCount()).toBe(1);
    emitTVEvent({ eventType: 'select', eventKeyAction: 0 });
    expect(dispatch).toHaveBeenCalledWith({ kind: 'remote', key: 'ok' });
  });

  it('stops listening after unmount', () => {
    const dispatch = jest.fn();
    const screen = render(<RemoteHarness view={phraseActiveHidden} dispatch={dispatch} />);
    screen.unmount();
    expect(mountedTVEventHandlerCount()).toBe(0);
    emitTVEvent({ eventType: 'select', eventKeyAction: 0 });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('useBackHandler', () => {
  function Harness({ dispatch }: { dispatch: (input: TvInput) => void }) {
    useBackHandler(dispatch);
    return null;
  }

  it('dispatches remote back on hardwareBackPress and consumes the event (never exits the app)', () => {
    let handler: (() => boolean | null | undefined) | undefined;
    const remove = jest.fn();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_name, h) => {
      handler = h;
      return { remove };
    });
    const dispatch = jest.fn();
    const screen = render(<Harness dispatch={dispatch} />);
    expect(handler).toBeDefined();
    expect(handler?.()).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ kind: 'remote', key: 'back' });
    screen.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });
});

describe('useTicker', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function Harness({ dispatch, now }: { dispatch: (input: TvInput) => void; now: () => number }) {
    useTicker(dispatch, TICK_INTERVAL_MS, now);
    return null;
  }

  it('dispatches a timer input every 200 ms with the current time', () => {
    const dispatch = jest.fn();
    let t = 5000;
    render(<Harness dispatch={dispatch} now={() => (t += 200)} />);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(dispatch).toHaveBeenCalledTimes(5);
    expect(dispatch.mock.calls.map((call) => call[0])).toEqual([5200, 5400, 5600, 5800, 6000].map((now) => ({ kind: 'timer', now })));
  });

  it('stops ticking on unmount', () => {
    const dispatch = jest.fn();
    const screen = render(<Harness dispatch={dispatch} now={() => 1} />);
    screen.unmount();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('useAppLifecycle', () => {
  function Harness({ dispatch }: { dispatch: (input: TvInput) => void }) {
    useAppLifecycle(dispatch);
    return null;
  }

  it('reports launch, then foreground and background transitions', () => {
    let listener: ((state: 'active' | 'background' | 'inactive') => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, l) => {
      listener = l as typeof listener;
      return { remove };
    });
    const dispatch = jest.fn();
    const screen = render(<Harness dispatch={dispatch} />);
    expect(dispatch).toHaveBeenNthCalledWith(1, { kind: 'app', event: 'launched' });
    listener?.('background');
    listener?.('active');
    listener?.('inactive');
    expect(dispatch.mock.calls.slice(1).map((call) => call[0])).toEqual([
      { kind: 'app', event: 'backgrounded' },
      { kind: 'app', event: 'foregrounded' },
      { kind: 'app', event: 'backgrounded' },
    ]);
    screen.unmount();
    expect(remove).toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});
