// Web preview entry. NOT Vega. Two modes:
//   ?mode=fixtures (default)  the TV UI renders fixture TvView objects chosen with ?screen=<name> or the picker.
//                             Pressed controls and remote keys are recorded in window.__atr.dispatched.
//   ?mode=store               the real session store (fixture mode, in-memory data) when @atr/session-core
//                             exports createSessionStore; otherwise a message says it is unavailable.
// The 1920 x 1080 TV canvas is scaled to fit the window. ?scale=1.5 simulates a larger UI-scale setting.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import type { SessionStore, TvInput, TvView } from '@atr/session-core';
import { AppWithStore } from '../../src/App';
import { resolveConfig } from '../../src/config';
import { createRuntime } from '../../src/runtime/createRuntime';
import { allScreens } from '../../src/__fixtures__/views';

interface PreviewApi {
  dispatched: TvInput[];
  screens: string[];
  setScreen(name: string): void;
  view(): TvView;
}

declare global {
  interface Window {
    __atr?: PreviewApi;
  }
}

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') === 'store' ? 'store' : 'fixtures';
const BANNER_HEIGHT = 44;

function createFixtureStore(initial: TvView, dispatched: TvInput[]): SessionStore & { setView(view: TvView): void } {
  let view = initial;
  const listeners = new Set<(next: TvView) => void>();
  return {
    getView: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(input) {
      // Timer ticks would drown the log; everything else is recorded for tests.
      if (input.kind !== 'timer') dispatched.push(input);
    },
    ready: () => Promise.resolve(),
    dispose() {
      listeners.clear();
    },
    setView(next) {
      view = next;
      for (const listener of Array.from(listeners)) listener(next);
    },
  };
}

function useCanvasScale(): number {
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    const update = (): void => setScale(Math.min(window.innerWidth / 1920, (window.innerHeight - BANNER_HEIGHT) / 1080));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return scale;
}

function Banner({ children }: { children?: React.ReactNode }): React.ReactElement {
  return (
    <div
      data-testid="web-preview-banner"
      style={{
        height: BANNER_HEIGHT,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 16px',
        background: '#7a1f1f',
        color: '#fff',
        font: '600 16px system-ui, sans-serif',
      }}
    >
      <span>Web preview — not Vega</span>
      <span style={{ fontWeight: 400 }}>react-native-web with shims; no Vega rendering, focus, VoiceView or performance evidence.</span>
      {children}
    </div>
  );
}

function Canvas({ children }: { children: React.ReactNode }): React.ReactElement {
  const scale = useCanvasScale();
  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div
        data-testid="tv-canvas"
        style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, transformOrigin: 'top left', transform: 'scale(' + scale + ')', display: 'flex' }}
      >
        {children}
      </div>
    </div>
  );
}

function FixturePreview(): React.ReactElement {
  const dispatched = React.useRef<TvInput[]>([]);
  const names = allScreens.map(([name]) => name);
  const requested = params.get('screen');
  const initialName = requested !== null && names.includes(requested) ? requested : 'home';
  const [name, setName] = React.useState(initialName);
  const [last, setLast] = React.useState('');
  const store = React.useMemo(() => {
    const entry = allScreens.find(([n]) => n === initialName) ?? allScreens[0];
    const instance = createFixtureStore((entry as (typeof allScreens)[number])[1], dispatched.current);
    const originalDispatch = instance.dispatch;
    instance.dispatch = (input) => {
      originalDispatch(input);
      if (input.kind !== 'timer') setLast(JSON.stringify(input));
    };
    return instance;
  }, [initialName]);

  const select = React.useCallback(
    (next: string) => {
      const entry = allScreens.find(([n]) => n === next);
      if (entry === undefined) return;
      setName(next);
      store.setView(entry[1]);
    },
    [store],
  );

  React.useEffect(() => {
    window.__atr = { dispatched: dispatched.current, screens: names, setScreen: select, view: () => store.getView() };
  }, [names, select, store]);

  return (
    <>
      <Banner>
        <label style={{ fontWeight: 400 }}>
          Fixture{' '}
          <select data-testid="fixture-picker" value={name} onChange={(event) => select(event.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span data-testid="last-input" style={{ fontWeight: 400, fontFamily: 'monospace' }}>
          {last}
        </span>
      </Banner>
      <Canvas>
        <AppWithStore store={store} />
      </Canvas>
    </>
  );
}

function StorePreview(): React.ReactElement {
  const runtime = React.useMemo(
    () => createRuntime({ config: resolveConfig({ platform: 'web_preview', fixtureMode: true }) }),
    [],
  );
  if (runtime === null) {
    return (
      <>
        <Banner />
        <div data-testid="store-unavailable" style={{ color: '#fff', font: '24px system-ui', padding: 32 }}>
          The session engine (createSessionStore) is not exported by @atr/session-core in this checkout. Use ?mode=fixtures.
        </div>
      </>
    );
  }
  return (
    <>
      <Banner>
        <span style={{ fontWeight: 400 }}>Session store in fixture mode (in-memory data, labelled "Fixture replay").</span>
      </Banner>
      <Canvas>
        <AppWithStore store={runtime.store} />
      </Canvas>
    </>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(mode === 'store' ? <StorePreview /> : <FixturePreview />);
}
