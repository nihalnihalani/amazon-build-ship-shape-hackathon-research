/**
 * Helpers for the TV web-preview accessibility gate (T17-prep).
 *
 * Evidence class: web_preview. The preview is react-native-web with shims ("Web preview — not Vega"). Nothing
 * here observes VoiceView, the real D-pad, Vega focus behaviour or the real UI-scale setting.
 */
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PREVIEW_URL = process.env['TV_PREVIEW_URL'] ?? 'http://127.0.0.1:5179';
export const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const FOOTER_TEXT = 'Not a medical device. Does not diagnose or treat any condition.';
/** The preview canvas is 1920 x 1080 below a 44 px banner; this viewport makes the page scale exactly 1.0. */
export const VIEWPORT = { width: 1920, height: 1124 } as const;

export async function launchChrome(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  }
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/* ------------------------------------------------------------------ colour maths (WCAG) */

export function parseCssColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(value);
  if (m === null) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(a: string, b: string): number | null {
  const ca = parseCssColor(a);
  const cb = parseCssColor(b);
  if (ca === null || cb === null) return null;
  const la = 0.2126 * channel(ca.r) + 0.7152 * channel(ca.g) + 0.0722 * channel(ca.b);
  const lb = 0.2126 * channel(cb.r) + 0.7152 * channel(cb.g) + 0.0722 * channel(cb.b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------ in-page inspection */

export interface ControlInfo {
  testId: string | null;
  tag: string;
  role: string | null;
  name: string;
  enabled: boolean;
  /** tabIndex as the browser reports it (-1 = not reachable by Tab/sequential focus). */
  tabIndex: number;
  ariaDisabled: string | null;
  preferred: boolean;
  focused: boolean;
  ringVisible: boolean;
  ringColor: string;
  ringWidthPx: number;
  scale: number;
}

export interface ScreenInfo {
  screenTestId: string | null;
  title: string | null;
  footer: string | null;
  bannerText: string | null;
  controls: ControlInfo[];
  activeTestId: string | null;
  activeIsBody: boolean;
  arcMeterPresent: boolean;
  arcParts: string[];
  resultPresent: boolean;
  svgCount: number;
  liveRegion: { ariaLive: string | null; text: string };
  screenBackground: string;
  bodyText: string;
  ariaLabels: string[];
}

/** Everything the assertions need, computed in the page in one round trip. */
export async function inspect(page: Page): Promise<ScreenInfo> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="tv-canvas"]') as HTMLElement;
    const nameOf = (el: Element): string => {
      const by = el.getAttribute('aria-labelledby');
      if (by !== null && by.trim() !== '') {
        const t = by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .join(' ')
          .trim();
        if (t !== '') return t;
      }
      const al = el.getAttribute('aria-label');
      if (al !== null && al.trim() !== '') return al.trim();
      const alt = el.getAttribute('alt');
      if (alt !== null && alt.trim() !== '') return alt.trim();
      const text = (el as HTMLElement).innerText;
      if (typeof text === 'string' && text.trim() !== '') return text.trim();
      const title = el.getAttribute('title');
      return title !== null ? title.trim() : '';
    };
    const alpha = (c: string): number => {
      const m = /rgba?\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+(?:[,\s/]+([\d.]+))?\s*\)/.exec(c);
      if (m === null) return c === 'transparent' ? 0 : 1;
      return m[1] === undefined ? 1 : Number(m[1]);
    };
    const scaleOf = (t: string): number => {
      const m = /matrix\(\s*([-\d.]+)/.exec(t);
      return m === null ? 1 : Number(m[1]);
    };
    const selector =
      'button, [role="button"], a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="link"], [role="checkbox"], [role="menuitem"], [role="tab"], [role="switch"], [role="radio"], [role="slider"]';
    const ae = document.activeElement as HTMLElement | null;
    const controls = Array.from(canvas.querySelectorAll<HTMLElement>(selector)).map((el) => {
      const cs = getComputedStyle(el);
      const width = parseFloat(cs.borderTopWidth);
      return {
        testId: el.dataset['testid'] ?? null,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        name: nameOf(el),
        enabled: el.getAttribute('aria-disabled') !== 'true',
        tabIndex: el.tabIndex,
        ariaDisabled: el.getAttribute('aria-disabled'),
        preferred: el.dataset['preferredFocus'] === 'true',
        focused: el === ae,
        ringVisible: alpha(cs.borderTopColor) > 0 && width >= 4,
        ringColor: cs.borderTopColor,
        ringWidthPx: width,
        scale: scaleOf(cs.transform),
      };
    });
    const screenEl = canvas.querySelector('[data-testid^="screen-"]') as HTMLElement | null;
    const live = document.querySelector('[data-testid="live-region"]') as HTMLElement | null;
    return {
      screenTestId: screenEl?.getAttribute('data-testid') ?? null,
      title: canvas.querySelector('[data-testid="screen-title"]')?.textContent ?? null,
      footer: (canvas.querySelector('[data-testid="footer"]') as HTMLElement | null)?.innerText ?? null,
      bannerText: (document.querySelector('[data-testid="web-preview-banner"]') as HTMLElement | null)?.innerText ?? null,
      controls,
      activeTestId: ae?.dataset?.['testid'] ?? null,
      activeIsBody: ae === document.body || ae === null,
      arcMeterPresent: canvas.querySelector('[data-testid="arc-meter"]') !== null,
      arcParts: Array.from(canvas.querySelectorAll('[data-testid^="arc-"]')).map((e) => e.getAttribute('data-testid') ?? ''),
      resultPresent: canvas.querySelector('[data-testid="result"], [data-testid="result-label"]') !== null,
      svgCount: canvas.querySelectorAll('svg').length,
      liveRegion: { ariaLive: live?.getAttribute('aria-live') ?? null, text: live?.innerText ?? '' },
      screenBackground: screenEl !== null ? getComputedStyle(screenEl).backgroundColor : '',
      bodyText: canvas.innerText,
      ariaLabels: Array.from(canvas.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label') ?? ''),
    };
  });
}

