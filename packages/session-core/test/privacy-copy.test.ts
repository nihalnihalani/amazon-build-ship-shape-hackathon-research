/**
 * Privacy copy: the TV's sentence is the amended A2-01 sentence, exact, the same one the phone shows, and every TV
 * screen that carries a privacy statement takes it from one constant (PRIVACY_LINE) or one COPY.about block.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COPY, PRIVACY_LINE } from '../src/copy.js';
import { allStrings, boot, createFlakyStorage } from './helpers.js';

const A2_01 =
  'Audio stays on this phone and is never saved or uploaded. The phone sends only sound levels and when you are speaking, typed phrases, listener responses, phone status (microphone, screen, device name) and connection details to the relay and TV.';
const REVISION_1 = /Only levels, typed phrases, listener responses, and connection details/;

describe('PRIVACY_LINE is the exact A2-01 sentence', () => {
  it('is the amended revision 2 copy, not the revision 1 wording', () => {
    expect(PRIVACY_LINE).toBe(A2_01);
    expect(PRIVACY_LINE).not.toMatch(REVISION_1);
  });

  it('matches the exact copy in docs/adr/AMENDMENTS-REV2.md row A2-01 (when the docs are next to the package)', () => {
    const file = fileURLToPath(new URL('../../../docs/adr/AMENDMENTS-REV2.md', import.meta.url));
    if (!existsSync(file)) return;
    const row = readFileSync(file, 'utf8')
      .split('\n')
      .find((line) => line.startsWith('| A2-01'));
    expect(row).toBeDefined();
    const quoted = /\*\*"(.*?)"\*\*/.exec(row ?? '');
    expect(quoted?.[1]).toBe(PRIVACY_LINE);
  });

  it('the onboarding screen shows it, once, as its own line', async () => {
    const h = await boot({ storage: createFlakyStorage(), seed: {} });
    expect(h.view.screen).toBe('onboarding');
    expect(h.view.body.filter((line) => line === A2_01)).toHaveLength(1);
    expect(allStrings(h.view).join('\n')).not.toMatch(REVISION_1);
  });

  it('the pairing screen shows it, once, as its own line', async () => {
    const h = await boot();
    h.ui('start_session');
    h.transportState('connected');
    h.roomCreated();
    expect(h.view.screen).toBe('pairing');
    expect(h.view.body.filter((line) => line === A2_01)).toHaveLength(1);
    expect(allStrings(h.view).join('\n')).not.toMatch(REVISION_1);
  });

  it('the TV copy table has no other copy of the sentence or of its revision 1 wording', () => {
    const all = allStrings(COPY).join('\n');
    expect(all).not.toMatch(REVISION_1);
    // The sentence reaches COPY only through PRIVACY_LINE (onboarding and pairing), never as a second literal.
    const copies = allStrings(COPY).filter((s) => s === A2_01);
    expect(copies).toHaveLength(2);
    expect(COPY.onboarding.body).toContain(PRIVACY_LINE);
    expect(COPY.pairing.body).toContain(PRIVACY_LINE);
  });
});

describe('the About screen takes its privacy text from COPY.about only', () => {
  it('every privacy line of the About view is a COPY.about string (one source), in a fixed order', async () => {
    const h = await boot();
    h.ui('open_settings');
    h.ui('open_about');
    expect(h.view.screen).toBe('about');
    const body = h.view.body;
    expect(body).toContain(COPY.about.storage);
    expect(body).toContain(COPY.about.relayLine);
    expect(body).toContain(COPY.about.abuseLine);
    expect(body.indexOf(COPY.about.storage)).toBeLessThan(body.indexOf(COPY.about.relayLine));
    expect(body.indexOf(COPY.about.relayLine)).toBeLessThan(body.indexOf(COPY.about.abuseLine));
    // each appears exactly once: no second paraphrase of the storage disclosure on the same screen
    for (const line of [COPY.about.storage, COPY.about.relayLine, COPY.about.abuseLine]) {
      expect(body.filter((l) => l === line)).toHaveLength(1);
    }
    expect(body.filter((l) => /unencrypted/i.test(l))).toEqual([COPY.about.storage]);
    expect(body.filter((l) => /abuse-prevention/i.test(l))).toEqual([COPY.about.abuseLine]);
    // the revision 1 sentence is not on this screen either
    expect(allStrings(h.view).join('\n')).not.toMatch(REVISION_1);
  });

  it('the About storage line is not a second paraphrase of anything else in the TV copy table', () => {
    const storageLike = allStrings(COPY).filter((s) => /stored unencrypted|stays on this TV, stored unencrypted/i.test(s));
    expect(storageLike).toEqual([COPY.about.storage]);
  });
});
