/**
 * T17-prep: keyboard-only remote, accessibility and scale gate on the TV web preview (system Google Chrome).
 *
 * Reviewer: Sonnet 5.5 (qa-accessibility). Evidence class: web_preview (react-native-web + shims, banner
 * "Web preview — not Vega"). It does NOT observe VoiceView, the real D-pad, Vega focus or the real UI scale.
 * Every result below is recorded in tests/a11y/artifacts/report.json together with environment and hashes.
 *
 * Modes covered:
 *   fixtures  29 hand-written TvView fixtures (apps/tv/src/__fixtures__/views.ts) rendered by the real screens.
 *   store     the real @atr/session-core store inside the page (in-memory "Fixture replay" data) driven by a
 *             scripted relay+phone (Playwright routeWebSocket + @atr/protocol), keyboard only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOOTER } from '@atr/session-core';
import {
  FOOTER_TEXT,
  LIVE_LOG_INIT,
  PREVIEW_URL,
  VIEWPORT,
  activeId,
  clearDispatched,
  contrastRatio,
  controlVisibility,
  inspect,
  launchChrome,
  layoutProbe,
  liveLog,
  preview,
  ringCount,
  runAxe,
  sha256File,
  sha256Text,
} from './helpers.js';
import type { AxeViolation, ControlInfo, ControlVisibility, LayoutProbe, ScreenInfo } from './helpers.js';
import { CREDENTIAL, ScriptedPhone } from './scripted-phone.js';

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = join(here, 'artifacts');
const COMMITTED = join(ARTIFACTS, 'committed');
mkdirSync(COMMITTED, { recursive: true });

const FIXTURES = [
  'onboarding',
  'home',
  'pairing',
  'join_confirm',
  'permission_pending',
  'quiet_check',
  'calibration',
  'vowel_ready',
  'vowel_active',
  'vowel_result',
  'phrase_ready',
  'phrase_active_visible',
  'phrase_active_hidden',
  'response_rating',
  'response_listener_waiting',
  'reveal_reached',
  'reveal_below',
  'reveal_not_scored',
  'summary',
  'summary_incomplete',
  'history',
  'paused_or_invalid',
  'resume_or_discard',
  'settings',
  'confirm_dialog_destructive',
  'confirm_dialog_wrong_preference',
  'confirm_dialog_plain',
  'about',
  'diagnostics',
] as const;

/** Screens that show a blind attempt that is still awaiting its reveal. */
const BLIND_PENDING = ['phrase_active_hidden', 'response_rating'] as const;
const DIALOGS = ['confirm_dialog_destructive', 'confirm_dialog_wrong_preference'] as const;
const COMMIT_THESE = new Set(['home', 'phrase_active_hidden', 'response_rating', 'reveal_below', 'confirm_dialog_destructive', 'history', 'store_summary', 'store_p3_blind_capture']);
const SCALES = [1, 1.25, 1.5, 2] as const;
const RING_MIN_CONTRAST = 3;

/* ------------------------------------------------------------------ report */

interface ScreenReport {
  name: string;
  mode: 'fixture' | 'store';
  screen: string | null;
  controls: number;
  enabledControls: number;
  preferredCount: number;
  focused: string | null;
  focusTarget: 'preferred_focused' | 'no_focusable_controls';
  ringContrast: number | null;
  unnamed: string[];
  /** Controls the view marks disabled that the DOM still exposes as focusable (tabindex 0, no aria-disabled). */
  disabledFocusable: string[];
  reachable: { unreachable: string[]; presses: number; ringViolations: number };
  footerOk: boolean;
  arcMeter: boolean;
  axe: AxeViolation[];
  screenshot: { file: string; sha256: string; committed: boolean } | null;
  ariaOrder: string[];
}

const report = {
  evidence_class: 'web_preview',
  not_observed: ['VoiceView', 'real D-pad / Vega focus engine', 'real UI-scale setting', 'Vega rendering and latency'],
  environment: {} as Record<string, string>,
  screens: [] as ScreenReport[],
  scale: [] as {
    scale: number;
    screen: string;
    scrolls: boolean;
    overflowPx: number;
    footerInside: boolean;
    horizontalOutside: number;
    horizontalClipped: number;
    controls: number;
    reached: number;
    notFullyVisibleOnFocus: string[];
  }[],
  store: {} as Record<string, unknown>,
  hashes: {} as Record<string, string>,
};

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await launchChrome();
  context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 0.5 });
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse HEAD', { cwd: here }).toString().trim();
  } catch {
    // not a git checkout
  }
  report.environment = {
    chrome: browser.version(),
    preview_url: PREVIEW_URL,
    commit: sha,
    timestamp_utc: new Date().toISOString(),
    node: process.version,
    viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
  };
});

