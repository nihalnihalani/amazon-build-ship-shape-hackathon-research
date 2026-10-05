/**
 * The TV UI against the REAL session store (createSessionStore from @atr/session-core, in-memory storage, a fake
 * transport). Two jobs:
 *  1. Fixture drift: for the screens reachable without a phone, the hand-written fixtures must match what the real
 *     core emits (screen, title, controls, labels, hints, disabled and destructive flags, preferred action, dialog).
 *     When session-core changes its copy or focus defaults, this test says which fixture to update.
 *  2. Invariants on every view reachable by pressing controls: footer, one control per action, exactly one preferred
 *     focus when a control is enabled, arc only with a meter, no dialog preferring a destructive confirm.
 * Screens that need a phone (capture, response, reveal, summary with data) cannot be reached here; their fixtures
 * follow view.ts by hand and the end-to-end journey (tests/e2e, tests/a11y store mode) covers the real views.
 */
import { act, render } from '@testing-library/react-native';
import { createMemoryStorage, createSessionStore } from '@atr/session-core';
import type { SessionStore, TvInput, TvView } from '@atr/session-core';
import { about, confirmDialogDestructive, diagnostics, history, home, onboarding, pairing, settings } from '../__fixtures__/views';
import { ScreenRouter } from '../screens';
import { actionControls, preferredPressables } from './testUtils';

function newStore(): SessionStore {
  const now = Date.parse('2026-10-05T10:00:00Z');
  return createSessionStore({
    clock: { now: () => now, localDate: (ms) => new Date(ms).toISOString().slice(0, 10) },
    storage: createMemoryStorage(),
    transport: { connect: () => undefined, send: () => true, close: () => undefined },
    relayUrl: 'wss://localhost:8443/ws',
    appVersion: '0.1.0',
    platform: 'test',
  });
}

const ui = (action: string): TvInput => ({ kind: 'ui', action } as TvInput);

async function viewAfter(inputs: TvInput[]): Promise<TvView> {
  const store = newStore();
  await store.ready();
  for (const input of inputs) store.dispatch(input);
  return store.getView();
}

function controls(view: TvView) {
  return view.actions.map((a) => ({
    id: a.id,
    label: a.label,
    hint: a.hint ?? null,
    disabled: a.disabled === true,
    destructive: a.destructive === true,
  }));
}

const LAUNCH: TvInput = { kind: 'app', event: 'launched' };

describe('fixture drift: fixtures match the real core for the screens reachable without a phone', () => {
  const cases: Array<[string, TvInput[], TvView]> = [
    ['onboarding', [LAUNCH], onboarding],
    ['home', [LAUNCH, ui('continue')], home],
    ['settings', [ui('continue'), ui('open_settings')], settings],
    ['about', [ui('continue'), ui('open_settings'), ui('open_about')], about],
    ['diagnostics', [ui('continue'), ui('open_settings'), ui('open_diagnostics')], diagnostics],
    ['history', [ui('continue'), ui('open_history')], history],
    ['delete dialog', [ui('continue'), ui('open_settings'), ui('delete_local_data')], confirmDialogDestructive],
  ];

  it.each(cases)('%s', async (_name, inputs, fixture) => {
    const real = await viewAfter(inputs);
    expect(fixture.screen).toBe(real.screen);
    expect(fixture.stage).toBe(real.stage);
    expect(fixture.title).toBe(real.title);
    expect(controls(fixture)).toEqual(controls(real));
    expect(fixture.preferredAction).toBe(real.preferredAction);
    expect(fixture.labels).toEqual(real.labels);
    expect(fixture.footer).toBe(real.footer);
    // Copy that must have a single source (About, privacy, storage) is compared line by line.
    if (fixture.screen === 'about') expect(fixture.body).toEqual(real.body);
    if (real.dialog === null) expect(fixture.dialog).toBeNull();
    else {
      expect(fixture.dialog?.title).toBe(real.dialog.title);
      expect(fixture.dialog?.body).toBe(real.dialog.body);
      expect(fixture.dialog?.confirm.label).toBe(real.dialog.confirm.label);
      expect(fixture.dialog?.cancel.label).toBe(real.dialog.cancel.label);
      expect(fixture.dialog?.preferred).toBe(real.dialog.preferred);
    }
  });

  it('pairing (before a room exists): same controls, labels and preferred action; only the disabled state differs', async () => {
    const real = await viewAfter([ui('continue'), ui('pair_phone')]);
    expect(real.screen).toBe(pairing.screen);
    expect(real.title).toBe(pairing.title);
    expect(controls(pairing).map((c) => [c.id, c.label])).toEqual(controls(real).map((c) => [c.id, c.label]));
    expect(pairing.preferredAction).toBe(real.preferredAction);
  });
});

describe('the real views render with every invariant', () => {
  const seen = new Set<string>();

  function check(view: TvView): void {
    const key = [view.screen, view.stage, view.title, view.dialog?.title ?? ''].join('/');
    if (seen.has(key)) return;
    seen.add(key);
    const screen = render(<ScreenRouter view={view} onAction={() => undefined} />);
    expect(screen.getByTestId('footer').props.children).toBe(view.footer);
    const shown = view.dialog === null ? view.actions : [view.dialog.cancel, view.dialog.confirm];
    expect(actionControls(screen)).toHaveLength(shown.length);
    const enabled = shown.filter((c) => c.disabled !== true);
    expect(preferredPressables(screen)).toHaveLength(enabled.length > 0 ? 1 : 0);
    expect(screen.queryByTestId('arc-meter') !== null).toBe(view.meter !== null);
    if (view.dialog !== null) {
      expect(preferredPressables(screen)[0]?.props.testID).toBe('action-cancel_destructive');
      expect(screen.queryByTestId('screen-title')).toBeNull();
    } else {
      expect(screen.getByTestId('screen-title')).toBeTruthy();
    }
    screen.unmount();
  }

  it('walks every view reachable by pressing controls or Back (no phone)', async () => {
    const queue: TvInput[][] = [[LAUNCH]];
    const visited = new Set<string>();
    let steps = 0;
    while (queue.length > 0 && steps < 300) {
      const path = queue.shift() as TvInput[];
      const signature = JSON.stringify(path);
      if (visited.has(signature)) continue;
      visited.add(signature);
      const store = newStore();
      await store.ready();
      for (const input of path) store.dispatch(input);
      await act(async () => {
        await Promise.resolve();
      });
      const view = store.getView();
      steps += 1;
      check(view);
      if (path.length >= 4) continue;
      const shown = view.dialog === null ? view.actions : [view.dialog.cancel, view.dialog.confirm];
      for (const control of shown) {
        if (control.id === 'confirm_destructive' || control.disabled === true) continue;
        queue.push([...path, ui(control.id)]);
      }
      queue.push([...path, { kind: 'remote', key: 'back' }]);
    }
    for (const expected of ['onboarding', 'home', 'settings', 'about', 'diagnostics', 'history', 'pairing', 'confirm_dialog']) {
      expect(Array.from(seen).some((key) => key.startsWith(expected + '/'))).toBe(true);
    }
  });
});