export async function activeId(page: Page): Promise<string | null> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.['testid'] ?? null);
}

/** Number of controls in the canvas that currently draw a focus ring. */
export async function ringCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="tv-canvas"]') as HTMLElement;
    let n = 0;
    canvas.querySelectorAll<HTMLElement>('[role="button"]').forEach((el) => {
      const cs = getComputedStyle(el);
      const m = /rgba?\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+(?:[,\s/]+([\d.]+))?\s*\)/.exec(cs.borderTopColor);
      const a = m === null ? 0 : m[1] === undefined ? 1 : Number(m[1]);
      if (a > 0 && parseFloat(cs.borderTopWidth) >= 4) n += 1;
    });
    return n;
  });
}

export interface Overflow {
  horizontalScroll: boolean;
  outside: { testId: string | null; tag: string; right: number; bottom: number; left: number; top: number }[];
  clippedText: { testId: string | null; tag: string; scrollWidth: number; clientWidth: number }[];
}

/** Elements that extend beyond the 1920 x 1080 canvas, and text boxes that clip their own content. */
export async function overflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="tv-canvas"]') as HTMLElement;
    const box = canvas.getBoundingClientRect();
    const outside: Overflow['outside'] = [];
    const clippedText: Overflow['clippedText'] = [];
    canvas.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const cs = getComputedStyle(el);
      if (el.dataset['testid'] === 'live-region' || el.closest('[data-testid="live-region"]') !== null) return;
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const eps = 1;
      if (r.right > box.right + eps || r.bottom > box.bottom + eps || r.left < box.left - eps || r.top < box.top - eps) {
        outside.push({ testId: el.dataset['testid'] ?? null, tag: el.tagName.toLowerCase(), right: Math.round(r.right), bottom: Math.round(r.bottom), left: Math.round(r.left), top: Math.round(r.top) });
      }
      if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.overflowX === 'scroll' || cs.overflowX === 'auto') && el.scrollWidth > el.clientWidth + 1) {
        clippedText.push({ testId: el.dataset['testid'] ?? null, tag: el.tagName.toLowerCase(), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      }
    });
    return {
      horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      outside: outside.slice(0, 12),
      clippedText: clippedText.slice(0, 12),
    };
  });
}

export interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: number;
  targets: string[];
}

let axeSource: string | null = null;
export function loadAxeSource(): string {
  if (axeSource === null) axeSource = readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
  return axeSource;
}

export async function runAxe(page: Page): Promise<AxeViolation[]> {
  await page.evaluate(loadAxeSource());
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Element, opts: object) => Promise<{ violations: { id: string; impact: string | null; help: string; nodes: { target: unknown[] }[] }[] }> } }).axe;
    const canvas = document.querySelector('[data-testid="tv-canvas"]') as Element;
    const result = await axe.run(canvas, { resultTypes: ['violations'] });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 3).map((n) => String(n.target.join(' '))),
    }));
  });
}

/** Records every distinct live-region text and aria-live value the page produces (with a timestamp). */
export const LIVE_LOG_INIT = `
  (() => {
    window.__liveLog = [];
    const read = () => {
      const el = document.querySelector('[data-testid="live-region"]');
      return el ? { live: el.getAttribute('aria-live'), text: el.innerText } : null;
    };
    let last = '';
    const push = () => {
      const cur = read();
      if (cur === null) return;
      const key = cur.live + '|' + cur.text;
      if (key === last) return;
      last = key;
      window.__liveLog.push({ t: performance.now(), live: cur.live, text: cur.text, body: document.body.innerText, labels: Array.from(document.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label')) });
    };
    new MutationObserver(push).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  })();
`;

export interface LiveEntry {
  t: number;
  live: string | null;
  text: string;
  body: string;
  labels: string[];
}

export async function liveLog(page: Page): Promise<LiveEntry[]> {
  return page.evaluate(() => (window as unknown as { __liveLog: LiveEntry[] }).__liveLog.slice());
}

export async function preview(page: Page): Promise<{ dispatched: unknown[]; view: unknown } | null> {
  return page.evaluate(() => {
    const api = (window as unknown as { __atr?: { dispatched: unknown[]; view: () => unknown } }).__atr;
    return api === undefined ? null : { dispatched: api.dispatched.slice(), view: api.view() };
  });
}

export async function clearDispatched(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as { __atr?: { dispatched: unknown[] } }).__atr;
    if (api !== undefined) api.dispatched.length = 0;
  });
}