afterAll(async () => {
  writeFileSync(join(ARTIFACTS, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(
    join(ARTIFACTS, 'manifest.json'),
    JSON.stringify({ evidence_class: 'web_preview', note: 'hashes of the PNGs written by this run; not regression baselines', sha256: shotHashes }, null, 2),
  );
  await context.close();
  await browser.close();
});

/* ------------------------------------------------------------------ small helpers */

async function openFixture(page: Page, name: string, scale = 1): Promise<void> {
  await page.goto(`${PREVIEW_URL}/?mode=fixtures&screen=${name}${scale === 1 ? '' : `&scale=${scale}`}`);
  await page.waitForSelector('[data-testid="footer"]', { timeout: 10_000 });
  await page.waitForTimeout(200);
}

async function press(page: Page, key: string, settle = 120): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(settle);
}

/** D-pad tour: keep pressing each direction until focus stops moving; report anything never focused. */
async function keyboardTour(page: Page, enabled: string[]): Promise<{ unreachable: string[]; presses: number; ringViolations: number }> {
  const visited = new Set<string>();
  const first = await activeId(page);
  if (first !== null) visited.add(first);
  let presses = 0;
  let ringViolations = 0;
  for (let round = 0; round < 2 && visited.size < enabled.length; round += 1) {
    for (const dir of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      for (let i = 0; i < 12; i += 1) {
        const before = await activeId(page);
        await page.keyboard.press(dir);
        presses += 1;
        const after = await activeId(page);
        if ((await ringCount(page)) !== 1) ringViolations += 1;
        if (after !== null) visited.add(after);
        if (after === before) break;
      }
    }
  }
  return { unreachable: enabled.filter((id) => !visited.has(id)), presses, ringViolations };
}

function ariaOrder(info: ScreenInfo): string[] {
  return info.controls.map((c) => `${c.role ?? c.tag}:${c.name}${c.enabled ? '' : ' (disabled)'}`);
}

const shotHashes: Record<string, string> = {};
async function shot(page: Page, name: string): Promise<{ file: string; sha256: string; committed: boolean }> {
  const file = `${name}.png`;
  const path = join(ARTIFACTS, file);
  await page.screenshot({ path });
  const committed = COMMIT_THESE.has(name);
  if (committed) copyFileSync(path, join(COMMITTED, file));
  const sha256 = sha256File(path);
  shotHashes[file] = sha256;
  return { file, sha256, committed };
}

const STRICT = process.env['QA_STRICT'] === '1';
/** Confirmed defects assert the CORRECT behaviour under it.fails; QA_STRICT=1 runs them as ordinary tests. */
const defect = (id: string, name: string, fn: () => void | Promise<void>): void => {
  (STRICT ? it : it.fails)(`DEFECT ${id}: ${name}`, fn);
};

/**
 * Moves focus to a control with the arrow keys only. The preview's spatial navigation is the shim's, not Vega's, so
 * the route is discovered: observed transitions are recorded and a breadth-first search finds a path; where none is
 * known yet an untried direction is pressed.
 */
async function navigateTo(page: Page, testId: string, maxPresses = 40): Promise<void> {
  const dirs = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'] as const;
  const edges = new Map<string, Map<string, string>>();
  const record = (from: string, dir: string, to: string): void => {
    if (!edges.has(from)) edges.set(from, new Map());
    edges.get(from)?.set(dir, to);
  };
  const firstStep = (from: string, accept: (node: string) => boolean): string | null => {
    const queue: { node: string; first: string | null }[] = [{ node: from, first: null }];
    const seen = new Set([from]);
    while (queue.length > 0) {
      const { node, first } = queue.shift() as { node: string; first: string | null };
      if (node !== from && accept(node)) return first;
      for (const [dir, next] of edges.get(node) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push({ node: next, first: first ?? dir });
        }
      }
    }
    return null;
  };
  for (let i = 0; i < maxPresses; i += 1) {
    const current = (await activeId(page)) ?? '';
    if (current === testId) return;
    let dir: string | null = firstStep(current, (n) => n === testId);
    if (dir === null) dir = dirs.find((d) => !edges.get(current)?.has(d)) ?? null;
    if (dir === null) dir = firstStep(current, (n) => dirs.some((d) => !edges.get(n)?.has(d)));
    if (dir === null) break;
    await press(page, dir, 70);
    record(current, dir, (await activeId(page)) ?? '');
  }
  expect(await activeId(page), `navigate to ${testId} with arrow keys`).toBe(testId);
}

