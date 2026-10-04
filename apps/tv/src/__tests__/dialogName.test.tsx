import { allStrings, pressableFor, preferredPressables, renderView } from './testUtils';
import { confirmDialogDestructive, confirmDialogPlain } from '../__fixtures__/views';

describe.each([
  ['destructive', confirmDialogDestructive],
  ['plain', confirmDialogPlain],
])('A11Y-02: %s confirmation dialog', (_name, view) => {
  const title = view.dialog?.title ?? '';

  it('has an accessible name taken from its title (aria-label and aria-labelledby)', () => {
    const screen = renderView(view);
    const dialog = screen.getByTestId('dialog');
    expect(dialog.props.role).toBe('alertdialog');
    expect((dialog.props['aria-label'] ?? dialog.props.accessibilityLabel) as string).toBe(title);
    expect(dialog.props['aria-labelledby'] ?? dialog.props.accessibilityLabelledBy).toBe('atr-dialog-title');
    expect(screen.getByTestId('dialog-title').props.nativeID).toBe('atr-dialog-title');
  });

  it('renders the title exactly once as visible text and exposes a single heading', () => {
    const screen = renderView(view);
    const visible = screen.UNSAFE_root.findAll((n) => (n.type as unknown) === 'Text' && n.props.children === title);
    expect(visible).toHaveLength(1);
    expect(screen.queryByTestId('screen-title')).toBeNull();
    const headings = screen.UNSAFE_root.findAll((n) => typeof n.type === 'string' && n.props.role === 'heading');
    expect(headings).toHaveLength(1);
    // The only other place the title appears is the dialog's own accessible name.
    const named = allStrings(screen.toJSON()).filter((s) => s === title);
    expect(named.length).toBeLessThanOrEqual(2);
  });

  it('describes both controls with the body text, so the body is read once with the focused control', () => {
    const screen = renderView(view);
    expect(pressableFor(screen, 'cancel_destructive').props.accessibilityDescribedBy).toEqual(['atr-dialog-body']);
    expect(pressableFor(screen, 'confirm_destructive').props.accessibilityDescribedBy).toEqual(['atr-dialog-body']);
    expect(screen.getByTestId('dialog-body').props.nativeID).toBe('atr-dialog-body');
  });

  it('keeps the frame out of the way: no status chips, no duplicate body', () => {
    const screen = renderView(view);
    expect(screen.queryByTestId('status-row')).toBeNull();
    expect(screen.queryByTestId('body')?.props.children).toEqual([]);
  });
});

describe('A11Y-02: initial focus', () => {
  it('Cancel keeps the initial focus of the destructive dialog', () => {
    const screen = renderView(confirmDialogDestructive);
    expect(preferredPressables(screen).map((n) => n.props.testID)).toEqual(['action-cancel_destructive']);
  });
});
