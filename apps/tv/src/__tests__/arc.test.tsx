import { act, isHiddenFromAccessibility, render } from '@testing-library/react-native';
import { phraseActiveVisible, makeView } from '../__fixtures__/views';
import { setUiScaleMock } from '../../jest/mocks/kepler-a11y';
import { ScreenRouter } from '../screens';
import { ArcMeter } from '../ui/ArcMeter';
import { renderView, svgElements } from './testUtils';

function viewWithMeter(levelRelDb: number | null, bandRelDb: number | null, capturing = false, active = true) {
  return makeView({
    screen: 'vowel',
    stage: 'vowel_active',
    capturing,
    meter: { levelRelDb, bandRelDb, active, caption: 'Relative level, this session only' },
  });
}

function renderFullSize(level: number | null, band: number | null) {
  const meter = { levelRelDb: level, bandRelDb: band, active: true, caption: 'Relative level, this session only' };
  return render(<ArcMeter meter={meter} capturing={false} />);
}

describe('arc geometry as rendered by the component (scale 1.0: radius 300, stroke 36, centre 336,336)', () => {
  it('draws the track from the left end over the top to the right end', () => {
    const screen = renderFullSize(10, 10);
    const paths = svgElements(screen.UNSAFE_root, 'Path');
    expect(paths[0]?.props.d).toBe('M 36 336 A 300 300 0 0 1 636 336');
    expect(paths[0]?.props.strokeWidth).toBe(36);
  });

  it('fills from the floor to +10 dB (half the range) and places the band tick at the top', () => {
    const screen = renderFullSize(10, 10);
    // +10 dB is fraction 0.5 = 90 deg = straight up: endpoint (336, 36).
    expect(screen.getByTestId('arc-fill').props.d).toBe('M 36 336 A 300 300 0 0 1 336 36');
    // Band +10 dB: tick on the vertical from radius 264 to 336: y 72 to 0.
    expect(screen.getByTestId('arc-band-tick').props.d).toBe('M 336 72 L 336 0');
  });

  it('fills the whole track at or above +30 dB and nothing at or below -10 dB', () => {
    expect(renderFullSize(45, null).getByTestId('arc-fill').props.d).toBe('M 36 336 A 300 300 0 0 1 636 336');
    expect(renderFullSize(-10, null).queryByTestId('arc-fill')).toBeNull();
    expect(renderFullSize(-60, null).queryByTestId('arc-fill')).toBeNull();
  });

  it('draws no band tick before calibration (band null)', () => {
    expect(renderFullSize(5, null).queryByTestId('arc-band-tick')).toBeNull();
  });

  it('says when the band is off the scale instead of pinning silently', () => {
    expect(renderFullSize(5, 45).getByTestId('arc-legend').props.children).toContain('above the scale');
  });

  it('scales the whole dial with the UI scale (1.5: radius 450, centre 504)', () => {
    setUiScaleMock(1.5);
    const paths = svgElements(renderFullSize(10, 10).UNSAFE_root, 'Path');
    expect(paths[0]?.props.d).toBe('M 54 504 A 450 450 0 0 1 954 504');
    expect(paths[0]?.props.strokeWidth).toBe(54);
  });
});

describe('dial on the sustained-sound, calibration and quiet-check screens (radius 240, stroke 36, centre 276,276)', () => {
  const meter = { levelRelDb: 10, bandRelDb: 10, active: true, caption: 'Relative level, this session only' };
  it.each([
    ['vowel', 'vowel_active'],
    ['calibration', 'calibration'],
    ['quiet_check', 'quiet_check'],
  ] as const)('%s draws the radius 240 dial', (screenId, stage) => {
    const screen = renderView(makeView({ screen: screenId, stage, meter }));
    const paths = svgElements(screen.UNSAFE_root, 'Path');
    expect(paths[0]?.props.d).toBe('M 36 276 A 240 240 0 0 1 516 276');
    expect(screen.getByTestId('arc-fill').props.d).toBe('M 36 276 A 240 240 0 0 1 276 36');
    // inner radius 204 -> y 72, outer radius 276 -> y 0
    expect(screen.getByTestId('arc-band-tick').props.d).toBe('M 276 72 L 276 0');
  });
});