const FORBIDDEN_BEFORE_REVEAL = /\b(reached|below|today's relative level band|borderline|dB)\b/i;

/* ================================================================== A. fixture sweep */

describe('A. every fixture screen: focus, names, footer, meter, keyboard, axe, screenshot', () => {
  it('the preview exposes exactly the fixture list this suite knows (so a new screen cannot slip past the sweep)', async () => {
    const page = await context.newPage();
    await openFixture(page, 'home');
    const api = await page.evaluate(() => (window as unknown as { __atr: { screens: string[] } }).__atr.screens);
    expect(api).toEqual([...FIXTURES]);
    const info = await inspect(page);
    expect(info.bannerText).toContain('Web preview — not Vega');
    expect(FOOTER).toBe(FOOTER_TEXT);
    await page.close();
  });

  for (const name of FIXTURES) {
    it(`fixture ${name}`, async () => {
      const page = await context.newPage();
      await openFixture(page, name);
      const info = await inspect(page);
      const views = await preview(page);
      const view = views?.view as { meter: unknown; result: unknown; dialog: { preferred: string } | null; actions: unknown[]; footer: string } | undefined;

      // footer on every screen
      expect(info.footer, `${name} footer`).toBe(FOOTER_TEXT);
      expect(info.screenTestId, `${name} screen root`).not.toBeNull();

      // every interactive element has an accessible name (disabled ones too)
      const unnamed = info.controls.filter((c) => c.name.trim() === '').map((c) => c.testId ?? c.tag);
      expect(unnamed, `${name} unnamed interactive elements`).toEqual([]);

      // Which controls the VIEW says are usable (the preview's DOM does not reflect disabled: see defect A11Y-01).
      const viewDisabled = new Set(((views?.view as { actions: { id: string; disabled?: boolean }[] }).actions ?? []).filter((a) => a.disabled === true).map((a) => `action-${a.id}`));
      const disabledFocusable = info.controls.filter((c) => viewDisabled.has(c.testId ?? '') && c.tabIndex >= 0 && c.ariaDisabled !== 'true').map((c) => c.testId ?? '');

      expect(disabledFocusable, `${name}: controls the view marks disabled must not be focusable`).toEqual([]);

      // visible focus: exactly one element, the preferred one, with a ring and an enlarged scale
      const enabled = info.controls.filter((c) => !viewDisabled.has(c.testId ?? ''));
      const preferred = info.controls.filter((c) => c.preferred);
      let ringContrast: number | null = null;
      let focusTarget: ScreenReport['focusTarget'] = 'preferred_focused';
      if (enabled.length === 0) {
        focusTarget = 'no_focusable_controls';
        expect(info.activeIsBody, `${name}: nothing should hold focus`).toBe(true);
        expect(await ringCount(page)).toBe(0);
      } else {
        expect(preferred.length, `${name}: exactly one preferred-focus element`).toBe(1);
        const focused = info.controls.find((c) => c.focused);
        expect(focused?.testId, `${name}: the preferred element holds focus at entry`).toBe(preferred[0]?.testId);
        expect(focused?.ringVisible, `${name}: focus ring visible`).toBe(true);
        expect(focused?.ringWidthPx ?? 0).toBeGreaterThanOrEqual(6);
        expect(focused?.scale ?? 1, `${name}: focus also enlarges the control (shape, not colour alone)`).toBeGreaterThan(1.04);
        expect(await ringCount(page), `${name}: exactly one ring on screen`).toBe(1);
        ringContrast = contrastRatio((focused as ControlInfo).ringColor, info.screenBackground);
        expect(ringContrast ?? 0, `${name}: ring colour against the screen background`).toBeGreaterThanOrEqual(RING_MIN_CONTRAST);
      }

      // meter and result elements follow the view; blind fixtures have none
      expect(info.arcMeterPresent, `${name}: arc meter iff view.meter`).toBe(view?.meter !== null && view?.meter !== undefined);
      if ((BLIND_PENDING as readonly string[]).includes(name)) {
        expect(info.arcMeterPresent).toBe(false);
        expect(info.arcParts, 'no arc parts at all').toEqual([]);
        expect(info.resultPresent).toBe(false);
        expect(info.svgCount, 'no svg graphics on a blind screen').toBe(0);
        expect(info.bodyText).not.toMatch(FORBIDDEN_BEFORE_REVEAL);
        for (const label of info.ariaLabels) expect(label).not.toMatch(FORBIDDEN_BEFORE_REVEAL);
      }
      if (name === 'phrase_active_visible') expect(info.arcMeterPresent).toBe(true); // the check above is not vacuous

      // history: a day without a session says "No session" (never a zero); a day with one never does
      if (name === 'history') {
        const days = (views?.view as { history: { date: string; sessions: number | null }[] }).history;
        const captions = await page.$$eval('[data-testid^="history-caption-"]', (els) =>
          els.map((e) => [e.getAttribute('data-testid') ?? '', (e as HTMLElement).innerText] as const),
        );
        expect(days.some((d) => d.sessions === null)).toBe(true);
        expect(days.some((d) => d.sessions !== null)).toBe(true);
        for (const d of days) {
          const caption = captions.find(([id]) => id === `history-caption-${d.date}`)?.[1];
          if (d.sessions === null) expect(caption, `${d.date} caption`).toBe('No session');
          else expect(caption, `${d.date} caption`).not.toBe('No session');
        }
      }

      // Back and OK always reach the store, with or without a focusable control
      await clearDispatched(page);
      await press(page, 'Escape', 80);
      expect((await preview(page))?.dispatched).toEqual([{ kind: 'remote', key: 'back' }]);

      // keyboard reachability (shim spatial navigation: web_preview only)
      const enabledIds = enabled.map((c) => c.testId ?? '');
      let reach = { unreachable: [] as string[], presses: 0, ringViolations: 0 };
      if (enabled.length >= 2) {
        reach = await keyboardTour(page, enabledIds);
        expect(reach.unreachable, `${name}: controls never reached by arrow keys`).toEqual([]);
        expect(reach.ringViolations, `${name}: moments without exactly one focus ring`).toBe(0);
      }
      await clearDispatched(page);
      await press(page, 'Enter', 80);
      const dispatched = (await preview(page))?.dispatched ?? [];
      if (enabled.length === 0) expect(dispatched).toEqual([{ kind: 'remote', key: 'ok' }]);
      else {
        const id = (await activeId(page)) ?? '';
        expect(dispatched, `${name}: Enter activates exactly the focused control`).toEqual([{ kind: 'ui', action: id.replace(/^action-/, '') }]);
      }

      // axe + screenshot + aria order evidence
      await openFixture(page, name);
      const axe = await runAxe(page);
      const screenshot = await shot(page, name);
      report.screens.push({
        name,
        mode: 'fixture',
        screen: info.screenTestId,
        controls: info.controls.length,
        enabledControls: enabled.length,
        preferredCount: preferred.length,
        focused: info.controls.find((c) => c.focused)?.testId ?? null,
        focusTarget,
        ringContrast,
        unnamed,
        disabledFocusable,
        reachable: reach,
        footerOk: info.footer === FOOTER_TEXT,
        arcMeter: info.arcMeterPresent,
        axe,
        screenshot,
        ariaOrder: ariaOrder(info),
      });
      await page.close();
    });
  }

  it('axe-core: no critical violations anywhere; all violations are recorded by impact', async () => {
    const byImpact: Record<string, number> = {};
    const byRule: Record<string, { impact: string | null; screens: string[]; nodes: number }> = {};
    for (const s of report.screens) {
      for (const v of s.axe) {
        byImpact[v.impact ?? 'none'] = (byImpact[v.impact ?? 'none'] ?? 0) + 1;
        const r = (byRule[v.id] ??= { impact: v.impact, screens: [], nodes: 0 });
        r.screens.push(s.name);
        r.nodes += v.nodes;
      }
    }
    report.store['axe_summary'] = { byImpact, byRule };
    expect(byImpact['critical'] ?? 0, JSON.stringify(byRule)).toBe(0);
  });

  it('A11Y-02 (fixed in wave 2): the confirmation dialogs are named (axe aria-dialog-name finds nothing) and the title is rendered once', () => {
    const offenders = report.screens.filter((sc) => sc.axe.some((v) => v.id === 'aria-dialog-name')).map((sc) => sc.name);
    report.store['aria_dialog_name_offenders'] = offenders;
    expect(offenders).toEqual([]);
  });

  it('screenshots are recorded with SHA-256 hashes', () => {
    const shots = report.screens.filter((s) => s.screenshot !== null);
    expect(shots.length).toBe(FIXTURES.length);
    for (const s of shots) expect(s.screenshot?.sha256).toMatch(/^[0-9a-f]{64}$/);
    report.hashes['aria_order_all_screens'] = sha256Text(JSON.stringify(report.screens.map((s) => [s.name, s.ariaOrder])));
  });
});

/* ================================================================== B. destructive dialogs */

describe('B. destructive dialogs open with Cancel focused and trap focus', () => {
  for (const name of DIALOGS) {
    it(`fixture ${name}: Cancel is focused even when the view prefers Confirm; arrows cannot leave the dialog`, async () => {
      const page = await context.newPage();
      await openFixture(page, name);
      expect(await activeId(page)).toBe('action-cancel_destructive');
      const view = (await preview(page))?.view as { dialog: { title: string; preferred: string; confirm: { destructive?: boolean } } };
      expect(view.dialog.confirm.destructive).toBe(true);
      // A11Y-02: the dialog is named by its title and the title is rendered (and read) once, not as screen title plus dialog heading.
      const dialogInfo = await inspect(page);
      expect(dialogInfo.bodyText.split(view.dialog.title).length - 1, 'dialog title rendered once').toBe(1);
      const named = await page.$eval('[data-testid="dialog"]', (e) => ({ role: e.getAttribute('role'), label: e.getAttribute('aria-label'), by: e.getAttribute('aria-labelledby') }));
      expect(named.label !== null || named.by !== null, 'the alertdialog has an accessible name').toBe(true);
      for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
        await press(page, key, 60);
        expect(['action-cancel_destructive', 'action-confirm_destructive']).toContain(await activeId(page));
        expect(await ringCount(page)).toBe(1);
      }
      await page.close();
    });
  }

  it('fixture confirm_dialog_plain (non-destructive) honours the view preference', async () => {
    const page = await context.newPage();
    await openFixture(page, 'confirm_dialog_plain');
    expect(await activeId(page)).toBe('action-confirm_destructive');
    await page.close();
  });
});

/* ================================================================== C. scale */

/**
 * Keyboard walk over the enabled controls of the current screen. After every focus change the control is measured
 * (after a short settle so focus-driven scrolling can finish): it must be fully on the canvas, fully inside the
 * visible part of its scroll container and not under the pinned footer.
 */
