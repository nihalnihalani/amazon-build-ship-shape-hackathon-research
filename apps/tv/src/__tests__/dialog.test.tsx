import { fireEvent } from '@testing-library/react-native';
import { TVFocusGuideView } from '@amazon-devices/react-native-kepler';
import {
  confirmDialogDestructive,
  confirmDialogPlain,
  confirmDialogWrongPreference,
  makeView,
  settings,
} from '../__fixtures__/views';
import { actionControls, preferredPressables, pressableFor, renderView } from './testUtils';

describe('confirmation dialog', () => {
  it('destructive dialog: Cancel (and only Cancel) has the preferred focus', () => {
    const screen = renderView(confirmDialogDestructive);
    const preferred = preferredPressables(screen);
    expect(preferred).toHaveLength(1);
    expect(preferred[0]?.props.testID).toBe('action-cancel_destructive');
    expect(pressableFor(screen, 'confirm_destructive').props.hasTVPreferredFocus).toBe(false);
  });

  it('destructive dialog starts on Cancel even if the view wrongly prefers Confirm', () => {
    expect(confirmDialogWrongPreference.dialog?.preferred).toBe('confirm');
    const screen = renderView(confirmDialogWrongPreference);
    const preferred = preferredPressables(screen);
    expect(preferred).toHaveLength(1);
    expect(preferred[0]?.props.testID).toBe('action-cancel_destructive');
  });

  it('non-destructive dialog follows the view preference', () => {
    const screen = renderView(confirmDialogPlain);
    expect(preferredPressables(screen)[0]?.props.testID).toBe('action-confirm_destructive');
  });

  it('lays Cancel out first so the focus guide first child is also Cancel', () => {
    const screen = renderView(confirmDialogDestructive);
    expect(actionControls(screen).map((node) => node.props.testID)).toEqual(['action-cancel_destructive', 'action-confirm_destructive']);
  });

  it('traps focus inside a focus guide with autoFocus in all four directions', () => {
    const screen = renderView(confirmDialogDestructive);
    const guide = screen.UNSAFE_getByType(TVFocusGuideView);
    expect(guide.props.autoFocus).toBe(true);
    expect(guide.props.trapFocusUp).toBe(true);
    expect(guide.props.trapFocusDown).toBe(true);
    expect(guide.props.trapFocusLeft).toBe(true);
    expect(guide.props.trapFocusRight).toBe(true);
  });

  it('shows title and body, and both controls carry button role and labels', () => {
    const screen = renderView(confirmDialogDestructive);
    expect(screen.getByTestId('dialog-title').props.children).toBe('Delete all practice data?');
    expect(screen.getByTestId('dialog-body').props.children).toContain('cannot be undone');
    for (const id of ['cancel_destructive', 'confirm_destructive']) {
      const control = pressableFor(screen, id);
      expect(control.props.role).toBe('button');
      expect(typeof control.props['aria-label']).toBe('string');
    }
  });

  it('dispatches the pressed control id', () => {
    const pressed: string[] = [];
    const screen = renderView(confirmDialogDestructive, (id) => pressed.push(id));
    fireEvent.press(screen.getByTestId('action-cancel_destructive'));
    fireEvent.press(screen.getByTestId('action-confirm_destructive'));
    expect(pressed).toEqual(['cancel_destructive', 'confirm_destructive']);
  });

  it('a dialog in the view wins over the screen underneath it', () => {
    const view = makeView({ ...settings, dialog: confirmDialogDestructive.dialog });
    const screen = renderView(view);
    expect(screen.getByTestId('dialog')).toBeTruthy();
    // The settings controls are not rendered while the dialog owns focus: exactly one preferred focus.
    expect(screen.queryByTestId('action-toggle_family_mode')).toBeNull();
    expect(preferredPressables(screen)).toHaveLength(1);
  });

  it('the plain focus guide is not used outside dialogs', () => {
    const screen = renderView(settings);
    expect(screen.UNSAFE_queryAllByType(TVFocusGuideView)).toHaveLength(0);
  });
});
