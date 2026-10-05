// N-01 in real (headless) Chrome with the page's real timers and a scripted relay.
//
//   Case 1 (half-open recovery): after the connection dies, the relay still holds the old socket and
//     refuses the phone's own reconnect with a generic `unauthorized` a few times, then lets it in.
//     The page must keep trying, never claim the pairing is gone, present the SAME credential every
//     time (a refusal does not consume it), and be connected again, with the rotated credential in use.
//   Case 2 (the refusals really continue): after 30 s the page concludes the pairing is lost and says
//     "Could not reconnect" (not "pairing expired"), without hammering the relay (under 10 refused
//     resumes), and never retries again.
//
// Evidence class: automated, desktop Chrome, scripted relay. Takes about 45 s (case 2 runs in real time).
// Run: npm run build:test -w @atr/phone && node e2e/resume-refusal.mjs
import { createIdFactory, MessageFactory, parseWireMessage } from '@atr/protocol';
import { launchChrome, makeChecker, startStaticServer, waitFor } from './lib.mjs';

const checker = makeChecker();
const { check } = checker;
const site = await startStaticServer();
let browser;

const ids = createIdFactory();
const ROOM = ids.room();
const clock = () => Date.now();
const ORIGINAL = 'O'.repeat(43);
const ROTATED = 'R'.repeat(43);

async function scenario(name, refusals /* number of resumes to refuse; Infinity = all */) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const relay = new MessageFactory({ role: 'relay', idFactory: ids, clock });
  const state = { conns: [], resumes: [], received: [], invalid: [] };
  await page.routeWebSocket(/\/ws$/, (ws) => {
    state.conns.push(ws);
    ws.onMessage((raw) => {
      const parsed = parseWireMessage(String(raw));
      if (!parsed.ok) {
        state.invalid.push(`${parsed.code}: ${parsed.detail}`);
        return;
      }
      const m = parsed.message;
      state.received.push(m);
      if (m.type === 'join.request') {
        ws.send(JSON.stringify(relay.next('join.pending', { join_id: ids.join(), confirm_digits: '47', expires_at: Date.now() + 60_000 }, { room_id: null })));
        ws.send(JSON.stringify(relay.next('join.accepted', { room_id: ROOM, phone_credential: ORIGINAL, credential_expires_at: Date.now() + 3_600_000, generation: 1 }, { room_id: ROOM })));
      } else if (m.type === 'auth.resume') {
        state.resumes.push({ at: Date.now(), credential: m.payload.credential });
        if (state.resumes.length <= refusals) {
          ws.send(JSON.stringify(relay.next('error', { code: 'unauthorized', ref_message_id: m.message_id, detail: '' }, { room_id: null })));
        } else {
          ws.send(JSON.stringify(relay.next('auth.ok', { role: 'phone', generation: 1 + state.resumes.length, peer_connected: true, phone_paired: true, next_credential: ROTATED }, { room_id: ROOM })));
        }
      }
    });
  });
  await page.goto(`${site.origin}/#code=ACDEFH`);
  await page.click('#join');
  await page.waitForSelector('#confirm-self:not([hidden])');
  await page.click('#confirm-yes');
  await page.waitForSelector('#view-setup:not([hidden])');
  await waitFor(() => state.received.some((m) => m.type === 'mic.state'), { label: `${name}: first mic.state` });
  return { context, page, state };
}

