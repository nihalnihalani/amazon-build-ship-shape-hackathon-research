import * as React from 'react';
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
}

/** The screen's controls in view order, with exactly one of them holding the preferred focus. */
export function ActionRow({ actions, preferredAction, onAction, direction = 'row', describedBy }: ActionRowProps): React.ReactElement | null {
  if (actions.length === 0) return null;
  const preferred = resolvePreferredAction(actions, preferredAction);
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
