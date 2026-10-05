import { isHiddenFromAccessibility } from '@testing-library/react-native';
import { phraseCapturingBannerAndCue, makeView, revealReached } from '../__fixtures__/views';
import { ScreenRouter } from '../screens';
import { preferredPressables, renderView } from './testUtils';
import { render } from '@testing-library/react-native';

describe('A8-01: banners, cue chips and labels are visual only while capturing', () => {
  let screen: ReturnType<typeof renderView>;
  beforeEach(() => {
    screen = renderView(phraseCapturingBannerAndCue);
  });

  it('renders the banner and the cue chip (they are visible)', () => {
    expect(screen.getByTestId('banner')).toBeTruthy();
    expect(screen.getByTestId('cue-chip')).toBeTruthy();
    expect(screen.getByTestId('labels')).toBeTruthy();
    expect(screen.getByTestId('status-mic')).toBeTruthy();
  });

  it.each(['banner', 'cue-chip', 'status-mic', 'status-link'])('%s is not an accessibility element and is hidden from the tree', (id) => {
    const node = screen.getByTestId(id);
    expect(isHiddenFromAccessibility(node)).toBe(true);
    expect(node.props.accessible).toBe(false);
    expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(node.props.accessibilityLabel).toBeUndefined();
    expect(node.props['aria-label']).toBeUndefined();
  });

  it('the persistent labels are visual only too', () => {
    const labels = screen.getByTestId('labels');
    const chip = labels.findAll((n) => typeof n.type === 'string' && n.props.accessible === false);
    expect(chip.length).toBeGreaterThan(0);
  });

  it('has no announcement and no live region that could speak: the live region is off and empty', () => {
    expect(screen.queryByTestId('live-region-text')).toBeNull();
    expect(screen.getByTestId('live-region').props['aria-live']).toBe('off');
    const everyLive = screen.UNSAFE_root.findAll((n) => typeof n.type === 'string' && n.props['aria-live'] !== undefined);
    for (const node of everyLive) expect(node.props['aria-live']).toBe('off');
  });

  it('does not use an alert role anywhere', () => {
    const alerts = screen.UNSAFE_root.findAll((n) => n.props.role === 'alert' || n.props.accessibilityRole === 'alert');
    expect(alerts).toHaveLength(0);
  });

  it('keeps the arc and the timer hidden and the emergency controls focusable and labelled', () => {
    expect(isHiddenFromAccessibility(screen.getByTestId('arc-meter'))).toBe(true);
    expect(isHiddenFromAccessibility(screen.getByTestId('timer'))).toBe(true);
    expect(isHiddenFromAccessibility(screen.getByTestId('action-stop_early'))).toBe(false);
    expect(isHiddenFromAccessibility(screen.getByTestId('action-cancel'))).toBe(false);
  });
});

describe('A8-01: the same content is exposed normally once capture has closed', () => {
  it('banner, cue chip and chips become labelled accessibility elements (their announcement is no longer deferred)', () => {
    const view = makeView({ ...phraseCapturingBannerAndCue, capturing: false, announcement: 'Ready for the next phrase' });
    const screen = renderView(view);
    const banner = screen.getByTestId('banner');
    expect(isHiddenFromAccessibility(banner)).toBe(false);
    expect(banner.props.accessibilityLabel ?? banner.props['aria-label']).toBe('Warning: The room is getting noisy');
    expect(screen.getByTestId('cue-chip').props.accessibilityLabel ?? screen.getByTestId('cue-chip').props['aria-label']).toBe('Cue: Louder');
    expect(screen.getByTestId('live-region').props['aria-live']).toBe('polite');
    expect(screen.getByTestId('live-region-text').props.children).toBe('Ready for the next phrase');
  });

  it('is unchanged for a plain reveal screen', () => {
    const screen = renderView(revealReached);
    expect(isHiddenFromAccessibility(screen.getByTestId('status-link'))).toBe(false);
  });
});

describe('A8-01: no focus moves mid-capture', () => {
  it('freezes the preferred focus while capturing even if the view changes its preferred action', () => {
    const first = makeView({ ...phraseCapturingBannerAndCue, preferredAction: 'stop_early' });
    const screen = render(<ScreenRouter view={first} onAction={() => undefined} />);
    expect(preferredPressables(screen).map((n) => n.props.testID)).toEqual(['action-stop_early']);
    screen.rerender(<ScreenRouter view={{ ...first, preferredAction: 'cancel' }} onAction={() => undefined} />);
    expect(preferredPressables(screen).map((n) => n.props.testID)).toEqual(['action-stop_early']);
  });

  it('follows the view again once the window closes', () => {
    const first = makeView({ ...phraseCapturingBannerAndCue, preferredAction: 'stop_early' });
    const screen = render(<ScreenRouter view={first} onAction={() => undefined} />);
    screen.rerender(<ScreenRouter view={{ ...first, preferredAction: 'cancel' }} onAction={() => undefined} />);
    screen.rerender(<ScreenRouter view={{ ...first, capturing: false, preferredAction: 'cancel' }} onAction={() => undefined} />);
    expect(preferredPressables(screen).map((n) => n.props.testID)).toEqual(['action-cancel']);
  });

  it('moves focus normally when the controls themselves change at capture start', () => {
    const before = makeView({
      screen: 'phrase',
      stage: 'phrase_ready',
      actions: [{ id: 'begin_phrase', label: 'Begin' }],
      preferredAction: 'begin_phrase',
    });
    const screen = render(<ScreenRouter view={before} onAction={() => undefined} />);
    expect(preferredPressables(screen).map((n) => n.props.testID)).toEqual(['action-begin_phrase']);
    screen.rerender(<ScreenRouter view={phraseCapturingBannerAndCue} onAction={() => undefined} />);
    expect(preferredPressables(screen).map((n) => n.props.testID)).toEqual(['action-stop_early']);
  });

  it('never calls a programmatic focus method (the UI has no focus() call)', () => {
    const fs = jest.requireActual('node:fs') as typeof import('node:fs');
    const path = jest.requireActual('node:path') as typeof import('node:path');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === '__tests__' || e.name === '__fixtures__' ? [] : walk(full);
        return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
      });
    const offenders = walk(path.resolve(__dirname, '..')).filter((f) => /\.focus\(|requestFocus|setNativeProps|FocusManager/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