async function tourVisibility(page: Page, enabled: string[]): Promise<{ reached: string[]; notFullyVisible: string[]; ringClipped: string[]; maxSettleMs: number }> {
  const settle = { max: 0 };
  const reached = new Set<string>();
  const bad = new Map<string, string>();
  const clipped = new Map<string, string>();
  const measure = async (): Promise<void> => {
    const id = await activeId(page);
    if (id === null) return;
    reached.add(id);
    // Focus-driven scrolling is asynchronous: poll until the control is fully visible (at most 800 ms) and record how long it took.
    const started = Date.now();
    let v: ControlVisibility | null = null;
    for (;;) {
      v = await controlVisibility(page, id);
      if (v !== null && v.insideCanvas && v.insideScrollerVertically && !v.overlapsFooter) break;
      if (Date.now() - started > 800) break;
      await page.waitForTimeout(30);
    }
    settle.max = Math.max(settle.max, Date.now() - started);
    // Ruling: the control must be on the canvas, essentially fully visible in its scroll viewport (at least 90 %) and not
    // under the pinned footer. Anything smaller that is still cut (the focus ring at the edge) is defect A11Y-04.
    if (v !== null && !(v.insideCanvas && v.visibleFraction >= 0.9 && !v.overlapsFooter)) {
      bad.set(id, `${v.clippedHorizontallyByScroller ? 'H|' : ''}canvas=${v.insideCanvas} visible=${v.visibleFraction.toFixed(2)} footer=${v.overlapsFooter} left=${Math.round(v.box.left)} right=${Math.round(v.box.right)} top=${Math.round(v.box.top)} bottom=${Math.round(v.box.bottom)}`);
    } else bad.delete(id);
    if (v !== null && (v.clippedHorizontallyByScroller || !v.insideScrollerVertically)) {
      clipped.set(id, `left=${Math.round(v.box.left)} right=${Math.round(v.box.right)} top=${Math.round(v.box.top)} bottom=${Math.round(v.box.bottom)} visible=${v.visibleFraction.toFixed(3)}`);
    } else clipped.delete(id);
  };
  await measure();
  for (let round = 0; round < 2 && reached.size < enabled.length; round += 1) {
    for (const dir of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      for (let i = 0; i < 12; i += 1) {
        const before = await activeId(page);
        await page.keyboard.press(dir);
        await page.waitForTimeout(40);
        const after = await activeId(page);
        if (after === before) break;
        await measure();
      }
    }
  }
  return {
    reached: [...reached],
    notFullyVisible: [...bad.entries()].map(([id, why]) => `${id} (${why})`),
    ringClipped: [...clipped.entries()].map(([id, why]) => `${id} (${why})`),
    maxSettleMs: settle.max,
  };
}

describe('C. UI-scale layout gate at 1.0, 1.25, 1.5 and 2.0 (web_preview ?scale=; ruling: scrolling is acceptable at large scales)', () => {
  const scrolling: Record<string, string[]> = {};
  const ringClipped: string[] = [];
  for (const scale of SCALES) {
    it(`scale ${scale}: the footer stays visible, no content is clipped horizontally, every control is fully on the canvas when focused${scale <= 1.25 ? ', and nothing scrolls' : ''}`, async () => {
      const page = await context.newPage();
      const failures: string[] = [];
      const horizontal: string[] = [];
      let maxSettle = 0;
      scrolling[String(scale)] = [];
      for (const name of FIXTURES) {
        await openFixture(page, name, scale);
        const probe: LayoutProbe = await layoutProbe(page);
        const info = await inspect(page);
        const enabled = info.controls.filter((c) => c.enabled).map((c) => c.testId ?? '');
        let reached: string[] = [];
        let notFullyVisible: string[] = [];
        if (enabled.length > 0) {
          const t = await tourVisibility(page, enabled);
          reached = t.reached;
          notFullyVisible = t.notFullyVisible;
          maxSettle = Math.max(maxSettle, t.maxSettleMs);
          for (const c of t.ringClipped) ringClipped.push(`${scale}:${name}:${c}`);
        }
        report.scale.push({
          scale,
          screen: name,
          scrolls: probe.scrolls,
          overflowPx: Math.round(probe.overflowPx),
          footerInside: probe.footer.inside,
          horizontalOutside: probe.horizontalOutside.length,
          horizontalClipped: probe.horizontalClipped.length,
          controls: enabled.length,
          reached: reached.length,
          notFullyVisibleOnFocus: notFullyVisible,
        });
        if (probe.scrolls) (scrolling[String(scale)] as string[]).push(`${name}(${Math.round(probe.overflowPx)}px)`);
        if (!probe.footer.inside) failures.push(`${name}: footer not fully visible`);
        if (probe.horizontalOutside.length > 0) horizontal.push(`${name}: ${probe.horizontalOutside.length} element(s) beyond the left/right edge, first ${JSON.stringify(probe.horizontalOutside[0])}`);
        if (probe.horizontalClipped.length > 0) horizontal.push(`${name}: content wider than its viewport, clipped ${JSON.stringify(probe.horizontalClipped[0])}`);
        if (enabled.length > 0 && reached.length < enabled.length) failures.push(`${name}: controls never reached by keys: ${enabled.filter((id) => !reached.includes(id)).join(', ')}`);
        for (const nf of notFullyVisible) {
          // A control cut off at the side belongs to the horizontal-clipping gate (open defect A11Y-05 at 2.0).
          if (nf.includes('(H|')) horizontal.push(`${name}: control cut off at the side when focused: ${nf.replace('H|', '')}`);
          else failures.push(`${name}: not fully visible when focused: ${nf}`);
        }
        if (scale <= 1.25) {
          if (probe.scrolls) failures.push(`${name}: scrolls by ${Math.round(probe.overflowPx)} px`);
          if (probe.verticalOutsideFixed.length > 0) failures.push(`${name}: fixed element beyond the top/bottom edge ${JSON.stringify(probe.verticalOutsideFixed[0])}`);
        }
      }
      await page.close();
      report.store[`scale_${scale}_failures`] = failures;
      report.store[`scale_${scale}_horizontal_clipping`] = horizontal;
      report.store[`scale_${scale}_screens_that_scroll`] = scrolling[String(scale)] ?? [];
      report.store[`scale_${scale}_max_focus_settle_ms`] = maxSettle;
      expect(failures).toEqual([]);
      // Horizontal clipping is a hard gate up to 1.5; at 2.0 it is the open defect A11Y-05 below.
      if (scale <= 1.5) expect(horizontal).toEqual([]);
    });
  }

  defect('A11Y-05', 'at UI scale 2.0 content is clipped horizontally: the number-matching choices on join_confirm and the timer plus meter row on calibration are wider than the screen', () => {
    expect(report.store['scale_2_horizontal_clipping']).toEqual([]);
  });

  defect('A11Y-04', 'the screen scroller clips the focus ring (the 6 px ring and the 1.05 scale grow beyond the control box): the left edge of left-aligned controls is cut by about 8 px on every screen at every scale, and at 2.0 the bottom of the last control by a few px', () => {
    report.store['ring_clipped_by_scroller'] = ringClipped;
    expect(ringClipped).toEqual([]);
  });
});

/* ================================================================== D. store mode */

