import { fireEvent } from '@testing-library/react-native';
import type { ActionId, TvView } from '@atr/session-core';
import { confirmDialogDestructive, everyScreen, FOOTER, makeView } from '../__fixtures__/views';
import { text } from '../copy';
import { actionControls, allStrings, preferredPressables, pressableFor, renderView } from './testUtils';

/** join_confirm uses a UI-owned heading (A3-06); every other screen shows view.title. */
function expectedTitle(view: TvView): string {
  return view.screen === 'join_confirm' ? text.joinHeading : view.title;
}

function controlsOf(view: TvView) {
  return view.dialog !== null ? [view.dialog.cancel, view.dialog.confirm] : view.actions;
}

describe.each(everyScreen)('screen fixture: %s', (_name, view) => {
  it('renders the title and the footer on the screen', () => {
    const screen = renderView(view);
    expect(screen.getByTestId('screen-' + view.screen)).toBeTruthy();
    if (view.dialog !== null) {
      // A11Y-02: a dialog shows its own title once; the frame's title is not rendered.
      expect(screen.queryByTestId('screen-title')).toBeNull();
      expect(screen.getByTestId('dialog-title').props.children).toBe(view.dialog.title);
    } else {
      expect(screen.getByTestId('screen-title').props.children).toBe(expectedTitle(view));
    }
    expect(screen.getByTestId('footer').props.children).toBe(FOOTER);
  });

  it('gives every control a button role, a label that matches its text and its hint', () => {
    const screen = renderView(view);
    const controls = controlsOf(view);
    expect(actionControls(screen)).toHaveLength(controls.length);
    for (const control of controls) {
      const pressable = pressableFor(screen, control.id);
      expect(pressable.props.role).toBe('button');
      expect(pressable.props['aria-label']).toBe(control.label);
      expect(pressable.props.accessibilityHint).toBe(control.hint);
      expect(pressable.props['aria-disabled']).toBe(control.disabled === true);
    }
  });

  it('has exactly one preferred focus when any control is enabled, none otherwise', () => {
    const screen = renderView(view);
    const enabled = controlsOf(view).filter((control) => control.disabled !== true);
    expect(preferredPressables(screen)).toHaveLength(enabled.length > 0 ? 1 : 0);
  });

  it('mounts the arc only when the view has a meter', () => {
    const screen = renderView(view);
    expect(screen.queryByTestId('arc-meter') !== null).toBe(view.meter !== null);
  });

  it('calls onAction with the control id when a control is pressed', () => {
    const pressed: ActionId[] = [];
    const screen = renderView(view, (id) => pressed.push(id));
    for (const control of controlsOf(view)) {
      fireEvent.press(screen.getByTestId('action-' + control.id));
    }
    // Disabled controls are not pressable (A11Y-01); every enabled one reports its id.
    expect(pressed).toEqual(controlsOf(view).filter((control) => control.disabled !== true).map((control) => control.id));
  });

  it('never leaves the screen without visible text for the title', () => {
    const screen = renderView(view);
    const strings = allStrings(screen.toJSON());
    expect(strings.some((s) => s.includes(expectedTitle(view)) || (view.dialog !== null && s.includes(view.dialog.title)))).toBe(true);
  });
});

describe('disabled controls', () => {
  it('are not pressable, not focusable and are never the preferred focus', () => {
    const onAction = jest.fn();
    const view = makeView({
      screen: 'home',
      stage: 'idle',
      actions: [
        { id: 'start_session', label: 'Start session', disabled: true },
        { id: 'open_history', label: 'History' },
      ],
      preferredAction: 'start_session',
    });
    const screen = renderView(view, onAction);
    const disabled = pressableFor(screen, 'start_session');
    expect(disabled.props['aria-disabled']).toBe(true);
    expect(disabled.props.focusable).toBe(false);
    fireEvent.press(screen.getByTestId('action-start_session'));
    expect(onAction).not.toHaveBeenCalled();
    // The preferred action points at an unavailable control: the first enabled one takes the focus.
    const preferred = preferredPressables(screen);
    expect(preferred).toHaveLength(1);
    expect(preferred[0]?.props.testID).toBe('action-open_history');
  });
});

describe('footer and fallback', () => {
  it('falls back to the fixed statement when the view footer is empty', () => {
    const screen = renderView(makeView({ screen: 'home', stage: 'idle', footer: '   ' }));
    expect(screen.getByTestId('footer').props.children).toBe(FOOTER);
  });

  it('renders title, body and footer even for the dialog screen id without dialog data', () => {
    const view = { ...confirmDialogDestructive, dialog: null };
    const screen = renderView(view);
    expect(screen.getByTestId('footer')).toBeTruthy();
    expect(actionControls(screen)).toHaveLength(0);
  });
});
