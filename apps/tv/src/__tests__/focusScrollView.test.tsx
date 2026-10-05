import { ScrollView, Text } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { emitTVEvent } from '../../jest/mocks/react-native-kepler';
import { home, phraseActiveVisible, phraseReady, settings, summary } from '../__fixtures__/views';
import { FOCUS_SETTLE_MS, FocusScrollView, useFocusScrollApi } from '../ui/FocusScroll';
import { ScreenRouter } from '../screens';
import { renderView } from './testUtils';

type Mocked = { scrollTo: jest.Mock; measureInWindow: jest.Mock };
const proto = (ScrollView as unknown as { prototype: Mocked }).prototype;

function Probe({ onApi }: { onApi: (api: ReturnType<typeof useFocusScrollApi>) => void }) {
  onApi(useFocusScrollApi());
  return <Text>probe</Text>;
}

describe('screen structure for large UI scales', () => {
  it('keeps the footer outside the scrolling area and every control inside it', () => {
    const screen = renderView(settings);
    const scroll = screen.getByTestId('screen-scroll');
    expect(within(scroll).queryByTestId('footer')).toBeNull();
    expect(screen.getByTestId('footer')).toBeTruthy();
    for (const action of settings.actions) expect(within(scroll).getByTestId('action-' + action.id)).toBeTruthy();
    expect(within(scroll).getByTestId('screen-title')).toBeTruthy();
  });

  it('keeps the live region outside the scrolling area too', () => {
    const screen = renderView(home);
    expect(within(screen.getByTestId('screen-scroll')).queryByTestId('live-region')).toBeNull();
    expect(screen.getByTestId('live-region')).toBeTruthy();
  });

  it('is a vertical, non-focusable scroller without indicators', () => {
    const scroll = renderView(summary).getByTestId('screen-scroll');
    expect(scroll.props.focusable).toBe(false);
    expect(scroll.props.showsVerticalScrollIndicator).toBe(false);
    expect(scroll.props.horizontal).toBeFalsy();
  });
});

describe('a new screen or stage starts at the top', () => {
  it('scrolls back to 0 when the stage changes inside the same screen component, not when only the content changes', () => {
    proto.scrollTo.mockClear();
    const screen = renderView(phraseReady);
    fireEvent.scroll(screen.getByTestId('screen-scroll'), { nativeEvent: { contentOffset: { x: 0, y: 300 } } });
    screen.rerender(<ScreenRouter view={{ ...phraseReady, body: ['changed'] }} onAction={() => undefined} />);
    expect(proto.scrollTo).not.toHaveBeenCalled();
    screen.rerender(<ScreenRouter view={phraseActiveVisible} onAction={() => undefined} />);
    expect(proto.scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });
});

describe('focus-driven scrolling in the component', () => {
  let api: ReturnType<typeof useFocusScrollApi> = null;
  beforeEach(() => {
    proto.scrollTo.mockClear();
    proto.measureInWindow.mockReset();
    // The viewport (the ScrollView) is at window y 100 .. 900.
    proto.measureInWindow.mockImplementation((cb: (x: number, y: number, w: number, h: number) => void) => cb(0, 100, 1920, 800));
    api = null;
  });
  afterEach(() => proto.measureInWindow.mockReset());

  function mount() {
    const screen = render(
      <FocusScrollView>
        <Probe onApi={(a) => (api = a)} />
      </FocusScrollView>,
    );
    const scroll = screen.getByTestId('screen-scroll');
    fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 1920, height: 800 } } });
    fireEvent(scroll, 'contentSizeChange', 1920, 1800);
    return screen;
  }

  it('scrolls a focused control that is below the fold into view', async () => {
    mount();
    const node = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, 950, 400, 100) };
    await act(async () => {
      api?.onControlFocus(node);
      await Promise.resolve();
      await Promise.resolve();
    });
    // 950 + 100 + margin (ui.space(32) = 32) - 900 = 182
    expect(proto.scrollTo).toHaveBeenCalledWith({ y: 182, animated: false });
  });

  it('does nothing when the content fits', async () => {
    const screen = mount();
    fireEvent(screen.getByTestId('screen-scroll'), 'contentSizeChange', 1920, 700);
    const node = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, 950, 400, 100) };
    await act(async () => {
      api?.onControlFocus(node);
      await Promise.resolve();
    });
    expect(proto.scrollTo).not.toHaveBeenCalled();
  });

  describe('Up / Down with no control to move to', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('scrolls one page when focus did not move', () => {
      mount();
      act(() => emitTVEvent({ eventType: 'down', eventKeyAction: 0 }));
      act(() => {
        jest.advanceTimersByTime(FOCUS_SETTLE_MS + 5);
      });
      expect(proto.scrollTo).toHaveBeenCalledWith({ y: 640, animated: false });
    });

    it('does not scroll when the focus engine moved focus to another control', () => {
      mount();
      act(() => emitTVEvent({ eventType: 'down', eventKeyAction: 0 }));
      act(() => {
        jest.advanceTimersByTime(40);
        api?.onControlFocus({}); // focus moved: the onFocus of the next control
        jest.advanceTimersByTime(FOCUS_SETTLE_MS);
      });
      expect(proto.scrollTo).not.toHaveBeenCalled();
    });

    it('ignores key-up, other keys and screens that fit', () => {
      const screen = mount();
      act(() => emitTVEvent({ eventType: 'down', eventKeyAction: 1 }));
      act(() => emitTVEvent({ eventType: 'left', eventKeyAction: 0 }));
      act(() => {
        jest.advanceTimersByTime(FOCUS_SETTLE_MS + 5);
      });
      expect(proto.scrollTo).not.toHaveBeenCalled();
      fireEvent(screen.getByTestId('screen-scroll'), 'contentSizeChange', 1920, 600);
      act(() => emitTVEvent({ eventType: 'up', eventKeyAction: 0 }));
      act(() => {
        jest.advanceTimersByTime(FOCUS_SETTLE_MS + 5);
      });
      expect(proto.scrollTo).not.toHaveBeenCalled();
    });

    it('tracks the offset from scroll events so a following page starts from there', () => {
      const screen = mount();
      fireEvent.scroll(screen.getByTestId('screen-scroll'), { nativeEvent: { contentOffset: { x: 0, y: 500 } } });
      act(() => emitTVEvent({ eventType: 'down', eventKeyAction: 0 }));
      act(() => {
        jest.advanceTimersByTime(FOCUS_SETTLE_MS + 5);
      });
      expect(proto.scrollTo).toHaveBeenCalledWith({ y: 1000, animated: false }); // 500 + 640 clamps to 1000
    });
  });
});
