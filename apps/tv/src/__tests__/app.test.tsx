import { BackHandler } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { TvView } from '@atr/session-core';
import { setUiScaleLoadingMock } from '../../jest/mocks/kepler-a11y';
import { emitTVEvent } from '../../jest/mocks/react-native-kepler';
import { home, makeView, phraseLead, phraseReady } from '../__fixtures__/views';
import { AppWithStore, FatalScreen } from '../App';
import { useSessionView } from '../runtime/useSessionView';
import { createFakeStore } from './fakeStore';

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('AppWithStore', () => {
  it('waits for the store to be ready, then renders the current view', async () => {
    const store = createFakeStore(home, { manualReady: true });
    const screen = render(<AppWithStore store={store} />);
    expect(screen.queryByTestId('screen-home')).toBeNull();
    expect(screen.getByTestId('blank')).toBeTruthy();
    store.resolveReady();
    await flush();
    expect(screen.getByTestId('screen-home')).toBeTruthy();
  });

  it('still renders if storage load fails (the view then carries the problem)', async () => {
    const store = createFakeStore(home, { readyRejects: true });
    const screen = render(<AppWithStore store={store} />);
    await flush();
    expect(screen.getByTestId('screen-home')).toBeTruthy();
  });

  it('reports launch once after ready', async () => {
    const store = createFakeStore(home);
    render(<AppWithStore store={store} />);
    expect(store.dispatched).toEqual([]);
    await flush();
    expect(store.dispatched.filter((input) => input.kind === 'app')).toEqual([{ kind: 'app', event: 'launched' }]);
  });

  it('sends a pressed control as a ui input', async () => {
    const store = createFakeStore(home);
    const screen = render(<AppWithStore store={store} />);
    await flush();
    fireEvent.press(screen.getByTestId('action-start_session'));
    expect(store.dispatched).toContainEqual({ kind: 'ui', action: 'start_session' });
  });

  it('re-renders when the store publishes a new view and unsubscribes on unmount', async () => {
    const store = createFakeStore(home);
    const screen = render(<AppWithStore store={store} />);
    await flush();
    expect(store.listenerCount()).toBe(1);
    act(() => store.setView(phraseReady));
    expect(screen.getByTestId('screen-phrase')).toBeTruthy();
    expect(screen.queryByTestId('screen-home')).toBeNull();
    screen.unmount();
    expect(store.listenerCount()).toBe(0);
  });

  it('routes Back to the store as remote back and consumes it', async () => {
    let handler: (() => boolean | null | undefined) | undefined;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_name, h) => {
      handler = h;
      return { remove: () => undefined };
    });
    const store = createFakeStore(home);
    render(<AppWithStore store={store} />);
    await flush();
    expect(handler?.()).toBe(true);
    expect(store.dispatched).toContainEqual({ kind: 'remote', key: 'back' });
    jest.restoreAllMocks();
  });

  it('routes OK to the store only while nothing is focusable', async () => {
    const store = createFakeStore(home);
    render(<AppWithStore store={store} />);
    await flush();
    emitTVEvent({ eventType: 'select', eventKeyAction: 0 });
    expect(store.dispatched.some((input) => input.kind === 'remote')).toBe(false);
    act(() => store.setView(phraseLead));
    emitTVEvent({ eventType: 'select', eventKeyAction: 0 });
    expect(store.dispatched).toContainEqual({ kind: 'remote', key: 'ok' });
  });

  it('ticks the session core every 200 ms', async () => {
    jest.useFakeTimers();
    try {
      const store = createFakeStore(home);
      render(<AppWithStore store={store} />);
      await flush();
      act(() => {
        jest.advanceTimersByTime(600);
      });
      expect(store.dispatched.filter((input) => input.kind === 'timer')).toHaveLength(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows nothing until the UI-scale setting has loaded', async () => {
    setUiScaleLoadingMock(true);
    const store = createFakeStore(home);
    const screen = render(<AppWithStore store={store} />);
    await flush();
    expect(screen.getByTestId('blank')).toBeTruthy();
    expect(screen.queryByTestId('screen-home')).toBeNull();
    setUiScaleLoadingMock(false);
    screen.rerender(<AppWithStore store={store} />);
    await flush();
    expect(screen.getByTestId('screen-home')).toBeTruthy();
  });

  it('shows the fatal screen, with the footer, if rendering throws', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { ...home, body: undefined } as unknown as TvView;
    const store = createFakeStore(broken);
    const screen = render(<AppWithStore store={store} />);
    await flush();
    expect(screen.getByTestId('fatal')).toBeTruthy();
    expect(screen.getByTestId('footer')).toBeTruthy();
    spy.mockRestore();
  });
});

describe('live region while capturing', () => {
  it('announces when idle and is silent while a window is open', async () => {
    const store = createFakeStore(home);
    const screen = render(<AppWithStore store={store} />);
    await flush();
    expect(screen.getByTestId('live-region-text').props.children).toBe('Home. Start session is selected.');
    expect(screen.getByTestId('live-region').props['aria-live']).toBe('polite');
    act(() => store.setView({ ...phraseLead, announcement: 'Say the phrase now' }));
    expect(screen.queryByTestId('live-region-text')).toBeNull();
    expect(screen.getByTestId('live-region').props['aria-live']).toBe('off');
  });
});

describe('useSessionView', () => {
  it('survives a store whose getView returns a new object on every call (no render loop)', () => {
    let renders = 0;
    let calls = 0;
    const store = createFakeStore(home);
    const unstable = { ...store, getView: () => ({ ...makeView({ screen: 'home', stage: 'idle', title: 'n' + calls++ }) }) };
    function Probe() {
      renders += 1;
      const view = useSessionView(unstable);
      return <FatalScreen body={view.title} />;
    }
    render(<Probe />);
    expect(renders).toBeLessThan(10);
  });
});

describe('FatalScreen', () => {
  it('has a heading, the message and the footer', () => {
    const screen = render(<FatalScreen body="Something is wrong" />);
    expect(screen.getByTestId('fatal')).toBeTruthy();
    expect(screen.getByTestId('footer').props.children).toContain('Not a medical device');
  });
});
