import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  UiScaleSettingContextProvider,
  useUiScaleSettingLoading,
} from '@amazon-devices/kepler-a11y-settings-interface-turbo';
import type { ActionId, SessionStore, TvInput } from '@atr/session-core';
import { FOOTER_FALLBACK, text } from './copy';
import { useAppLifecycle } from './input/useAppLifecycle';
import { useBackHandler } from './input/useBackHandler';
import { useRemoteInput } from './input/useRemoteInput';
import { useTicker } from './input/useTicker';
import { createRuntime } from './runtime/createRuntime';
import type { Runtime } from './runtime/createRuntime';
import { useSessionView } from './runtime/useSessionView';
import { ScreenRouter } from './screens';
import { colors, layout } from './theme';
import { AppText } from './ui/AppText';
import { Footer } from './ui/Footer';
import { useUiScale } from './ui/scale';

function Blank(): React.ReactElement {
  return <View testID="blank" style={{ flex: 1, backgroundColor: colors.background }} />;
}

/** Shown when the app cannot run at all. Plain words, a footer, nothing that needs the session engine. */
export function FatalScreen({ body }: { body: string }): React.ReactElement {
  const ui = useUiScale();
  return (
    <View testID="fatal" style={{ flex: 1, backgroundColor: colors.background, padding: ui.space(layout.pagePadding) }}>
      <AppText kind="title" role="heading">
        {text.fatalTitle}
      </AppText>
      <View style={{ flex: 1, marginTop: ui.space(24) }}>
        <AppText kind="label">{body}</AppText>
      </View>
      <Footer text={FOOTER_FALLBACK} />
    </View>
  );
}

interface BoundaryState {
  failed: boolean;
}

/** A render failure shows the fatal screen instead of a blank TV. The error content is not logged. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override render(): React.ReactNode {
    return this.state.failed ? <FatalScreen body={text.fatalBody} /> : this.props.children;
  }
}

/** Waits for the UI-scale setting before the first paint (no flash at the wrong size). */
function UiScaleGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const loading = useUiScaleSettingLoading();
  return loading ? <Blank /> : <>{children}</>;
}

/** Waits for storage load and resume detection so Home never flashes before "Resume session". */
function ReadyGate({ store, children }: { store: SessionStore; children: React.ReactNode }): React.ReactElement {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const done = (): void => {
      if (alive) setReady(true);
    };
    store.ready().then(done, done);
    return () => {
      alive = false;
    };
  }, [store]);
  return ready ? <>{children}</> : <Blank />;
}

/** The connected screen: renders the view, sends controls, remote keys, Back, ticks and lifecycle events. */
export function AppView({ store }: { store: SessionStore }): React.ReactElement {
  const view = useSessionView(store);
  const dispatch = useCallback((input: TvInput) => store.dispatch(input), [store]);
  const onAction = useCallback((action: ActionId) => dispatch({ kind: 'ui', action }), [dispatch]);
  useRemoteInput(view, dispatch);
  useBackHandler(dispatch);
  useTicker(dispatch);
  useAppLifecycle(dispatch);
  return <ScreenRouter view={view} onAction={onAction} />;
}

/** Providers, boundary and gates around AppView for a given store (also used by tests with a fake store). */
export function AppWithStore({ store }: { store: SessionStore }): React.ReactElement {
  return (
    <UiScaleSettingContextProvider>
      <ErrorBoundary>
        <UiScaleGate>
          <ReadyGate store={store}>
            <AppView store={store} />
          </ReadyGate>
        </UiScaleGate>
      </ErrorBoundary>
    </UiScaleSettingContextProvider>
  );
}

let runtime: Runtime | null | undefined;

function getRuntime(): Runtime | null {
  if (runtime === undefined) runtime = createRuntime();
  return runtime;
}

/** Entry component registered in index.js. */
export function App(): React.ReactElement {
  const current = getRuntime();
  if (current === null) {
    return (
      <UiScaleSettingContextProvider>
        <UiScaleGate>
          <FatalScreen body={text.fatalStoreMissing} />
        </UiScaleGate>
      </UiScaleSettingContextProvider>
    );
  }
  return <AppWithStore store={current.store} />;
}
