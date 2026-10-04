import * as fs from 'node:fs';
import * as path from 'node:path';
import { act, render } from '@testing-library/react-native';
import type { TvInput } from '@atr/session-core';
import {
  screenReaderListenerActive,
  screenReaderMockCalls,
  setScreenReaderListenerRegistrationMock,
  setScreenReaderMock,
} from '../../jest/mocks/kepler-a11y';
import { home } from '../__fixtures__/views';
import { AppWithStore } from '../App';
import { useScreenReaderState } from '../input/useScreenReaderState';
import { createFakeStore } from './fakeStore';

function Harness({ dispatch }: { dispatch: (input: TvInput) => void }) {
  useScreenReaderState(dispatch);
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('screen reader state input (A8-02, read-only)', () => {
  it('dispatches the initial state at start: off', async () => {
    const dispatch = jest.fn();
    render(<Harness dispatch={dispatch} />);
    await flush();
    expect(dispatch.mock.calls).toEqual([[{ kind: 'a11y', screenReader: false }]]);
  });

  it('dispatches the initial state at start: on', async () => {
    setScreenReaderMock(true, { notify: false });
    const dispatch = jest.fn();
    render(<Harness dispatch={dispatch} />);
    await flush();
    expect(dispatch.mock.calls).toEqual([[{ kind: 'a11y', screenReader: true }]]);
  });

  it('dispatches whenever the state changes', async () => {
    const dispatch = jest.fn();
    render(<Harness dispatch={dispatch} />);
    await flush();
    act(() => setScreenReaderMock(true));
    act(() => setScreenReaderMock(false));
    act(() => setScreenReaderMock(true));
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'a11y', screenReader: false },
      { kind: 'a11y', screenReader: true },
      { kind: 'a11y', screenReader: false },
      { kind: 'a11y', screenReader: true },
    ]);
  });

  it('without a listener (registration fails) only the initial state is dispatched', async () => {
    setScreenReaderListenerRegistrationMock(false);
    const dispatch = jest.fn();
    render(<Harness dispatch={dispatch} />);
    await flush();
    expect(screenReaderListenerActive()).toBe(false);
    act(() => setScreenReaderMock(true));
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([{ kind: 'a11y', screenReader: false }]);
    // And nothing tries to remove a listener that does not exist.
    expect(screenReaderMockCalls()).not.toContain('removeScreenReaderStateListener');
  });

  it('removes its listener on unmount and ignores later changes', async () => {
    const dispatch = jest.fn();
    const screen = render(<Harness dispatch={dispatch} />);
    await flush();
    expect(screenReaderListenerActive()).toBe(true);
    screen.unmount();
    await flush();
    expect(screenReaderListenerActive()).toBe(false);
    expect(screenReaderMockCalls()).toContain('removeScreenReaderStateListener');
    dispatch.mockClear();
    act(() => setScreenReaderMock(true));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('only uses the read-only calls of the installed API (never a setter)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../input/useScreenReaderState.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const calls = Array.from(code.matchAll(/KeplerA11ySettingsInterface\.(\w+)/g)).map((m) => m[1]);
    expect(new Set(calls)).toEqual(new Set(['isScreenReaderEnabled', 'addScreenReaderStateListener', 'removeScreenReaderStateListener']));
    expect(code).not.toMatch(/\.set[A-Z]\w*\(/);
  });

  it('the installed type definitions have exactly the names used', () => {
    const dts = fs.readFileSync(
      path.resolve(__dirname, '../../node_modules/@amazon-devices/kepler-a11y-settings-interface-turbo/dist/src/KeplerA11ySettingsInterface.d.ts'),
      'utf8',
    );
    for (const name of ['isScreenReaderEnabled(): Promise<boolean>', 'addScreenReaderStateListener(handler: (enabled: boolean) => void): Promise<boolean>', 'removeScreenReaderStateListener(): Promise<void>']) {
      expect(dts).toContain(name);
    }
  });
});

describe('screen reader state in the app', () => {
  it('reaches the store at start and on change', async () => {
    setScreenReaderMock(true, { notify: false });
    const store = createFakeStore(home);
    render(<AppWithStore store={store} />);
    await flush();
    expect(store.dispatched.filter((i) => i.kind === 'a11y')).toEqual([{ kind: 'a11y', screenReader: true }]);
    act(() => setScreenReaderMock(false));
    expect(store.dispatched.filter((i) => i.kind === 'a11y')).toEqual([
      { kind: 'a11y', screenReader: true },
      { kind: 'a11y', screenReader: false },
    ]);
  });
});
