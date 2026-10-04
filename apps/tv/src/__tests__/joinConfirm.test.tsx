import { fireEvent, within } from '@testing-library/react-native';
import { joinConfirm, makeView } from '../__fixtures__/views';
import { Text } from 'react-native';
import { text } from '../copy';
import { allStrings, actionControls, preferredPressables, pressableFor, renderView } from './testUtils';

type JoinChoices = [string, string, string];

function joinView(choices: JoinChoices, deviceLabel = 'Pixel 8') {
  return makeView({
    ...joinConfirm,
    pairing: { code: 'ACDEFH', codeExpiresAt: null, qrPayload: null, joinRequest: { deviceLabel, choices } },
  });
}

function styleOf(node: { props: { style?: unknown } }): unknown {
  return JSON.stringify(node.props.style);
}

describe('number matching join confirmation (A3-06)', () => {
  it('shows the fixed heading', () => {
    const screen = renderView(joinConfirm);
    expect(text.joinHeading).toBe('A phone wants to join. Pick the number shown on the phone.');
    expect(screen.getByTestId('screen-title').props.children).toBe('A phone wants to join. Pick the number shown on the phone.');
    expect(screen.getByTestId('screen-title').props.role).toBe('heading');
  });

  it('shows the three choices in view order as large number buttons', () => {
    const screen = renderView(joinConfirm);
    const picks = ['pick_choice_1', 'pick_choice_2', 'pick_choice_3'];
    const shown = picks.map((id) => {
      const host = screen.getByTestId('action-' + id);
      const texts = within(host).UNSAFE_getAllByType(Text).map((node) => node.props.children as string);
      return { id, texts, role: pressableFor(screen, id).props.role };
    });
    expect(shown.map((s) => s.texts)).toEqual([['42'], ['17'], ['86']]);
    for (const s of shown) expect(s.role).toBe('button');
    // Large: 96 px digits at scale 1.0.
    const digits = screen.getByTestId('action-pick_choice_1').findAll((n) => (n.type as unknown) === 'Text');
    const style = Object.assign({}, ...[digits[0]?.props.style].flat(Infinity)) as { fontSize?: number };
    expect(style.fontSize).toBe(96);
  });

  it('lays the choices out in one row, so left and right move focus between them, with Reject below', () => {
    const screen = renderView(joinConfirm);
    const row = screen.getByTestId('join-choices');
    const rowStyle = Object.assign({}, ...[row.props.style].flat(Infinity)) as { flexDirection?: string };
    expect(rowStyle.flexDirection).toBe('row');
    const order = actionControls(screen).map((node) => node.props.testID);
    expect(order).toEqual(['action-pick_choice_1', 'action-pick_choice_2', 'action-pick_choice_3', 'action-reject_join']);
  });

  it('gives the preferred focus to Reject and to nothing else', () => {
    const screen = renderView(joinConfirm);
    const preferred = preferredPressables(screen);
    expect(preferred).toHaveLength(1);
    expect(preferred[0]?.props.testID).toBe('action-reject_join');
  });

  it('keeps Reject preferred even if the view names another control', () => {
    const screen = renderView({ ...joinConfirm, preferredAction: 'pick_choice_2' });
    expect(preferredPressables(screen).map((n) => n.props.testID)).toEqual(['action-reject_join']);
  });

  it('styles all three number buttons identically, whatever the choices are (no correctness hint)', () => {
    const permutations: JoinChoices[] = [
      ['42', '17', '86'],
      ['17', '86', '42'],
      ['86', '42', '17'],
      ['10', '10', '10'],
    ];
    for (const choices of permutations) {
      const screen = renderView(joinView(choices));
      const styles = ['pick_choice_1', 'pick_choice_2', 'pick_choice_3'].map((id) => styleOf(screen.getByTestId('action-' + id)));
      expect(new Set(styles).size).toBe(1);
      const behaviour = ['pick_choice_1', 'pick_choice_2', 'pick_choice_3'].map((id) => {
        const p = pressableFor(screen, id).props as Record<string, unknown>;
        return JSON.stringify([p['role'], p['aria-disabled'], p['focusable'], p['hasTVPreferredFocus'], p['accessibilityDescribedBy']]);
      });
      expect(new Set(behaviour).size).toBe(1);
    }
  });

  it('puts no other two-digit number on screen than the three choices', () => {
    const screen = renderView(joinConfirm);
    const numbers = allStrings(screen.toJSON()).flatMap((s) => s.match(/\d{2}/g) ?? []);
    for (const n of numbers) expect(['42', '17', '86']).toContain(n);
  });

  it('shows the name the phone gave as literal untrusted text after a fixed prefix', () => {
    const screen = renderView(joinConfirm);
    expect(screen.getByTestId('join-device').props.children).toBe('Name the phone gave: Pixel 8');
    const hostile = '<b>Bank</b> [click](https://evil.example) ‮evil {{x}} \\n %s';
    const hostileScreen = renderView(joinView(['42', '17', '86'], hostile));
    expect(hostileScreen.getByTestId('join-device').props.children).toBe('Name the phone gave: ' + hostile);
    // Plain text only: no press handler, no link role, not selectable, bounded to two lines.
    const node = hostileScreen.getByTestId('join-device');
    expect(node.props.onPress).toBeUndefined();
    expect(node.props.role).not.toBe('link');
    expect(node.props.selectable).toBeUndefined();
    expect(node.props.numberOfLines).toBe(2);
  });

  it('does not render the store body or title for this prompt (the UI owns the wording)', () => {
    const screen = renderView(joinConfirm);
    const strings = allStrings(screen.toJSON()).join('\n');
    expect(strings).not.toContain('This text is ignored');
    expect(strings).not.toContain('A phone wants to join\n');
  });

  it('sends the pressed control id', () => {
    const pressed: string[] = [];
    const screen = renderView(joinConfirm, (id) => pressed.push(id));
    fireEvent.press(screen.getByTestId('action-pick_choice_2'));
    fireEvent.press(screen.getByTestId('action-reject_join'));
    fireEvent.press(screen.getByTestId('action-pick_choice_3'));
    expect(pressed).toEqual(['pick_choice_2', 'reject_join', 'pick_choice_3']);
  });

  it('falls back to words for the control labels when the view omits the actions', () => {
    const screen = renderView({ ...joinConfirm, actions: [] });
    expect(pressableFor(screen, 'pick_choice_1').props['aria-label']).toBe('Number 42');
    expect(pressableFor(screen, 'reject_join').props['aria-label']).toBe('Reject');
    expect(preferredPressables(screen).map((n) => n.props.testID)).toEqual(['action-reject_join']);
  });

  it('keeps hint and disabled state from the view actions', () => {
    const view = makeView({
      ...joinConfirm,
      actions: [
        { id: 'pick_choice_1', label: 'Number 42', hint: 'Select the number shown on the phone' },
        { id: 'pick_choice_2', label: 'Number 17', disabled: true },
        { id: 'pick_choice_3', label: 'Number 86' },
        { id: 'reject_join', label: 'Reject' },
      ],
    });
    const screen = renderView(view);
    expect(pressableFor(screen, 'pick_choice_1').props.accessibilityHint).toBe('Select the number shown on the phone');
    expect(pressableFor(screen, 'pick_choice_2').props['aria-disabled']).toBe(true);
  });

  it('describes each control with the name line for screen readers', () => {
    const screen = renderView(joinConfirm);
    expect(pressableFor(screen, 'pick_choice_1').props.accessibilityDescribedBy).toEqual(['atr-join-device']);
    expect(screen.getByTestId('join-device').props.nativeID).toBe('atr-join-device');
  });

  it('renders without a join request, still with a footer and the view actions', () => {
    const screen = renderView({ ...joinConfirm, pairing: null });
    expect(screen.queryByTestId('join')).toBeNull();
    expect(screen.getByTestId('footer')).toBeTruthy();
    expect(actionControls(screen)).toHaveLength(4);
  });
});
