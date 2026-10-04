// Layout self-check for the web preview (NOT Vega): for every fixture at the current ?scale=, reports elements that
// extend beyond the 1920 x 1080 canvas, whether the footer is fully visible, and whether every enabled control can
// be brought fully on screen by focusing it (focus-driven scrolling). Run from the page:
//   await window.__atr.layoutReport()      or open ?scale=1.5 and call it from a test runner.
export interface LayoutRow {
  screen: string;
  /** Elements (other than the hidden live region) whose box is not inside the canvas, before any focus. */
  outsideBeforeFocus: string[];
  footerVisible: boolean;
  /** How far the scrolling content is taller than its viewport, in canvas pixels (0 = it fits without scrolling). */
  overflowPx: number;
  controls: number;
  /** Enabled controls that are not fully inside the canvas after receiving focus. */
  unreachableAfterFocus: string[];
  /** Focusable controls whose box, after focus, is partly outside the canvas (ring and scale included). */
  clippedAfterFocus: string[];
}

function inside(box: DOMRect, canvas: DOMRect, eps = 1): boolean {
  return box.left >= canvas.left - eps && box.right <= canvas.right + eps && box.top >= canvas.top - eps && box.bottom <= canvas.bottom + eps;
}

function describe(el: Element): string {
  return el.getAttribute('data-testid') ?? el.tagName.toLowerCase() + ':' + (el.textContent ?? '').slice(0, 20);
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function layoutReport(screens: string[], setScreen: (name: string) => void): Promise<LayoutRow[]> {
  const canvasEl = document.querySelector('[data-testid="tv-canvas"]');
  if (canvasEl === null) return [];
  const rows: LayoutRow[] = [];
  for (const screen of screens) {
    setScreen(screen);
    await settle(150);
    const canvas = canvasEl.getBoundingClientRect();
    const outside: string[] = [];
    canvasEl.querySelectorAll('*').forEach((el) => {
      if (el.closest('[data-testid="live-region"]') !== null) return;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      if (!inside(box, canvas)) outside.push(describe(el));
    });
    const scroller = canvasEl.querySelector<HTMLElement>('[data-testid="screen-scroll"]');
    const canvasScale = canvas.width / 1920;
    const overflowPx = scroller === null ? 0 : Math.max(0, Math.round((scroller.scrollHeight - scroller.clientHeight) / canvasScale));
    const footer = canvasEl.querySelector('[data-testid="footer-bar"]');
    const footerVisible = footer !== null && inside(footer.getBoundingClientRect(), canvas);
    const controls = Array.from(canvasEl.querySelectorAll<HTMLElement>('[role="button"]:not([aria-disabled="true"])'));
    const unreachable: string[] = [];
    const clipped: string[] = [];
    for (const control of controls) {
      control.focus();
      await settle(60);
      const box = control.getBoundingClientRect();
      if (!inside(box, canvas, 40)) unreachable.push(describe(control));
      else if (!inside(box, canvas, 1)) clipped.push(describe(control));
    }
    rows.push({
      screen,
      outsideBeforeFocus: outside.slice(0, 12),
      footerVisible,
      overflowPx,
      controls: controls.length,
      unreachableAfterFocus: unreachable,
      clippedAfterFocus: clipped,
    });
  }
  return rows;
}
