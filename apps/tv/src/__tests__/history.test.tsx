import { historyDays, history } from '../__fixtures__/views';
import { dayAccessibleLabel, dayCaption, dayFraction } from '../screens/HistoryScreen';
import { allStrings, renderView } from './testUtils';

function heightOf(node: { props: { style?: unknown } }): number {
  const style = node.props.style as { height?: number } | Array<{ height?: number }> | undefined;
  if (Array.isArray(style)) return style.reduce((h, s) => (typeof s?.height === 'number' ? s.height : h), 0);
  return style?.height ?? 0;
}

describe('history: 7 bars with weekday labels', () => {
  it('renders seven day columns with their weekday labels', () => {
    const screen = renderView(history);
    for (const day of historyDays) {
      expect(screen.getByTestId('history-day-' + day.date)).toBeTruthy();
    }
    const strings = allStrings(screen.toJSON());
    for (const label of ['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon']) expect(strings).toContain(label);
    expect(historyDays).toHaveLength(7);
  });

  it('shows "No session" for days without data, with no bar and no zero', () => {
    const screen = renderView(history);
    for (const date of ['2026-09-30', '2026-10-02']) {
      expect(screen.getByTestId('history-caption-' + date).props.children).toBe('No session');
      expect(screen.queryByTestId('history-bar-' + date)).toBeNull();
      expect(screen.getByTestId('history-day-' + date).props['aria-label'] ?? screen.getByTestId('history-day-' + date).props.accessibilityLabel).toContain('No session');
    }
  });

  it('draws recorded days with bars scaled to reached / scored (220 px at 1.0)', () => {
    const screen = renderView(history);
    expect(heightOf(screen.getByTestId('history-bar-2026-10-01'))).toBeCloseTo(198, 5); // 9/10
    expect(heightOf(screen.getByTestId('history-bar-2026-09-29'))).toBeCloseTo(132, 5); // 6/10
    expect(heightOf(screen.getByTestId('history-bar-2026-10-05'))).toBeCloseTo(192.5, 5); // 7/8
  });

  it('keeps a recorded zero visible as a stub and distinct from a missing day', () => {
    const screen = renderView(history);
    expect(screen.getByTestId('history-caption-2026-10-03').props.children).toBe('0 of 4 reached');
    expect(heightOf(screen.getByTestId('history-bar-2026-10-03'))).toBe(8); // stub, not 0 and not missing
  });

  it('says "No scored attempts" for a session day with nothing scored', () => {
    const screen = renderView(history);
    expect(screen.getByTestId('history-caption-2026-10-04').props.children).toBe('No scored attempts');
    expect(screen.getByTestId('history-bar-2026-10-04')).toBeTruthy();
  });

  it('marks an incomplete day in words', () => {
    const screen = renderView(history);
    const saturday = allStrings(screen.getByTestId('history-day-2026-10-03').props.children);
    void saturday;
    expect(allStrings(screen.toJSON()).filter((s) => s === 'Incomplete')).toHaveLength(1);
    expect(dayAccessibleLabel(historyDays[4]!)).toContain('Incomplete');
  });

  it('handles an absent history array without crashing', () => {
    const screen = renderView({ ...history, history: null });
    expect(screen.getByTestId('footer')).toBeTruthy();
  });
});

describe('history helpers', () => {
  it('maps days to fractions, null for missing', () => {
    expect(dayFraction(historyDays[1]!)).toBeNull();
    expect(dayFraction(historyDays[0]!)).toBeCloseTo(0.6, 9);
    expect(dayFraction(historyDays[4]!)).toBe(0);
    expect(dayFraction(historyDays[5]!)).toBe(0);
  });

  it('captions in words', () => {
    expect(dayCaption(historyDays[1]!)).toBe('No session');
    expect(dayCaption(historyDays[2]!)).toBe('9 of 10 reached');
  });
});