/**
 * Number matching (A3-06, contract rev 2): the join screen offers three two-digit choices and Reject. Press the one
 * that equals the digits the phone shows, using only the arrow keys and Enter. Returns the test id that was pressed.
 */
async function pickMatchingChoice(page: Page, digits: string, wrong = false): Promise<string> {
  const picks = await page.$$eval('[data-testid^="action-pick_choice_"]', (els) =>
    els.map((e) => ({ id: e.getAttribute('data-testid') ?? '', name: e.getAttribute('aria-label') ?? (e as HTMLElement).innerText })),
  );
  expect(picks.length, 'three number choices on the join screen').toBe(3);
  const target = picks.find((p) => (wrong ? !p.name.includes(digits) : p.name.includes(digits)));
  expect(target, `a choice that ${wrong ? 'differs from' : 'matches'} ${digits}`).toBeDefined();
  await navigateTo(page, (target as { id: string }).id);
  await press(page, 'Enter');
  return (target as { id: string }).id;
}

/** Store-mode groups drive the real session store through the number-matching join UI (the tv rework merged at 7806229). TV_UI_REV2=0 skips them against an older UI. */
const storeDescribe = process.env['TV_UI_REV2'] === '0' ? describe.skip : describe;


storeDescribe('D. store mode: real session store, scripted phone, keyboard only', () => {
  it('home -> settings -> Delete dialog: Cancel focused, Back restores focus, history shows "No session" for every day, nothing written to localStorage', async () => {
    const page = await context.newPage();
    await page.addInitScript(LIVE_LOG_INIT);
    await page.goto(`${PREVIEW_URL}/?mode=store`);
    await page.waitForSelector('[data-testid="screen-onboarding"]');
    expect((await inspect(page)).footer).toBe(FOOTER_TEXT);
    expect((await inspect(page)).bodyText).toContain('Fixture replay');
    await press(page, 'Enter'); // I understand
    await page.waitForSelector('[data-testid="screen-home"]');
    expect(await activeId(page)).toBe('action-start_session');

    // History first: every one of the last 7 days is "No session" (a missing day is not a zero).
    await press(page, 'ArrowDown');
    expect(await activeId(page)).toBe('action-open_history');
    await press(page, 'Enter');
    await page.waitForSelector('[data-testid="screen-history"]');
    const captions = await page.$$eval('[data-testid^="history-caption-"]', (els) => els.map((e) => (e as HTMLElement).innerText));
    expect(captions).toHaveLength(7);
    expect(captions.every((c) => c === 'No session')).toBe(true);
    const labels = await page.$$eval('[data-testid^="history-day-"]', (els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    expect(labels).toHaveLength(7);
    for (const l of labels) expect(l).toContain('No session');
    expect((await inspect(page)).footer).toBe(FOOTER_TEXT);
    await press(page, 'Escape'); // Back
    await page.waitForSelector('[data-testid="screen-home"]');

    // Settings -> Delete local practice data
    await press(page, 'ArrowDown');
    await press(page, 'ArrowDown');
    expect(await activeId(page)).toBe('action-open_settings');
    await press(page, 'Enter');
    await page.waitForSelector('[data-testid="screen-settings"]');
    await navigateTo(page, 'action-delete_local_data');
    await press(page, 'Enter');
    await page.waitForSelector('[data-testid="screen-confirm_dialog"]');
    expect(await activeId(page)).toBe('action-cancel_destructive');
    expect(await ringCount(page)).toBe(1);
    // Back (Escape) is Cancel and the opener regains focus
    await press(page, 'Escape');
    await page.waitForSelector('[data-testid="screen-settings"]');
    expect(await activeId(page)).toBe('action-delete_local_data');
    // OK on the default focus (Cancel) must not delete anything
    await press(page, 'Enter');
    await page.waitForSelector('[data-testid="screen-confirm_dialog"]');
    await press(page, 'Enter'); // Cancel is focused
    await page.waitForSelector('[data-testid="screen-settings"]');
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('atr:')))).toEqual([]);
    // Now confirm explicitly: move to Delete and press OK
    await press(page, 'Enter');
    await page.waitForSelector('[data-testid="screen-confirm_dialog"]');
    await press(page, 'ArrowRight');
    expect(await activeId(page)).toBe('action-confirm_destructive');
    await press(page, 'Enter');
    await page.waitForSelector('[data-testid="screen-settings"]');
    const banner = await page.$eval('[data-testid="banner"]', (e) => (e as HTMLElement).innerText);
    expect(banner).toMatch(/deleted/i);
    // Fixture-replay store: the browser's real localStorage never received an atr: key.
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('atr:')))).toEqual([]);
    // About names the unencrypted store.
    await navigateTo(page, 'action-open_about');
    await press(page, 'Enter');
    await page.waitForSelector('[data-testid="screen-about"]');
    expect((await inspect(page)).bodyText).toMatch(/unencrypted/i);
    await page.close();
  });

  it('full journey: pair, quiet check, calibration, Back during capture, retry, blind phrase 3, summary, history', async () => {
    const page = await context.newPage();
    await page.addInitScript(LIVE_LOG_INIT);
    const phone = new ScriptedPhone(page, {
      bank: ['Pass the salt please', 'Open the window', 'Where is my coat'],
      calibrationRel: 20,
      phrases: {
        1: { rel: 25, resultDelayMs: 4000 }, // long enough to press Back during capture
        2: { rel: 5, resultDelayMs: 500 },
        3: { rel: 25, resultDelayMs: 2200, levels: [-140, 20, -140, 20, -140, 20] },
      },
    });
    await phone.install();
    await page.goto(`${PREVIEW_URL}/?mode=store`);
    const wait = (id: string, t = 12_000): Promise<unknown> => page.waitForSelector(`[data-testid="screen-${id}"]`, { timeout: t });
    const text = async (): Promise<string> => (await inspect(page)).bodyText;
    const storeShots: Record<string, unknown> = {};

    await wait('onboarding');
    await press(page, 'Enter');
    await wait('home');
    await press(page, 'Enter'); // Start session
    await wait('pairing');
    expect(await activeId(page)).toBe('action-cancel');
    let info = await inspect(page);
    expect(info.controls.every((c) => c.name !== '')).toBe(true);
    expect(await page.$('[data-testid="qr-code"][role="img"][aria-label]')).not.toBeNull();
    expect(await page.$eval('[data-testid="pairing-code"]', (e) => (e as HTMLElement).innerText)).toBe('ACDEFH');
    expect(await page.$eval('[data-testid="pairing-code"]', (e) => e.getAttribute('aria-label'))).toMatch(/A C D E F H/);
    phone.requestJoin();
    await wait('join_confirm');
    const joinInfo = await inspect(page);
    storeShots['join_confirm_preferred'] = joinInfo.controls.find((c) => c.preferred)?.testId ?? null;
    expect(storeShots['join_confirm_preferred']).toBe('action-reject_join'); // A3-06: Reject is the safe default
    expect(await activeId(page)).toBe('action-reject_join');
    await pickMatchingChoice(page, phone.confirmDigits);
    await wait('quiet_check', 15_000);
    expect(await activeId(page)).toBe('action-begin_quiet_check');
    // The phone's bank must be applied before any window opens (an update during a window is rejected).
    expect(await phone.waitForBankAck()).toEqual({ outcome: 'applied', detail: '' });

    // Quiet lead: no focusable control, live region off and empty, 20 OK presses change nothing.
    await press(page, 'Enter', 60);
    for (let i = 0; i < 19; i += 1) await page.keyboard.press('Enter');
    info = await inspect(page);
    expect(info.activeIsBody).toBe(true);
    expect(info.controls.filter((c) => c.enabled)).toEqual([]);
    expect(info.liveRegion.ariaLive).toBe('off');
    expect(info.liveRegion.text).toBe('');
    await wait('calibration', 15_000);
    await page.waitForTimeout(300);
    expect(phone.count('window.cancel')).toBe(0);
    expect(phone.count('precheck.start')).toBe(1);
    expect(await activeId(page)).toBe('action-begin_calibration');
    await press(page, 'Enter');
    await page.waitForSelector('text=Today\'s band is set', { timeout: 15_000 });
    await press(page, 'Enter'); // Continue
    await wait('vowel');
    await press(page, 'ArrowRight');
    expect(await activeId(page)).toBe('action-skip_vowel');
    await press(page, 'Enter');
    await page.waitForSelector('text=Phrase 1 of 3');
    expect(await activeId(page)).toBe('action-begin_phrase');

    // Phrase 1: Back during capture cancels on the phone and reveals "Not scored".
    await press(page, 'Enter', 60);
    await page.waitForSelector('[data-testid="action-stop_early"]', { timeout: 10_000 });
    info = await inspect(page);
    expect(info.arcMeterPresent).toBe(true); // visible position: the meter is there
    expect(await activeId(page)).toBe('action-stop_early');
    expect(info.liveRegion.ariaLive).toBe('off');
    expect(info.liveRegion.text).toBe('');
    expect(info.controls.map((c) => c.testId)).toContain('action-cancel');
    // A8-01: while a window is open the status chips and labels are visual only (hidden from the accessibility tree, no label).
    const chipsDuring = await page.$$eval('[data-testid="status-mic"], [data-testid="status-link"], [data-testid="labels"] > *, [data-testid="banner"]', (els) =>
      els.map((e) => ({ id: e.getAttribute('data-testid') ?? e.tagName, hidden: e.getAttribute('aria-hidden'), label: e.getAttribute('aria-label') })),
    );
    expect(chipsDuring.length).toBeGreaterThanOrEqual(3);
    for (const c of chipsDuring) expect(c, 'visual-only while capturing').toMatchObject({ hidden: 'true', label: null });
    storeShots['chips_visual_only_while_capturing'] = chipsDuring.length;
    await press(page, 'Escape');
    await wait('reveal');
    expect(await text()).toContain('Not scored');
    expect(await page.$eval('[data-testid="status-mic"]', (e) => e.getAttribute('aria-label'))).toMatch(/Phone microphone:/); // labelled again once the window is closed
    expect(phone.count('window.cancel')).toBe(1);
    expect(phone.last('window.cancel')?.payload['reason']).toBe('user_cancel');
    expect(await activeId(page)).toBe('action-try_again');
    await press(page, 'Enter'); // Try again
    await page.waitForSelector('text=Retry: the meter will be shown');
    await press(page, 'Enter', 60); // Begin (retry)
    await page.waitForSelector('[data-testid="action-stop_early"]', { timeout: 10_000 });
    await page.waitForSelector('[data-testid="screen-reveal"]', { timeout: 12_000 });
    expect(await text()).toContain("Reached today's relative level band");
    await press(page, 'Enter'); // Next phrase

    // Phrase 2: below the band.
    await page.waitForSelector('text=Phrase 2 of 3');
    await press(page, 'Enter', 60);
    await wait('reveal', 15_000);
    expect(await text()).toContain("Below today's relative level band");
    await press(page, 'Enter'); // Next phrase

    // Phrase 3: the blind position. Sample the DOM throughout.
    await page.waitForSelector('text=Phrase 3 of 3');
    expect(await text()).toContain('Blind check');
    await shot(page, 'store_p3_blind_ready');
    await press(page, 'Enter', 60); // Begin
    const samples: ScreenInfo[] = [];
    const blindDeadline = Date.now() + 20_000;
    let sawCapture = false;
    while (Date.now() < blindDeadline) {
      const s = await inspect(page);
      samples.push(s);
      if (s.screenTestId === 'screen-phrase' && s.controls.some((c) => c.testId === 'action-stop_early')) {
        sawCapture = true;
        if (storeShots['p3_capture_shot'] === undefined) {
          storeShots['p3_capture_shot'] = await shot(page, 'store_p3_blind_capture');
        }
      }
      if (s.screenTestId === 'screen-response') break;
      await page.waitForTimeout(100);
    }
    expect(sawCapture).toBe(true);
    // Live view of the blind capture, lead through response prompt: no meter, no result, no verdict wording anywhere.
    for (const s of samples) {
      expect(s.arcMeterPresent, `blind sample ${s.screenTestId}`).toBe(false);
      expect(s.arcParts).toEqual([]);
      expect(s.resultPresent).toBe(false);
      expect(s.svgCount).toBe(0);
      expect(s.bodyText).not.toMatch(FORBIDDEN_BEFORE_REVEAL);
      for (const l of s.ariaLabels) expect(l).not.toMatch(FORBIDDEN_BEFORE_REVEAL);
      if (s.screenTestId === 'screen-phrase' && s.controls.length > 0) {
        expect(s.liveRegion.ariaLive).toBe('off'); // while capturing
        expect(s.liveRegion.text).toBe('');
      }
    }
    await wait('response');
    info = await inspect(page);
    expect(info.controls.map((c) => c.name)).toEqual(['Felt loud', 'Felt normal', 'Skip rating']);
    expect(info.resultPresent).toBe(false);
    expect(info.bodyText).not.toMatch(FORBIDDEN_BEFORE_REVEAL);
    expect(await activeId(page)).toBe('action-rate_felt_loud');
    expect(phone.count('attempt.reveal')).toBe(2); // phrase 1 retry and phrase 2 only: no reveal yet for the blind attempt
    await press(page, 'ArrowRight');
    expect(await activeId(page)).toBe('action-rate_felt_normal');
    await press(page, 'Enter');
    await wait('reveal');
    expect(await text()).toContain("Reached today's relative level band");
    expect(await text()).toContain('You felt: normal');
    expect(phone.count('attempt.reveal')).toBe(3);
    // The live-region log never carried a verdict between the start of phrase 3 and its rating prompt.
    const log = await liveLog(page);
    const p3Start = log.findIndex((e) => e.text.includes('Phrase 3 of 3'));
    const prompt = log.findIndex((e) => e.text.includes('How did that feel'));
    expect(p3Start).toBeGreaterThan(-1);
    expect(prompt).toBeGreaterThan(p3Start);
    for (const e of log.slice(p3Start, prompt + 1)) {
      expect(e.text).not.toMatch(/reached|below/i);
      expect(e.body).not.toMatch(FORBIDDEN_BEFORE_REVEAL);
      for (const l of e.labels) expect(l ?? '').not.toMatch(FORBIDDEN_BEFORE_REVEAL);
    }
    const capturingEntries = log.slice(p3Start, prompt).filter((e) => e.live === 'off');
    expect(capturingEntries.length).toBeGreaterThan(0);
    for (const e of capturingEntries) expect(e.text).toBe('');
    storeShots['live_log_entries'] = log.length;
    await press(page, 'Enter'); // See summary
    await wait('summary');
    const summary = await text();
    expect(summary).toContain('Phrases completed: 3 of 3 attempted, 0 skipped');
    expect(summary).toContain('Attempts not scored: 1 (cancelled 1)');
    expect(summary).toMatch(/blind checks: 1 of 1/);
    expect(summary).toMatch(/other phrases: 1 of 2/);
    expect(summary).not.toMatch(/far side/i); // ADR-0001 section 8 wording (OBS-A4 resolved)
    expect((await inspect(page)).footer).toBe(FOOTER_TEXT);
    await shot(page, 'store_summary');
    expect(phone.count('session.end')).toBe(1);

    // History: today shows the session, six other days "No session".
    await press(page, 'ArrowRight'); // View history
    await press(page, 'Enter');
    await wait('history');
    const captions = await page.$$eval('[data-testid^="history-caption-"]', (els) => els.map((e) => (e as HTMLElement).innerText));
    expect(captions.slice(0, 6).every((c) => c === 'No session')).toBe(true);
    expect(captions[6]).toBe('2 of 3 reached');

    storeShots['phone_received'] = phone.received.map((m) => m.type).join(',');
    report.store['journey'] = storeShots;
    await page.close();
  });

  it('A11Y-01 (fixed in wave 2): Settings: controls the session view marks disabled (Reset band, Unpair outside a session) are not focusable and expose aria-disabled', async () => {
    const page = await context.newPage();
    await page.goto(`${PREVIEW_URL}/?mode=store`);
    await page.waitForSelector('[data-testid="screen-onboarding"]');
    await press(page, 'Enter');
    await page.waitForSelector('[data-testid="screen-home"]');
    await navigateTo(page, 'action-open_settings');
    await press(page, 'Enter');
    await page.waitForSelector('[data-testid="screen-settings"]');
    const info = await inspect(page);
    const reset = info.controls.find((c) => c.testId === 'action-reset_calibration');
    const unpair = info.controls.find((c) => c.testId === 'action-unpair_phone');
    report.store['settings_disabled_controls'] = [reset, unpair].map((c) => ({ id: c?.testId, tabIndex: c?.tabIndex, ariaDisabled: c?.ariaDisabled }));
    await page.close();
    for (const c of [reset, unpair]) {
      // Correct behaviour: either announced as disabled or removed from the focus order.
      expect(c?.ariaDisabled === 'true' || (c?.tabIndex ?? 0) < 0, `${c?.testId} must be disabled for assistive tech or unfocusable`).toBe(true);
    }
  });
});

