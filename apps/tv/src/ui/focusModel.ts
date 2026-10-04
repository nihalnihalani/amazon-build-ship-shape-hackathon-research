import type { ActionId, DialogView, ViewAction } from '@atr/session-core';

/**
 * Exactly one preferred focus per screen. The session view names it (`preferredAction`); if it is missing
 * or points at an unavailable action, the first enabled action takes it so a screen with controls always
 * has focus somewhere. No enabled actions means no preferred focus.
 */
export function resolvePreferredAction(actions: readonly ViewAction[], preferred: ActionId | null): ActionId | null {
  const enabled = actions.filter((action) => action.disabled !== true);
  const first = enabled[0];
  if (first === undefined) return null;
  const match = enabled.find((action) => action.id === preferred);
  return (match ?? first).id;
}

/** Destructive dialogs always start on Cancel, whatever the view says (ADR-0005). */
export function dialogPreferredSide(dialog: DialogView): 'cancel' | 'confirm' {
  if (dialog.confirm.destructive === true) return 'cancel';
  return dialog.preferred;
}