try {
  browser = await launchChrome();
  console.log(`Chrome ${browser.version()} launched headless`);

  // ---------------- case 1: refused three times, then accepted ----------------------------------------
  {
    const { context, page, state } = await scenario('half-open', 3);
    const lostAt = Date.now();
    await state.conns[0].close({ code: 1006, reason: 'test: the old socket is gone' });
    const sawNotice = [];
    const watcher = setInterval(async () => {
      try {
        sawNotice.push(await page.evaluate(() => !document.getElementById('unpaired-notice').hidden || !document.getElementById('view-setup') || document.getElementById('view-setup').hidden));
      } catch {
        /* page closing */
      }
    }, 250);
    await waitFor(() => state.resumes.length >= 4, { timeout: 20_000, label: 'four auth.resume attempts' });
    await page.waitForFunction(() => /^Connected to the relay/.test(document.getElementById('link').textContent), undefined, { timeout: 10_000 });
    clearInterval(watcher);
    const elapsed = Date.now() - lostAt;
    console.log(`      refused 3 times, accepted on attempt 4, after ${elapsed} ms`);
    check('case 1: four resumes were made and the fourth was accepted (about 7.5 s of backoff with jitter: 0.5 + 1 + 2 + 4 s)', state.resumes.length === 4 && elapsed > 2000 && elapsed < 9000, `${state.resumes.length} resumes, ${elapsed} ms`);
    check('case 1: every attempt presented the SAME credential (a refusal does not consume it)', new Set(state.resumes.map((r) => r.credential)).size === 1 && state.resumes[0].credential === ORIGINAL);
    check('case 1: the page never left the paired view or showed a "no longer paired" / "Could not reconnect" message while retrying', sawNotice.length > 0 && sawNotice.every((v) => v === false));
    check('case 1: the page is paired and connected again, with the mic untouched', (await page.isVisible('#view-setup')) && !(await page.isVisible('#view-join')));
    await waitFor(() => state.received.filter((m) => m.type === 'mic.state').length >= 2, { label: 'mic.state after the reconnect' });
    check('case 1: mic.state was sent again after the successful resume', true);
    // the next reconnect must use the rotated credential
    await state.conns.at(-1).close({ code: 1006, reason: 'test: second drop' });
    await waitFor(() => state.resumes.length >= 5, { timeout: 10_000, label: 'the fifth auth.resume' });
    check('case 1: the next reconnect presents the ROTATED credential', state.resumes[4].credential === ROTATED, state.resumes[4].credential.slice(0, 3));
    check('case 1: every message the phone sent passed parseWireMessage', state.invalid.length === 0, state.invalid.join(' | '));
    await context.close();
  }

  // ---------------- case 2: refused for good ---------------------------------------------------------
  {
    const { context, page, state } = await scenario('refused-for-good', Number.POSITIVE_INFINITY);
    await state.conns[0].close({ code: 1006, reason: 'test: the old socket is gone' });
    await waitFor(() => state.resumes.length >= 1, { timeout: 10_000, label: 'the first refused resume' });
    const firstRefusal = state.resumes[0].at;
    let noticeEarly = false;
    for (;;) {
      const verdict = await page.evaluate(() => !document.getElementById('unpaired-notice').hidden);
      const now = Date.now();
      if (verdict) break;
      if (now - firstRefusal > 60_000) throw new Error('the page never concluded within 60 s');
      await new Promise((r) => setTimeout(r, 250));
    }
    const concludedAfter = Date.now() - firstRefusal;
    noticeEarly = concludedAfter < 30_000;
    console.log(`      concluded "Could not reconnect" ${concludedAfter} ms after the first refusal, after ${state.resumes.length} refused resumes`);
    check('case 2: no verdict before 30 s of refusals, and the verdict comes soon after (30 to 45 s)', !noticeEarly && concludedAfter <= 45_000, `${concludedAfter} ms`);
    check('case 2: the headline says "Could not reconnect"', (await page.textContent('#unpaired-heading')) === 'Could not reconnect');
    const text = await page.textContent('#unpaired-notice');
    check('case 2: it does not claim the pairing expired, and it says what to do', !/The pairing expired\./.test(text) && /Pair again from the TV/.test(text), text.replace(/\s+/g, ' '));
    check('case 2: the status line matches (announced politely)', /^Could not reconnect\./.test(await page.textContent('#status')));
    check('case 2: the relay was not hammered: fewer than 10 refused resumes (its per-minute limit)', state.resumes.length < 10, `${state.resumes.length}`);
    check('case 2: every refused attempt presented the same, unrotated credential', new Set(state.resumes.map((r) => r.credential)).size === 1);
    check('case 2: back on Join with the form ready; the microphone is off', (await page.isVisible('#join-form')) && (await page.textContent('#mic-badge')) === 'Mic off');
    const before = state.resumes.length;
    await new Promise((r) => setTimeout(r, 12_000));
    check('case 2: it never tries again with the dead credential', state.resumes.length === before);
    check('case 2: no credential left in the page', !(await page.content()).includes(ORIGINAL));
    await context.close();
  }
} catch (error) {
  check('resume-refusal run completed', false, String(error?.stack ?? error));
} finally {
  await browser?.close();
  await site.close();
}
if (checker.failed.length > 0) {
  console.error(`\n${checker.failed.length} check(s) failed`);
  process.exit(1);
}
console.log('\nresume-refusal: all checks passed');
