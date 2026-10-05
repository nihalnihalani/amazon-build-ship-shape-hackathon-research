import * as React from 'react';
import { useRef } from 'react';
import { View } from 'react-native';
import type { ActionId, ViewAction } from '@atr/session-core';
import { Focusable } from './Focusable';
import { resolvePreferredAction } from './focusModel';

export interface ActionRowProps {
  actions: readonly ViewAction[];
  preferredAction: ActionId | null;
  onAction: (id: ActionId) => void;
  direction?: 'row' | 'column';
  describedBy?: string[];
  /** While a window is open the preferred focus is frozen: no focus moves mid-capture (A8-01). */
  capturing?: boolean;
}

/**
 * Preferred focus for this render. While capturing, a previously chosen preferred control that is still present
 * and enabled keeps the focus request, so a late change of `preferredAction` cannot move focus during a window.
 */
export function useFrozenPreferred(actions: readonly ViewAction[], preferredAction: ActionId | null, capturing: boolean): ActionId | null {
  const resolved = resolvePreferredAction(actions, preferredAction);
  const kept = useRef<ActionId | null>(null);
  if (capturing && kept.current !== null && actions.some((a) => a.id === kept.current && a.disabled !== true)) {
    return kept.current;
  }
  kept.current = resolved;
  return resolved;
}

/** The screen's controls in view order, with exactly one of them holding the preferred focus. */
export function ActionRow({
  actions,
  preferredAction,
  onAction,
  direction = 'row',
  describedBy,
  capturing = false,
}: ActionRowProps): React.ReactElement | null {
  const preferred = useFrozenPreferred(actions, preferredAction, capturing);
  if (actions.length === 0) return null;
  return (
    <View
      testID="actions"
      style={{ flexDirection: direction, flexWrap: direction === 'row' ? 'wrap' : 'nowrap', alignItems: direction === 'row' ? 'center' : 'flex-start' }}
    >
      {actions.map((action) => (
        <Focusable key={action.id} action={action} preferred={action.id === preferred} onPress={onAction} describedBy={describedBy} />
      ))}
    </View>
  );
}
