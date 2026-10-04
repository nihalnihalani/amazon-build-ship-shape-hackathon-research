import * as React from 'react';
import { View } from 'react-native';
import { TVFocusGuideView } from '@amazon-devices/react-native-kepler';
import type { DialogView } from '@atr/session-core';
import { AppText } from '../ui/AppText';
import { Focusable } from '../ui/Focusable';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';
import { dialogPreferredSide } from '../ui/focusModel';
import { useUiScale } from '../ui/scale';

/**
 * Confirmation dialog. Focus is trapped inside it (TVFocusGuideView autoFocus + trapFocus in all four
 * directions) and exactly one control is preferred: Cancel for any destructive dialog, whatever the view
 * says. Cancel is laid out first so the focus guide's "first focusable child" is also Cancel.
 */
export function ConfirmDialogContent({ dialog, onAction }: { dialog: DialogView; onAction: ScreenProps['onAction'] }): React.ReactElement {
  const ui = useUiScale();
  const side = dialogPreferredSide(dialog);
  return (
    <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight testID="dialog-focus-guide">
      <View testID="dialog" accessible={false} role="alertdialog" style={{ alignItems: 'center', maxWidth: ui.size(1400) }}>
        <AppText testID="dialog-title" kind="title" role="heading" center>
          {dialog.title}
        </AppText>
        <AppText testID="dialog-body" kind="label" center style={{ marginTop: ui.space(24), marginBottom: ui.space(40) }}>
          {dialog.body}
        </AppText>
        <View style={{ flexDirection: 'row' }}>
          <Focusable action={dialog.cancel} preferred={side === 'cancel'} onPress={onAction} />
          <Focusable action={dialog.confirm} preferred={side === 'confirm'} onPress={onAction} />
        </View>
      </View>
    </TVFocusGuideView>
  );
}

export function ConfirmDialogScreen(props: ScreenProps): React.ReactElement {
  const { view, onAction } = props;
  return (
    <ScreenFrame {...props} hideActions hideStatus>
      {view.dialog !== null ? <ConfirmDialogContent dialog={view.dialog} onAction={onAction} /> : null}
    </ScreenFrame>
  );
}
