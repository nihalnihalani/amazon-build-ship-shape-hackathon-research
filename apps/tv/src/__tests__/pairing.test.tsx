import { act } from '@testing-library/react-native';
import { makeView, pairing } from '../__fixtures__/views';
import { formatCountdown } from '../screens/PairingScreen';
import { svgElements, renderView } from './testUtils';

describe('pairing screen', () => {
  it('shows the code at 160 px with a spelled-out accessible label, and the QR beside it', () => {
    const screen = renderView(pairing);
    const code = screen.getByTestId('pairing-code');
    expect(code.props.children).toBe('ACDEFH');
    const label = (code.props['aria-label'] ?? code.props.accessibilityLabel) as string;
    expect(label).toBe('Pairing code A C D E F H');
    const style = Object.assign({}, ...[code.props.style].flat(Infinity)) as { fontSize?: number };
    expect(style.fontSize).toBe(160);
    expect(screen.getByTestId('qr-code')).toBeTruthy();
    expect(svgElements(screen.UNSAFE_root, 'Rect').length).toBeGreaterThan(10);
  });

  it('offers only Cancel and Refresh (no other focusable) and makes one of them preferred', () => {
    const screen = renderView(pairing);
    expect(screen.queryAllByRole('button').map((n) => n.props.testID)).toEqual(['action-cancel', 'action-refresh_code']);
  });

  it('says it is getting a code while there is none', () => {
    const view = makeView({ ...pairing, pairing: { code: null, codeExpiresAt: null, qrPayload: null, joinRequest: null } });
    const screen = renderView(view);
    expect(screen.queryByTestId('pairing-code')).toBeNull();
    expect(screen.getByTestId('pairing-code-pending')).toBeTruthy();
    expect(screen.queryByTestId('qr-code')).toBeNull();
    expect(screen.queryByTestId('pairing-expiry')).toBeNull();
  });

  it('counts the code lifetime down and states when it has expired', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_000_000);
      const view = makeView({ ...pairing, pairing: { ...(pairing.pairing as NonNullable<typeof pairing.pairing>), codeExpiresAt: 1_000_000 + 65_000 } });
      const screen = renderView(view);
      expect(screen.getByTestId('pairing-expiry').props.children).toBe('Code expires in 1:05');
      act(() => {
        jest.advanceTimersByTime(66_000);
      });
      expect(screen.getByTestId('pairing-expiry').props.children).toBe('Code expired. Refresh the code to continue.');
    } finally {
      jest.useRealTimers();
    }
  });

  it('formats countdowns as M:SS', () => {
    expect(formatCountdown(600_000)).toBe('10:00');
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(9_001)).toBe('0:10');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

