import { PAGE_FRACTION, clampOffset, createFocusScroller, scrollDeltaToReveal } from '../ui/focusScroller';
import type { FocusScrollDeps, Rect } from '../ui/focusScroller';

const viewport: Rect = { top: 100, height: 800 }; // window y 100 .. 900
const margin = 30;

describe('scrollDeltaToReveal (hand-computed; viewport y 100..900, margin 30)', () => {
  it('returns 0 for a node that is fully visible with margin', () => {
    expect(scrollDeltaToReveal(viewport, { top: 200, height: 100 }, margin)).toBe(0);
    expect(scrollDeltaToReveal(viewport, { top: 130, height: 100 }, margin)).toBe(0); // exactly at the top margin
    expect(scrollDeltaToReveal(viewport, { top: 770, height: 100 }, margin)).toBe(0); // bottom 870 = 900 - 30
  });

  it('scrolls down by the amount a node below the fold sticks out, plus margin', () => {
    // node 950..1050: bottom 1050 + 30 - 900 = 180
    expect(scrollDeltaToReveal(viewport, { top: 950, height: 100 }, margin)).toBe(180);
    // node 790..890 (bottom 890 > 870): 890 + 30 - 900 = 20
    expect(scrollDeltaToReveal(viewport, { top: 790, height: 100 }, margin)).toBe(20);
  });

  it('scrolls up (negative) for a node above the top margin', () => {
    // node top 50: 50 - 30 - 100 = -80
    expect(scrollDeltaToReveal(viewport, { top: 50, height: 100 }, margin)).toBe(-80);
    expect(scrollDeltaToReveal(viewport, { top: 120, height: 100 }, margin)).toBe(-10);
  });

  it('aligns the top edge of a node that is taller than the viewport', () => {
    expect(scrollDeltaToReveal(viewport, { top: 400, height: 900 }, margin)).toBe(400 - 30 - 100);
  });
});

describe('clampOffset', () => {
  it('keeps the offset inside [0, content - viewport]', () => {
    expect(clampOffset(-20, 1600, 800)).toBe(0);
    expect(clampOffset(300, 1600, 800)).toBe(300);
    expect(clampOffset(900, 1600, 800)).toBe(800);
    expect(clampOffset(50, 700, 800)).toBe(0);
  });
});

function setup(options: { viewport?: Rect | null; nodes?: Record<string, Rect | null> } = {}) {
  const scrolls: number[] = [];
  const measuredNodes: unknown[] = [];
  const nodes = options.nodes ?? {};
  const deps: FocusScrollDeps = {
    measureViewport: async () => (options.viewport === undefined ? viewport : options.viewport),
    measureNode: async (node) => {
      measuredNodes.push(node);
      return nodes[node as string] ?? null;
    },
    scrollTo: (y) => scrolls.push(y),
    margin: () => margin,
  };
  const scroller = createFocusScroller(deps);
  scroller.setViewportHeight(800);
  scroller.setContentHeight(1800);
  return { scroller, scrolls, measuredNodes };
}

describe('focus scroller', () => {
  it('reveals a control below the fold and remembers the new offset', async () => {
    const { scroller, scrolls } = setup({ nodes: { a: { top: 950, height: 100 } } });
    await scroller.reveal('a');
    expect(scrolls).toEqual([180]);
    expect(scroller.offset).toBe(180);
  });

  it('adds to the current offset when the content is already scrolled (offset tracked from scroll events)', async () => {
    const { scroller, scrolls } = setup({ nodes: { a: { top: 950, height: 100 } } });
    scroller.setOffset(300);
    await scroller.reveal('a');
    expect(scrolls).toEqual([480]);
  });

  it('scrolls back up for a control above the viewport, never below 0', async () => {
    const { scroller, scrolls } = setup({ nodes: { a: { top: 50, height: 100 } } });
    scroller.setOffset(60);
    await scroller.reveal('a');
    expect(scrolls).toEqual([0]); // 60 - 80 = -20 clamps to 0
  });

  it('does not scroll past the end of the content', async () => {
    const { scroller, scrolls } = setup({ nodes: { a: { top: 950, height: 100 } } });
    scroller.setContentHeight(900); // only 100 px of scroll available
    await scroller.reveal('a');
    expect(scrolls).toEqual([100]);
  });

  it('does nothing when the control is visible, when nothing overflows, or when it cannot measure', async () => {
    const visible = setup({ nodes: { a: { top: 300, height: 100 } } });
    await visible.scroller.reveal('a');
    expect(visible.scrolls).toEqual([]);

    const fits = setup({ nodes: { a: { top: 950, height: 100 } } });
    fits.scroller.setContentHeight(800);
    await fits.scroller.reveal('a');
    expect(fits.scrolls).toEqual([]);
    expect(fits.measuredNodes).toEqual([]); // not even measured: no overflow, no work

    const unknownViewport = setup({ viewport: null, nodes: { a: { top: 950, height: 100 } } });
    await unknownViewport.scroller.reveal('a');
    expect(unknownViewport.scrolls).toEqual([]);

    const unknownNode = setup({ nodes: {} });
    await unknownNode.scroller.reveal('missing');
    expect(unknownNode.scrolls).toEqual([]);
  });

  it('reports overflow only when content is taller than the viewport', () => {
    const { scroller } = setup();
    expect(scroller.overflowing).toBe(true);
    scroller.setContentHeight(800);
    expect(scroller.overflowing).toBe(false);
    scroller.setContentHeight(801);
    expect(scroller.overflowing).toBe(false); // within the 1 px tolerance
    scroller.setContentHeight(802);
    expect(scroller.overflowing).toBe(true);
  });

  it('pages down and up by 80 % of the viewport and clamps at both ends', () => {
    const { scroller, scrolls } = setup();
    expect(PAGE_FRACTION).toBe(0.8);
    expect(scroller.page('down')).toBe(true); // 640
    expect(scroller.page('down')).toBe(true); // 1000 max (1800 - 800)
    expect(scroller.page('down')).toBe(false); // already at the end
    expect(scrolls).toEqual([640, 1000]);
    expect(scroller.page('up')).toBe(true); // 360
    expect(scroller.page('up')).toBe(true); // 0
    expect(scroller.page('up')).toBe(false);
    expect(scrolls).toEqual([640, 1000, 360, 0]);
  });

  it('resets to the top for a new screen, and only scrolls if it was scrolled', () => {
    const { scroller, scrolls } = setup();
    scroller.reset();
    expect(scrolls).toEqual([]);
    scroller.setOffset(420);
    scroller.reset();
    expect(scrolls).toEqual([0]);
    expect(scroller.offset).toBe(0);
  });

  it('does not page when everything fits', () => {
    const { scroller, scrolls } = setup();
    scroller.setContentHeight(790);
    expect(scroller.page('down')).toBe(false);
    expect(scrolls).toEqual([]);
  });
});
