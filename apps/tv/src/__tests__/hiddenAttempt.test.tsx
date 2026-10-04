import { isHiddenFromAccessibility } from '@testing-library/react-native';
import { Path } from '@amazon-devices/react-native-svg';
import { makeView, phraseActiveHidden, phraseActiveVisible, phraseLead } from '../__fixtures__/views';
import { allStrings, renderView } from './testUtils';

/**
 * Words and numbers that would reveal a level or a verdict. None may be rendered, spoken or labelled while a
 * hidden first attempt is open (ADR-0004). "meter" itself is allowed: the blind-check label says the meter is hidden.
 */
const LEAK = /\bdB\b|\bband\b|above|below|reached|did not reach|not scored|louder|quieter|too (quiet|loud)|relative level|waiting for voice|\d+(\.\d+)?\s?dB/i;

describe('hidden first attempt (view.meter === null while capturing)', () => {
  it('does not mount the arc, the band tick, the cue or any SVG path', () => {
    const screen = renderView(phraseActiveHidden);
    for (const id of ['arc-meter', 'arc-fill', 'arc-band-tick', 'arc-cue-text', 'arc-cue-glyph', 'arc-caption', 'arc-legend']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.UNSAFE_queryAllByType(Path)).toHaveLength(0);
  });

  it('renders no text, label or hint that contains a level or verdict word', () => {
    const screen = renderView(phraseActiveHidden);
    const strings = allStrings(screen.toJSON());
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) expect(s).not.toMatch(LEAK);
    // It does show what a hidden attempt may show: the phrase, the blind-check label, the timer.
    expect(strings).toContain(phraseActiveHidden.phrase?.text);
    expect(strings.join(' ')).toContain('Blind check');
    expect(screen.getByTestId('timer')).toBeTruthy();
  });

  it('is silent for screen readers while capturing: empty, switched-off live region and hidden timer', () => {
    const screen = renderView({ ...phraseActiveHidden, announcement: 'Reached the far side' });
    expect(screen.queryByTestId('live-region-text')).toBeNull();
    expect(screen.getByTestId('live-region').props['aria-live']).toBe('off');
    expect(isHiddenFromAccessibility(screen.getByTestId('timer'))).toBe(true);
    // The heading role is withheld while capturing so a screen change does not read the title over the window.
    expect(screen.getByTestId('screen-title').props.role).toBeUndefined();
  });

  it('offers only the two emergency controls during the window (Stop now, Cancel window), with no level or verdict wording', () => {
    const screen = renderView(phraseActiveHidden);
    expect(screen.queryAllByRole('button').map((n) => n.props.testID)).toEqual(['action-stop_early', 'action-cancel']);
    for (const s of allStrings(screen.toJSON())) expect(s).not.toMatch(LEAK);
  });

  it('has no controls at all during the quiet lead and the precheck (Back cancels)', () => {
    const screen = renderView(phraseLead);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByTestId('arc-meter')).toBeNull();
  });

  it('shows the arc for a visible attempt, so the guarantee comes from the view and not from a missing screen', () => {
    const screen = renderView(phraseActiveVisible);
    expect(screen.getByTestId('arc-meter')).toBeTruthy();
    expect(screen.getByTestId('arc-band-tick')).toBeTruthy();
    expect(screen.getByTestId('arc-cue-text').props.children).toBe('Above band now'); // 12.5 >= 9
    expect(screen.UNSAFE_queryAllByType(Path).length).toBeGreaterThan(0);
  });
});

describe('meter present but without a level or a band yet', () => {
  it('draws only the track and says it is waiting for voice', () => {
    const view = makeView({
      screen: 'calibration',
      stage: 'calibration',
      capturing: true,
      meter: { levelRelDb: null, bandRelDb: null, active: false, caption: 'Relative level, this session only' },
    });
    const screen = renderView(view);
    expect(screen.getByTestId('arc-meter')).toBeTruthy();
    expect(screen.queryByTestId('arc-fill')).toBeNull();
    expect(screen.queryByTestId('arc-band-tick')).toBeNull();
    expect(screen.getByTestId('arc-cue-text').props.children).toBe('Waiting for voice');
  });
});
