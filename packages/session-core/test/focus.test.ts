import { describe, expect, it } from 'vitest';
import { boot } from './helpers.js';

describe('Back and focus contract with the TV UI', () => {
  it('remote Back and ui Back are the same input everywhere', async () => {
    const run = async (press: 'remote' | 'ui') => {
      const h = await boot();
      const back = () => (press === 'remote' ? h.back() : h.ui('back'));
      const trace: string[] = [];
      const note = () => trace.push(`${h.view.screen}/${h.view.stage}/${h.view.dialog?.title ?? '-'}`);
      note();
      back(); // Home: nothing destructive
      note();
      h.ui('open_settings');
      h.ui('open_about');
      note();
      back();
      note();
      h.ui('open_diagnostics');
      back();
      back();
      note();
      h.ui('open_settings');
      h.ui('delete_local_data');
      note();
      back(); // closes the dialog as Cancel
      note();
      back();
      h.ui('open_history');
      note();
      back();
      note();
      h.setupToPhrases();
      back(); // confirm leaving
      note();
      back(); // dialog closed
      note();
      h.beginAndLead('begin_phrase');
      back(); // cancels the window
      note();
      h.ui('finish_early');
      note();
      back(); // summary -> done
      note();
      return trace;
    };
    expect(await run('ui')).toEqual(await run('remote'));
  });

  it('a closed dialog returns focus to the control that opened it', async () => {
    const h = await boot();
    h.ui('open_settings');
    expect(h.view.preferredAction).toBeNull();
    h.ui('delete_local_data');
    expect(h.view.preferredAction).toBe('cancel_destructive');
    h.ui('cancel_destructive');
    expect(h.view.screen).toBe('settings');
    expect(h.view.preferredAction).toBe('delete_local_data');
    // Back on the dialog restores it as well
    h.ui('delete_local_data');
    h.back();
    expect(h.view.preferredAction).toBe('delete_local_data');
    // moving on forgets it
    h.ui('open_about');
    h.back();
    expect(h.view.preferredAction).toBeNull();
  });

  it('restores focus for reset and unpair, and for a Cancel that opened the leave dialog', async () => {
    const h = await boot();
    h.setupToPhrases();
    h.ui('open_settings');
    h.ui('reset_calibration');
    h.ui('cancel_destructive');
    expect(h.view.preferredAction).toBe('reset_calibration');
    h.back();
    expect(h.view.preferredAction).toBe('begin_phrase'); // back on the phrase screen: default focus again
    h.ui('finish_early');
    h.ui('done');
    h.ui('open_settings');
    h.ui('unpair_phone');
    h.ui('cancel_destructive');
    expect(h.view.preferredAction).toBe('unpair_phone');

    const g = await boot();
    g.startAndPair();
    g.ui('cancel'); // quiet-check screen: Cancel asks for confirmation
    expect(g.view.screen).toBe('confirm_dialog');
    g.ui('cancel_destructive');
    expect(g.view.stage).toBe('quiet_check');
    expect(g.view.preferredAction).toBe('cancel');
    const k = await boot();
    k.startAndPair();
    k.back(); // Back opened it: nothing to restore, the default focus applies
    k.back();
    expect(k.view.preferredAction).toBe('begin_quiet_check');
  });

  it('every screen with controls prefers an enabled control or none; destructive dialogs prefer Cancel', async () => {
    const h = await boot({ settings: { familyMode: true } });
    h.setupToPhrases();
    h.runPhrase({});
    h.advance(20_000);
    h.ui('continue_without_listener');
    h.ui('finish_early');
    for (const v of h.views) {
      if (v.preferredAction !== null) {
        const a = v.actions.find((x) => x.id === v.preferredAction);
        expect(a, `${v.screen}: preferred ${v.preferredAction}`).toBeTruthy();
        expect(a?.disabled).not.toBe(true);
      }
      if (v.dialog) expect(v.dialog.preferred).toBe('cancel');
    }
  });
});