/* ================================================================== D2. revision 4 flows in store mode */

/** Polls a condition in Node until it holds (the preview runs in real time). */
async function waitUntil(cond: () => boolean | Promise<boolean>, timeoutMs = 15_000, what = 'condition'): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Onboarding -> Start session -> pair with the scripted phone -> quiet-check ready screen, keyboard only. */
async function pairToQuiet(page: Page, phone: ScriptedPhone, query = ''): Promise<void> {
  await page.goto(`${PREVIEW_URL}/?mode=store${query}`);
  await page.waitForSelector('[data-testid="screen-onboarding"]');
  await press(page, 'Enter');
  await page.waitForSelector('[data-testid="screen-home"]');
  await press(page, 'Enter');
  await page.waitForSelector('[data-testid="screen-pairing"]');
  phone.requestJoin();
  await page.waitForSelector('[data-testid="screen-join_confirm"]');
  await pickMatchingChoice(page, phone.confirmDigits);
  await page.waitForSelector('[data-testid="screen-quiet_check"]', { timeout: 15_000 });
  await page.waitForSelector('[data-testid="action-begin_quiet_check"]');
}

const micChip = (page: Page): Promise<string> => page.$eval('[data-testid="status-mic"]', (e) => e.getAttribute('aria-label') ?? '');

