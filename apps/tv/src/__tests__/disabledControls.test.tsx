import { fireEvent } from '@testing-library/react-native';
import { makeView, settings } from '../__fixtures__/views';
import { actionControls, preferredPressables, pressableFor, renderView } from './testUtils';

const DISABLED = ['reset_calibration', 'unpair_phone'];

describe('A11Y-01: disabled controls', () => {
  it('the settings fixture marks Reset today\'s band and Unpair phone disabled, like the real core outside a session', () => {
    for (const id of DISABLED) expect(settings.actions.find((a) => a.id === id)?.disabled).toBe(true);
  });

  it.each(DISABLED)('%s passes disabled, aria-disabled and focusable=false to the Pressable', (id) => {
    const screen = renderView(settings);
    const control = pressableFor(screen, id);
    expect(control.props.disabled).toBe(true);
    expect(control.props['aria-disabled']).toBe(true);
    expect(control.props.focusable).toBe(false);
    expect(control.props.hasTVPreferredFocus).toBe(false);
  });

  it.each(DISABLED)('%s is exposed as disabled to the accessibility tree and cannot be pressed', (id) => {
    const onAction = jest.fn();
    const screen = renderView(settings, onAction);
    const host = screen.getByTestId('action-' + id);
    expect(host.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(host);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps the hint so a screen reader can say why', () => {
    const screen = renderView(settings);
    expect(pressableFor(screen, 'reset_calibration').props.accessibilityHint).toBe(
      'Clears the band for this session only. Needs a session with a band.',
    );
  });

  it('leaves enabled controls enabled, focusable and pressable', () => {
    const onAction = jest.fn();
    const screen = renderView(settings, onAction);
    for (const id of ['toggle_family_mode', 'delete_local_data', 'open_about', 'open_diagnostics']) {
      const control = pressableFor(screen, id);
      expect(control.props.disabled).toBe(false);
      expect(control.props['aria-disabled']).toBe(false);
      expect(control.props.focusable).toBe(true);
    }
    fireEvent.press(screen.getByTestId('action-open_about'));
    expect(onAction).toHaveBeenCalledWith('open_about');
  });

  it('lists exactly the enabled controls as focus targets', () => {
    const screen = renderView(settings);
    const focusable = actionControls(screen).filter((n) => n.props.focusable === true).map((n) => n.props.testID);
    expect(focusable).toEqual(settings.actions.filter((a) => a.disabled !== true).map((a) => 'action-' + a.id));
  });

  it('never gives a disabled control the preferred focus, even when the view asks for it', () => {
    const view = makeView({ ...settings, preferredAction: 'unpair_phone' });
    const screen = renderView(view);
    const preferred = preferredPressables(screen);
    expect(preferred).toHaveLength(1);
    expect(DISABLED).not.toContain((preferred[0]?.props.testID as string).replace('action-', ''));
  });
});
