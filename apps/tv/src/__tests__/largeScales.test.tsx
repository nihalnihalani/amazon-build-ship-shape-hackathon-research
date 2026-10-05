import * as ReactNative from 'react-native';
import { within } from '@testing-library/react-native';
import { setUiScaleMock } from '../../jest/mocks/kepler-a11y';
import { everyScreen, home, phraseActiveVisible, phraseReady, pairing, summary, vowelActive } from '../__fixtures__/views';
import { svgElements, renderView } from './testUtils';

function fontSizeOf(node: { props: { style?: unknown } }): number {
  const flat = ReactNative.StyleSheet.flatten(node.props.style as never) as { fontSize?: number };
  return flat.fontSize ?? 0;
}

describe.each([1.25, 1.5, 2])('UI scale %s (jest structure check; real layout is checked by the preview layoutReport)', (scale) => {
  beforeEach(() => setUiScaleMock(scale));

  it.each(everyScreen)('%s: the footer is outside the scrolling area, every enabled control is inside it', (_name, view) => {
    const screen = renderView(view);
    const scroll = screen.getByTestId('screen-scroll');
    expect(screen.getByTestId('footer')).toBeTruthy();
    expect(within(scroll).queryByTestId('footer')).toBeNull();
    const controls = view.dialog === null ? view.actions : [view.dialog.cancel, view.dialog.confirm];
    for (const control of controls) expect(within(scroll).getByTestId('action-' + control.id)).toBeTruthy();
  });

  it('body text and the footer scale with the setting (never capped)', () => {
    const screen = renderView(home);
    expect(fontSizeOf(screen.getByTestId('footer'))).toBe(Math.round(28 * scale));
    const body = screen.getByTestId('body').findAll((n) => (n.type as unknown) === 'Text');
    expect(fontSizeOf(body[0] as never)).toBe(Math.round(32 * scale));
    expect(fontSizeOf(renderView(summary).getAllByTestId('summary-line')[0] as never)).toBe(Math.round(32 * scale));
  });

  it('display sizes are capped: title at most 72, counters at most 208, the phrase at most 108', () => {
    expect(fontSizeOf(renderView(home).getByTestId('screen-title'))).toBe(Math.min(Math.round(56 * scale), 72));
    expect(fontSizeOf(renderView(vowelActive).getByTestId('timer-value'))).toBe(Math.min(Math.round(160 * scale), 208));
    expect(fontSizeOf(renderView(phraseReady).getByTestId('phrase-text'))).toBeLessThanOrEqual(108);
    expect(fontSizeOf(renderView(pairing).getByTestId('pairing-code'))).toBe(Math.min(Math.round(160 * scale), 208));
  });

  it('graphics are capped at 1.25x: dials never exceed the 1.25x radius and the QR stays within 400 px', () => {
    const phrase = renderView(phraseActiveVisible);
    const track = svgElements(phrase.UNSAFE_root, 'Path')[0]?.props.d as string;
    expect(track).toBe('M 36 196 A 160 160 0 0 1 356 196'); // phrase card: never grows
    const vowel = svgElements(renderView(vowelActive).UNSAFE_root, 'Path')[0]?.props.d as string;
    expect(vowel).toBe('M 36 276 A 240 240 0 0 1 516 276'); // measurement screens: never grow
    const qr = svgElements(renderView(pairing).UNSAFE_root, 'Svg').find((n) => typeof n.props.width === 'number' && n.props.width >= 100);
    expect(qr?.props.width).toBeLessThanOrEqual(400);
  });
});

describe('scale 1.0 is unchanged by the large-scale rules', () => {
  beforeEach(() => setUiScaleMock(1));

  it('keeps the design sizes: title 56, counter 160, footer 28, QR at most 320', () => {
    expect(fontSizeOf(renderView(home).getByTestId('screen-title'))).toBe(56);
    expect(fontSizeOf(renderView(vowelActive).getByTestId('timer-value'))).toBe(160);
    expect(fontSizeOf(renderView(home).getByTestId('footer'))).toBe(28);
    const qr = svgElements(renderView(pairing).UNSAFE_root, 'Svg').find((n) => typeof n.props.width === 'number' && n.props.width >= 100);
    expect(qr?.props.width).toBeLessThanOrEqual(320);
    expect(qr?.props.width).toBeGreaterThan(280);
  });
});