storeDescribe('D2. protocol revision 4 and contract revision 2 in the real UI (scripted phone)', () => {
  it('a wrong number pick rejects the phone, burns the code and says so; Reject and Back also reject; the right pick then pairs', async () => {
    const page = await context.newPage();
    const phone = new ScriptedPhone(page, {});
    await phone.install();
    await page.goto(`${PREVIEW_URL}/?mode=store`);
    await page.waitForSelector('[data-testid="screen-onboarding"]');
    await press(page, 'Enter');
    await page.waitForSelector('[data-testid="screen-home"]');
    await press(page, 'Enter');
    await page.waitForSelector('[data-testid="screen-pairing"]');
    phone.requestJoin();
    await page.waitForSelector('[data-testid="screen-join_confirm"]');
    const join = await inspect(page);
    expect(join.bodyText).toContain('Name the phone gave: QA scripted phone');
    expect(join.bodyText).not.toMatch(/confirm digits/i);
    await pickMatchingChoice(page, phone.confirmDigits, true); // a decoy
    await page.waitForSelector('[data-testid="screen-pairing"]');
    expect(phone.last('join.confirm')?.payload['decision']).toBe('reject');
    expect(await page.$eval('[data-testid="banner"]', (e) => e.getAttribute('aria-label'))).toContain('That number did not match. Pair again.');
    expect(await page.$('[data-testid="pairing-code"]')).toBeNull(); // the burned code is not shown
    // Back on the next request rejects as well.
    phone.requestJoin();
    await page.waitForSelector('[data-testid="screen-join_confirm"]');
    await press(page, 'Escape');
    await page.waitForSelector('[data-testid="screen-pairing"]');
    expect(phone.last('join.confirm')?.payload['decision']).toBe('reject');
    phone.requestJoin();
    await page.waitForSelector('[data-testid="screen-join_confirm"]');
    await pickMatchingChoice(page, phone.confirmDigits);
    await page.waitForSelector('[data-testid="screen-quiet_check"]', { timeout: 15_000 });
    expect(phone.last('join.confirm')?.payload['decision']).toBe('accept');
    await page.close();
  });

  it('A8-02: with the screen reader on (?screenReader=1) the ready screens carry the spoken script and the quiet lead is 3 s; off, it is 1.5 s', async () => {
    const lead = async (query: string): Promise<{ ms: number; announcement: string }> => {
      const page = await context.newPage();
      const phone = new ScriptedPhone(page, {});
      await phone.install();
      await pairToQuiet(page, phone, query);
      await waitUntil(async () => (await micChip(page)).includes('Microphone open'), 10_000, 'mic open chip');
      const announcement = (await inspect(page)).liveRegion.text;
      const before = phone.count('precheck.start');
      const t0 = Date.now();
      await press(page, 'Enter', 20);
      await waitUntil(() => phone.count('precheck.start') > before, 10_000, 'precheck.start');
      const idx = phone.received.map((m) => m.type).lastIndexOf('precheck.start');
      const ms = (phone.receivedAt[idx] ?? Date.now()) - t0;
      await page.close();
      return { ms, announcement };
    };
    const on = await lead('&screenReader=1');
    expect(on.announcement).toContain('After this message, stay quiet for the whole check. Measurement lasts five seconds.');
    expect(on.ms).toBeGreaterThanOrEqual(2900);
    expect(on.ms).toBeLessThan(4500);
    const off = await lead('');
    expect(off.announcement).not.toContain('After this message');
    expect(off.ms).toBeGreaterThanOrEqual(1400);
    expect(off.ms).toBeLessThan(2600);
    report.store['screen_reader_lead_ms'] = { on: on.ms, off: off.ms };
  });

  it('silent_input: the quiet check fails with Try again focused, the footer stays, and a good check recovers', async () => {
    const page = await context.newPage();
    const phone = new ScriptedPhone(page, { silentFirstQuietCheck: true });
    await phone.install();
    await pairToQuiet(page, phone);
    await press(page, 'Enter', 60); // Begin quiet check
    await page.waitForSelector('text=Quiet check did not pass', { timeout: 15_000 });
    const failed = await inspect(page);
    expect(failed.controls.map((c) => c.name)).toEqual(['Try again', 'Cancel']);
    expect(await activeId(page)).toBe('action-retry');
    expect(failed.footer).toBe(FOOTER_TEXT);
    expect(phone.count('window.start')).toBe(0);
    report.store['silent_input_quiet_check_text'] = failed.bodyText; // copy finding: see DEFECT QA-08 in the vitest review
    await press(page, 'Enter'); // Try again
    await page.waitForSelector('[data-testid="action-begin_quiet_check"]');
    await press(page, 'Enter', 60);
    await page.waitForSelector('[data-testid="screen-calibration"]', { timeout: 15_000 });
    expect(phone.count('precheck.start')).toBe(2);
    await page.close();
  });

  it('link loss on the quiet-check screen: warning banner, mic "Phone state unknown" (never off), nothing starts; reconnect resumes with the original credential', async () => {
    const page = await context.newPage();
    const phone = new ScriptedPhone(page, {});
    await phone.install();
    await pairToQuiet(page, phone);
    await waitUntil(async () => (await micChip(page)).includes('Microphone open'), 10_000, 'mic open chip');
    phone.dropLink();
    await page.waitForSelector('[data-testid="banner"]', { timeout: 5_000 });
    expect(await page.$eval('[data-testid="banner"]', (e) => e.getAttribute('aria-label'))).toMatch(/link lost|Reconnecting|not reachable/i);
    const during = await inspect(page);
    const chip = await micChip(page);
    expect(chip).toContain('Phone state unknown');
    expect(chip).not.toMatch(/off/i);
    expect(during.footer).toBe(FOOTER_TEXT);
    report.store['link_loss_focus'] = { active: during.activeTestId, controls: during.controls.map((c) => c.testId) };
    await waitUntil(() => phone.resumed.length >= 1, 15_000, 'auth.resume');
    expect(phone.resumed[0]).toBe(CREDENTIAL); // the first resume presents the credential from room.created
    await waitUntil(async () => (await micChip(page)).includes('Microphone open'), 10_000, 'mic reported again after reconnect');
    expect(phone.count('precheck.start')).toBe(0); // nothing started by itself
    expect(await page.$('[data-testid="banner"]')).toBeNull();
    expect(await ringCount(page)).toBe(1);
    await page.close();
  });

  it('QA-09 (fixed in wave 2): after auth.ok rotates the credential, the second reconnect presents the rotated credential', async () => {
    const page = await context.newPage();
    const phone = new ScriptedPhone(page, {});
    await phone.install();
    await pairToQuiet(page, phone);
    await waitUntil(async () => (await micChip(page)).includes('Microphone open'), 10_000, 'mic open chip');
    phone.dropLink();
    await waitUntil(() => phone.resumed.length >= 1, 15_000, 'first auth.resume');
    await waitUntil(async () => (await micChip(page)).includes('Microphone open'), 10_000, 'recovered');
    phone.dropLink();
    await waitUntil(() => phone.resumed.length >= 2, 15_000, 'second auth.resume');
    report.store['credential_trail'] = { resumedCount: phone.resumed.length, secondIsRotated: phone.resumed[1] === phone.rotated[0] };
    await page.close();
    expect(phone.resumed[1]).toBe(phone.rotated[0]);
    expect(phone.resumed[0]).toBe(CREDENTIAL);
  });
});

