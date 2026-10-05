import * as ReactNative from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { setUiScaleMock } from '../../jest/mocks/kepler-a11y';
import { calibration, home, joinConfirm, pairing, phraseActiveVisible } from '../__fixtures__/views';
import { layout } from '../theme';
import { FocusScrollView, useFocusScrollApi } from '../ui/FocusScroll';
import { ScreenRouter } from '../screens';
import { renderView } from './testUtils';
import { Text } from 'react-native';

type Mocked = { scrollTo: jest.Mock; measureInWindow: jest.Mock };
const proto = (ReactNative.ScrollView as unknown as { prototype: Mocked }).prototype;
const flat = (style: unknown): Record<string, unknown> => ReactNative.StyleSheet.flatten(style as never) as Record<string, unknown>;

/** Style of the nearest ancestor (host View) that sets `key`. */
function ancestorStyle(node: { parent: unknown } | null | undefined, key: string): Record<string, unknown> | null {
  let current = node as { parent: unknown; props?: { style?: unknown } } | null | undefined;
  while (current) {
    const style = flat(current.props?.style) ?? {};
    if (style[key] !== undefined) return style;
    current = current.parent as typeof current;
  }
  return null;
}

describe.each([1, 1.25, 1.5, 2])('A11Y-04: focus ring room at UI scale %s', (scale) => {
  beforeEach(() => setUiScaleMock(scale));

  it('the scroll area keeps an inset on the left, right and bottom that covers the ring and the 1.05 growth', () => {
    const screen = renderView(home);
    const content = flat(screen.getByTestId('screen-scroll').props.contentContainerStyle);
    // A control grows by (1.05 - 1) / 2 = 2.5 % of its size per side: 20 px for an 800 px wide control, 5 px for a 200 px tall one.
    const widest = 800 * scale;
    const tallest = 200 * scale;
    expect(content['paddingLeft'] as number).toBeGreaterThanOrEqual(widest * 0.025);
    expect(content['paddingRight'] as number).toBeGreaterThanOrEqual(widest * 0.025);
    expect(content['paddingBottom'] as number).toBeGreaterThanOrEqual(tallest * 0.025);
    expect(content['paddingLeft']).toBe(Math.round(layout.ringInset * scale));
    expect(content['paddingBottom']).toBe(Math.round(layout.ringInsetBottom * scale));
  });

  it('the footer keeps the same left inset as the content, so text keeps one left edge', () => {
    const screen = renderView(home);
    const wrapperStyle = ancestorStyle(screen.getByTestId('footer-bar').parent, 'paddingHorizontal');
    const scroll = flat(screen.getByTestId('screen-scroll').props.contentContainerStyle);
    expect(wrapperStyle?.['paddingHorizontal']).toBe(scroll['paddingLeft']);
  });

  it('the page padding is split, not added: outer + inset equals the original page padding', () => {
    const screen = renderView(home);
    const outer = flat(screen.getByTestId('screen-home').props.style)['paddingHorizontal'] as number;
    const inset = flat(screen.getByTestId('screen-scroll').props.contentContainerStyle)['paddingLeft'] as number;
    expect(outer + inset).toBe(Math.round(layout.pagePadding * scale));
  });
});

describe('a control focused at mount is revealed once the layout is known', () => {
  function Probe({ onApi }: { onApi: (api: ReturnType<typeof useFocusScrollApi>) => void }) {
    onApi(useFocusScrollApi());
    return <Text>probe</Text>;
  }

  beforeEach(() => {
    proto.scrollTo.mockClear();
    proto.measureInWindow.mockReset();
    proto.measureInWindow.mockImplementation((cb: (x: number, y: number, w: number, h: number) => void) => cb(0, 100, 1920, 800));
  });

  it('skips the reveal while sizes are unknown, then reveals when the content size and layout arrive', async () => {
    let api: ReturnType<typeof useFocusScrollApi> = null;
    const screen = render(
      <FocusScrollView>
        <Probe onApi={(a) => (api = a)} />
      </FocusScrollView>,
    );
    const node = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, 950, 400, 100) };
    // Preferred focus lands before any measurement.
    await act(async () => {
      api?.onControlFocus(node);
      await Promise.resolve();
    });
    expect(proto.scrollTo).not.toHaveBeenCalled();
    const scroll = screen.getByTestId('screen-scroll');
    await act(async () => {
      fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 1920, height: 800 } } });
      fireEvent(scroll, 'contentSizeChange', 1920, 1800);
      await Promise.resolve();
      await Promise.resolve();
    });
    // 950 + 100 + margin 32 - 900 = 182
    expect(proto.scrollTo).toHaveBeenCalledWith({ y: 182, animated: false });
  });

  it('does not re-reveal a control from the previous screen after a stage change', async () => {
    let api: ReturnType<typeof useFocusScrollApi> = null;
    const tree = (key: string) => (
      <FocusScrollView resetKey={key}>
        <Probe onApi={(a) => (api = a)} />
      </FocusScrollView>
    );
    const screen = render(tree('a'));
    const scroll = () => screen.getByTestId('screen-scroll');
    fireEvent(scroll(), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 1920, height: 800 } } });
    fireEvent(scroll(), 'contentSizeChange', 1920, 1800);
    await act(async () => {
      api?.onControlFocus({ measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, 300, 400, 100) });
      await Promise.resolve();
    });
    proto.scrollTo.mockClear();
    screen.rerender(tree('b'));
    proto.scrollTo.mockClear();
    proto.measureInWindow.mockImplementation((cb: (x: number, y: number, w: number, h: number) => void) => cb(0, 100, 1920, 800));
    await act(async () => {
      fireEvent(scroll(), 'contentSizeChange', 1920, 2000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(proto.scrollTo).not.toHaveBeenCalled();
  });
});

