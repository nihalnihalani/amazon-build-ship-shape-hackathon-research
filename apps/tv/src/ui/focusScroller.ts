/**
 * Focus-driven scrolling for screens whose content is taller than the canvas (UI scale 1.5 and above, long
 * summaries). Pure logic, no React and no native calls, so it is unit tested:
 *  - `scrollDeltaToReveal` says how far to scroll to bring a focused control fully on screen;
 *  - `createFocusScroller` ties that to a scroll view through injected measure / scrollTo functions.
 * Rects are in window coordinates (top, height); the scroller tracks the scroll offset itself.
 */

export interface Rect {
  top: number;
  height: number;
}

/**
 * Amount to add to the scroll offset so that `node` is fully inside `viewport` with `margin` to spare.
 * Negative = scroll up, positive = scroll down, 0 = already visible. A node taller than the viewport is aligned
 * by its top edge so its label and ring start on screen.
 */
export function scrollDeltaToReveal(viewport: Rect, node: Rect, margin: number): number {
  const viewTop = viewport.top;
  const viewBottom = viewport.top + viewport.height;
  const nodeBottom = node.top + node.height;
  if (node.height + 2 * margin >= viewport.height) return node.top - margin - viewTop;
  if (node.top < viewTop + margin) return node.top - margin - viewTop;
  if (nodeBottom > viewBottom - margin) return nodeBottom + margin - viewBottom;
  return 0;
}

export function clampOffset(offset: number, contentHeight: number, viewportHeight: number): number {
  const max = Math.max(0, contentHeight - viewportHeight);
  return Math.min(max, Math.max(0, offset));
}

/** Fraction of the viewport moved by one D-pad "page" scroll. */
export const PAGE_FRACTION = 0.8;

export interface FocusScrollDeps {
  /** Window rect of the scroll viewport, or null when it cannot be measured. */
  measureViewport(): Promise<Rect | null>;
  /** Window rect of a node (a focused control), or null when it cannot be measured. */
  measureNode(node: unknown): Promise<Rect | null>;
  scrollTo(y: number): void;
  /** Distance kept between a revealed control and the viewport edge (ring and focus scale included). */
  margin(): number;
}

export interface FocusScroller {
  setOffset(y: number): void;
  setContentHeight(height: number): void;
  setViewportHeight(height: number): void;
  readonly offset: number;
  /** True when the content is taller than the viewport (scrolling is possible). */
  readonly overflowing: boolean;
  /** Scroll just enough to bring a focused control fully into view. Resolves after the scroll was requested. */
  reveal(node: unknown): Promise<void>;
  /** Scroll one page up or down. Returns true if the offset changed. */
  page(direction: 'up' | 'down'): boolean;
  /** Back to the top (a new screen or stage starts at its title). */
  reset(): void;
}

export function createFocusScroller(deps: FocusScrollDeps): FocusScroller {
  let offset = 0;
  let contentHeight = 0;
  let viewportHeight = 0;

  function moveTo(next: number): boolean {
    const target = clampOffset(next, contentHeight, viewportHeight);
    if (Math.abs(target - offset) < 1) return false;
    offset = target;
    deps.scrollTo(target);
    return true;
  }

  return {
    setOffset(y) {
      offset = y;
    },
    setContentHeight(height) {
      contentHeight = height;
    },
    setViewportHeight(height) {
      viewportHeight = height;
    },
    get offset() {
      return offset;
    },
    get overflowing() {
      return contentHeight > viewportHeight + 1;
    },
    async reveal(node) {
      if (contentHeight <= viewportHeight + 1) return;
      const [viewport, rect] = await Promise.all([deps.measureViewport(), deps.measureNode(node)]);
      if (viewport === null || rect === null) return;
      const delta = scrollDeltaToReveal(viewport, rect, deps.margin());
      if (delta !== 0) moveTo(offset + delta);
    },
    reset() {
      if (offset > 0) {
        offset = 0;
        deps.scrollTo(0);
      }
    },
    page(direction) {
      if (contentHeight <= viewportHeight + 1) return false;
      const step = viewportHeight * PAGE_FRACTION;
      return moveTo(offset + (direction === 'down' ? step : -step));
    },
  };
}
