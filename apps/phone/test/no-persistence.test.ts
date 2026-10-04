import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountView, type MountedView } from '../src/view.js';
import {
  authOk,
  CODE,
  flush,
  joinAccepted,
  joinPending,
  precheckStart,
  relayMsg,
  SESSION,
  sessionBegin,
  sessionEnd,
  tvMsg,
  validPrecheck,
  windowStart,
} from './helpers/fakes.js';
import { advanceLive, makeHarness } from './helpers/harness.js';

/**
 * A5-02: the phone persists nothing. During a full flow (join, confirm, mic, session, windows,
 * listener, phrases, cue, reconnect, unpair, failure) the page must not write cookies, localStorage,
 * sessionStorage, IndexedDB or the Cache API. Every access to those APIs is trapped, not only writes.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const STORAGE_GLOBALS = ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore'];

function trapPersistence() {
  const touched: string[] = [];
  const saved = STORAGE_GLOBALS.map((name) => ({ name, desc: Object.getOwnPropertyDescriptor(globalThis, name) }));
  for (const { name } of saved) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        touched.push(`global ${name}`);
        return undefined;
      },
    });
  }
  const cookieDesc = Object.getOwnPropertyDescriptor(document, 'cookie');
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() {
      touched.push('document.cookie read');
      return '';
    },
    set() {
      touched.push('document.cookie write');
    },
  });
  return {
    touched,
    restore() {
      for (const { name, desc } of saved) {
        if (desc) Object.defineProperty(globalThis, name, desc);
        else delete (globalThis as Record<string, unknown>)[name];
      }
      if (cookieDesc) Object.defineProperty(document, 'cookie', cookieDesc);
      else delete (document as unknown as Record<string, unknown>)['cookie'];
    },
  };
}

describe('A5-02: nothing is written to cookies, localStorage, sessionStorage, IndexedDB or the Cache API', () => {
  let view: MountedView | null = null;
  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it('through a complete flow with the real view mounted', async () => {
    const trap = trapPersistence();
    try {
      document.body.replaceChildren();
      const h = makeHarness();
      view = mountView(document.body.appendChild(document.createElement('div')), h.controller);
      const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
      const type = (id: string, v: string): void => {
        ($(id) as HTMLInputElement).value = v;
        $(id).dispatchEvent(new Event('input', { bubbles: true }));
      };

      // join, pick, confirm
      type('code', CODE);
      $('join').click();
      h.sockets.current.open();
      h.sockets.current.receive(joinPending());
      h.sockets.current.receive(joinAccepted());
      $('confirm-yes').click();
      await flush();

      // microphone, session, precheck, window, listener, cue, phrases
      $('start-mic').click();
      h.audio.makeOpen();
      await flush();
      h.sockets.current.receive(sessionBegin());
      h.sockets.current.receive(precheckStart());
      h.audio.startedMeasuring();
      h.audio.finishPrecheck(validPrecheck());
      await flush();
      h.sockets.current.receive(windowStart('phrase', 'w_window00002', 'a_attempt0002'));
      h.audio.frame(0);
      h.sockets.current.receive(tvMsg('window.stop', { reason: 'complete' }, { s: SESSION, w: 'w_window00002', a: 'a_attempt0002' }));
      await flush();
      h.sockets.current.receive(tvMsg('listener.open', { timeout_ms: 20000 }, { s: SESSION, w: 'w_window00002', a: 'a_attempt0002' }));
      $('heard').click();
      $('cue').click();
      type('cue-word', 'Hush');
      $('save-cue').click();
      type('phrase-1', 'A household phrase');
      $('save-phrases').click();
      h.sockets.current.receive(tvMsg('attempt.reveal', {}, { s: SESSION, w: 'w_window00002', a: 'a_attempt0002' }));

      // reconnect, then a long failure and a retry
      h.sockets.current.drop(1006);
      vi.advanceTimersByTime(500);
      h.sockets.current.open();
      h.sockets.current.receive(authOk(2));
      await flush();
      advanceLive(h, 30_000, () => relayMsg('pong', { server_time: 1 }));
      h.sockets.current.drop(1006);
      vi.advanceTimersByTime(125_000);
      $('retry').click();
      h.sockets.current.open();
      h.sockets.current.receive(authOk(3));
      await flush();

      // session end, hidden page, unpair
      h.sockets.current.receive(sessionEnd());
      await flush();
      h.visibility.set('hidden');
      h.visibility.set('visible');
      h.sockets.current.receive(relayMsg('unpaired', { reason: 'tv_unpaired' }));
      await flush();
      // and a second pairing that is refused by the person
      type('code', CODE);
      $('join').click();
      h.sockets.current.open();
      h.sockets.current.receive(joinPending());
      h.sockets.current.receive(joinAccepted());
      $('confirm-no').click();
      await flush();

      expect(h.sockets.sockets.length).toBeGreaterThan(3);
      expect(trap.touched).toEqual([]);
    } finally {
      trap.restore();
    }
  });

  it('the trap itself works (a write to each API is detected)', () => {
    const trap = trapPersistence();
    try {
      void (globalThis as Record<string, unknown>)['localStorage'];
      void (globalThis as Record<string, unknown>)['indexedDB'];
      void (globalThis as Record<string, unknown>)['caches'];
      document.cookie = 'a=b';
      expect(trap.touched).toEqual(['global localStorage', 'global indexedDB', 'global caches', 'document.cookie write']);
    } finally {
      trap.restore();
    }
  });
});
