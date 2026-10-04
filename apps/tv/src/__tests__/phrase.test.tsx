import * as ReactNative from 'react-native';
import { estimateLines, fitPhrase } from '../layout/fitPhrase';
import { phraseActiveHidden, phraseActiveVisible, phraseReady } from '../__fixtures__/views';
import { setUiScaleMock } from '../../jest/mocks/kepler-a11y';
import { renderView } from './testUtils';

function fontSizeOf(node: { props: { style?: unknown } }): number {
  const flat = ReactNative.StyleSheet.flatten(node.props.style as never) as { fontSize?: number };
  return flat.fontSize ?? 0;
}

describe('phrase auto-shrink (hand-computed at width 1760 px, 0.58 em per character)', () => {
  const nineWordsOfSeven = Array.from({ length: 9 }, () => 'abcdefg').join(' '); // 71 characters

  it('characters per line: 96 px = 31, 88 px = 34, 80 px = 37, 72 px = 42', () => {
    // 4 words of 7 characters fill 31 characters exactly: one line holds 4 words at 96 px.
    expect(estimateLines('abcdefg abcdefg abcdefg abcdefg', 96, 1760)).toBe(1);
    expect(estimateLines('abcdefg abcdefg abcdefg abcdefg abcdefg', 96, 1760)).toBe(2);
    // 5 words = 39 characters: too long for 34 and 37 per line, fits in 42.
    expect(estimateLines('abcdefg abcdefg abcdefg abcdefg abcdefg', 88, 1760)).toBe(2);
    expect(estimateLines('abcdefg abcdefg abcdefg abcdefg abcdefg abcdefg', 72, 1760)).toBe(2); // 5 + 1 words
  });

  it('keeps 96 px for a short phrase', () => {
    expect(fitPhrase('Buy Bobby a puppy', 1760, 1)).toEqual({ baseSize: 96, lines: 1, fitsTwoLines: true });
  });

  it('keeps 96 px when two lines are enough', () => {
    const text = Array.from({ length: 8 }, () => 'abcdefg').join(' ');
    expect(fitPhrase(text, 1760, 1)).toEqual({ baseSize: 96, lines: 2, fitsTwoLines: true });
  });

  it('shrinks to 72 px when that is the first size that fits two lines (9 words of 7 characters)', () => {
    // 96: 4 per line = 3 lines; 88: 4 per line = 3 lines; 80: 4 per line = 3 lines; 72: 5 per line = 2 lines.
    expect(fitPhrase(nineWordsOfSeven, 1760, 1)).toEqual({ baseSize: 72, lines: 2, fitsTwoLines: true });
  });

  it('accounts for a larger UI scale (at 4x the glyphs are 4 times wider)', () => {
    // 96 * 4 = 384 px: floor(1760 / 222.7) = 7 characters per line -> "Buy" / "Bobby a" / "puppy" = 3 lines.
    // 88 * 4 = 352 px: 8 characters per line -> "Buy" / "Bobby a" / "puppy" = 3 lines.
    // 80 * 4 = 320 px: 9 characters per line -> "Buy Bobby" / "a puppy" = 2 lines.
    expect(fitPhrase('Buy Bobby a puppy', 1760, 4)).toEqual({ baseSize: 80, lines: 2, fitsTwoLines: true });
  });

  it('never truncates: an unfittable phrase uses 72 px and reports it', () => {
    const result = fitPhrase('x'.repeat(200), 1760, 1);
    expect(result.baseSize).toBe(72);
    expect(result.fitsTwoLines).toBe(false);
  });

  it('breaks a word that is longer than a line', () => {
    // 100 characters at 42 per line = 3 lines
    expect(estimateLines('x'.repeat(100), 72, 1760)).toBe(3);
  });
});

describe('phrase screen text sizes', () => {
  beforeEach(() => {
    jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width: 1920, height: 1080, scale: 1, fontScale: 1 });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the phrase between 72 and 96 px at scale 1.0', () => {
    const screen = renderView(phraseReady);
    const size = fontSizeOf(screen.getByTestId('phrase-text'));
    expect(size).toBeGreaterThanOrEqual(72);
    expect(size).toBeLessThanOrEqual(96);
    expect(screen.getByTestId('phrase-text').props.children).toBe('Buy Bobby a puppy');
  });

  it('enlarges the phrase with the UI scale', () => {
    const base = fontSizeOf(renderView(phraseReady).getByTestId('phrase-text'));
    setUiScaleMock(1.25);
    const scaled = fontSizeOf(renderView(phraseReady).getByTestId('phrase-text'));
    expect(scaled).toBeGreaterThan(base);
  });

  it('shows the position counter and the attempt number after a retry', () => {
    expect(renderView(phraseReady).getByTestId('phrase-counter').props.children).toBe('3 of 10');
    const retry = { ...phraseReady, phrase: { position: 3, total: 10, text: 'Buy Bobby a puppy', attemptNumber: 2 } };
    expect(renderView(retry).getByTestId('phrase-counter').props.children).toBe('3 of 10 · Attempt 2');
  });

  it('keeps body text at least 32 px, labels at 40 px and the footer at 28 px at scale 1.0', () => {
    const screen = renderView(phraseActiveVisible);
    expect(fontSizeOf(screen.getByTestId('footer'))).toBe(28);
    expect(fontSizeOf(screen.getByTestId('timer-label'))).toBeGreaterThanOrEqual(32);
    expect(fontSizeOf(screen.getByTestId('arc-cue-text'))).toBe(40);
    expect(fontSizeOf(screen.getByTestId('timer-value'))).toBe(160);
  });

  it('shows no arc for the hidden attempt but still the phrase', () => {
    const screen = renderView(phraseActiveHidden);
    expect(screen.getByTestId('phrase-text')).toBeTruthy();
    expect(screen.queryByTestId('arc-meter')).toBeNull();
  });
});