/* ================================================================== E. checker self-tests (negative controls) */

describe('E. the checks above can actually fail (negative controls on the same page)', () => {
  it('the focus-ring check notices a missing ring, the name check an empty label, the meter check an injected arc', async () => {
    const page = await context.newPage();
    await openFixture(page, 'phrase_active_hidden');
    const before = await inspect(page);
    expect(before.arcMeterPresent).toBe(false);
    await page.evaluate(() => {
      const meter = document.createElement('div');
      meter.setAttribute('data-testid', 'arc-meter');
      document.querySelector('[data-testid="tv-canvas"]')?.appendChild(meter);
    });
    expect((await inspect(page)).arcMeterPresent).toBe(true);
    await page.close();

    const home = await context.newPage();
    await openFixture(home, 'home');
    expect(await ringCount(home)).toBe(1);
    await home.addStyleTag({ content: '[role="button"] { border-color: transparent !important; }' });
    expect(await ringCount(home)).toBe(0);
    await home.evaluate(() => {
      const el = document.querySelector('[data-testid="action-open_history"]') as HTMLElement;
      el.removeAttribute('aria-label');
      el.innerText = '';
    });
    const unnamed = (await inspect(home)).controls.filter((c) => c.name === '').map((c) => c.testId);
    expect(unnamed).toEqual(['action-open_history']);
    await home.close();
  });
});