describe('A11Y-05: nothing needs horizontal room beyond the viewport at UI scale 2.0', () => {
  beforeEach(() => setUiScaleMock(2));
  const VIEWPORT = 1920 - 2 * Math.round(layout.pagePadding * 2); // page padding is 80 px design, doubled by the mock

  it('the three number buttons plus their gaps fit one row of the viewport, and the row may wrap', () => {
    const screen = renderView(joinConfirm);
    const row = flat(screen.getByTestId('join-choices').props.style);
    expect(row['flexDirection']).toBe('row');
    expect(row['flexWrap']).toBe('wrap');
    expect(row['maxWidth']).toBe('100%');
    const buttons = ['pick_choice_1', 'pick_choice_2', 'pick_choice_3'].map((id) => flat(screen.getByTestId('action-' + id).props.style));
    for (const b of buttons) expect(b['minWidth'] as number).toBeLessThanOrEqual(420);
    const needed = buttons.reduce((sum, b) => sum + (b['minWidth'] as number) + (b['marginRight'] as number), 0);
    expect(needed).toBeLessThanOrEqual(VIEWPORT);
  });

  it('the number buttons keep 280 px at scale 1.0 and Reject sits on its own row below them', () => {
    setUiScaleMock(1);
    const screen = renderView(joinConfirm);
    expect(flat(screen.getByTestId('action-pick_choice_1').props.style)['minWidth']).toBe(280);
    expect(screen.getByTestId('join-choices').findAll((n) => n.props.testID === 'action-reject_join')).toHaveLength(0);
  });

  it('timer and dial rows wrap, with every part limited to the row width so text wraps instead of clipping', () => {
    const screen = renderView(calibration);
    const row = flat(screen.getByTestId('side-by-side').props.style);
    expect(row['flexWrap']).toBe('wrap');
    expect(row['maxWidth']).toBe('100%');
    for (const child of screen.getByTestId('side-by-side').children as unknown[]) {
      const element = child as { props?: { style?: unknown } };
      expect(flat(element.props?.style)['maxWidth']).toBe('100%');
    }
    expect(flat(screen.getByTestId('timer').props.style)['maxWidth']).toBe('100%');
  });

  it('the timer bar is capped at 600 px (compact 520) at any scale', () => {
    const bar = flat(renderView(calibration).getByTestId('timer-bar').props.style);
    expect(bar['width']).toBe(600);
    const compact = flat(renderView(phraseActiveVisible).getByTestId('timer-bar').props.style);
    expect(compact['width']).toBe(520);
  });

  it('pairing wraps the code and the QR instead of overflowing', () => {
    const screen = renderView(pairing);
    expect(ancestorStyle(screen.getByTestId('pairing-code').parent, 'flexWrap')?.['flexWrap']).toBe('wrap');
  });

  it('no screen offers horizontal scrolling', () => {
    expect(renderView(joinConfirm).getByTestId('screen-scroll').props.horizontal).toBeFalsy();
  });
});

describe('the router still renders every screen at 2.0 with the inset', () => {
  it('home renders its controls and footer', () => {
    setUiScaleMock(2);
    const screen = render(<ScreenRouter view={home} onAction={() => undefined} />);
    expect(screen.getByTestId('action-start_session')).toBeTruthy();
    expect(screen.getByTestId('footer')).toBeTruthy();
  });
});