describe('compact dial on the phrase card (radius 180, stroke 36, centre 216,216)', () => {
  it('draws a smaller dial so phrase, dial and timer fit one screen', () => {
    const view = makeView({
      screen: 'phrase',
      stage: 'phrase_active',
      meter: { levelRelDb: 10, bandRelDb: 10, active: true, caption: 'Relative level, this session only' },
    });
    const screen = renderView(view);
    const paths = svgElements(screen.UNSAFE_root, 'Path');
    expect(paths[0]?.props.d).toBe('M 36 216 A 180 180 0 0 1 396 216');
    expect(screen.getByTestId('arc-fill').props.d).toBe('M 36 216 A 180 180 0 0 1 216 36');
    // inner radius 144 -> y 72, outer radius 216 -> y 0
    expect(screen.getByTestId('arc-band-tick').props.d).toBe('M 216 72 L 216 0');
  });
});

describe('cue and accessibility', () => {
  it('pairs the arc with a text cue and a shape glyph', () => {
    const screen = renderView(viewWithMeter(20, 10));
    expect(screen.getByTestId('arc-cue-text').props.children).toBe('Above band now');
    expect(screen.getByTestId('arc-cue-glyph')).toBeTruthy();
    const below = renderView(viewWithMeter(2, 10));
    expect(below.getByTestId('arc-cue-text').props.children).toBe('Below band now');
  });

  it('labels the arc for screen readers when no window is open and hides it while capturing', () => {
    const idle = renderView(viewWithMeter(20, 10, false));
    const idleArc = idle.getByTestId('arc-meter');
    expect(isHiddenFromAccessibility(idleArc)).toBe(false);
    expect(idleArc.props.accessibilityLabel ?? idleArc.props['aria-label']).toContain('Above band now');

    const live = renderView(viewWithMeter(20, 10, true));
    const liveArc = live.getByTestId('arc-meter');
    expect(isHiddenFromAccessibility(liveArc)).toBe(true);
    expect(liveArc.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('hides the visible-attempt arc from accessibility while the window is open', () => {
    const screen = renderView(phraseActiveVisible);
    expect(phraseActiveVisible.capturing).toBe(true);
    expect(screen.getByTestId('arc-meter').props.importantForAccessibility).toBe('no-hide-descendants');
    expect(isHiddenFromAccessibility(screen.getByTestId('timer'))).toBe(true);
  });
});

describe('display smoothing (display only)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('glides toward a new level instead of jumping, using frame arrival time', () => {
    const screen = renderView(viewWithMeter(0, 10));
    const first = screen.getByTestId('arc-fill').props.d as string;
    expect(first).toBe('M 36 276 A 240 240 0 0 1 ' + first.split(' ').slice(-2).join(' ')); // 0 dB: fraction 0.25 (135 deg)
    jest.setSystemTime(1_000_000 + 120);
    act(() => {
      screen.rerender(<ScreenRouter view={viewWithMeter(20, 10)} onAction={() => undefined} />);
    });
    const second = screen.getByTestId('arc-fill').props.d as string;
    const endX = Number(second.split(' ').slice(-2)[0]);
    // Radius 240, centre 276. Raw 20 dB would end at fraction 0.75 (45 deg): x = 276 + 240 cos 45 = 445.7.
    // After one attack constant (120 ms) the displayed level has covered 63.2 % of 0 -> 20 dB = 12.64 dB,
    // fraction (12.64 + 10) / 40 = 0.566 (78.1 deg): x = 276 + 240 cos 78.1 deg = 325.5.
    expect(endX).toBeGreaterThan(315);
    expect(endX).toBeLessThan(340);
    expect(Math.abs(endX - 445.7)).toBeGreaterThan(80);
  });
});
