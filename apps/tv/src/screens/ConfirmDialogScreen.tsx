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
      {/*
        A11Y-02: the dialog is named by its own title (aria-label and aria-labelledby), the title is rendered once (the
        screen frame's title is hidden), and both controls are described by the body text. `accessible` stays false
        so the buttons inside remain separate focus targets.
      */}
      <View
        testID="dialog"
        accessible={false}
        role="alertdialog"
        aria-label={dialog.title}
        aria-labelledby="atr-dialog-title"
        style={{ alignItems: 'center', maxWidth: ui.size(1400) }}
      >
        <AppText testID="dialog-title" nativeID="atr-dialog-title" kind="title" role="heading" center>
          {dialog.title}
        </AppText>
        <AppText testID="dialog-body" nativeID="atr-dialog-body" kind="label" center style={{ marginTop: ui.space(24), marginBottom: ui.space(40) }}>
          {dialog.body}
        </AppText>
        <View style={{ flexDirection: 'row' }}>
          <Focusable action={dialog.cancel} preferred={side === 'cancel'} onPress={onAction} describedBy={['atr-dialog-body']} />
          <Focusable action={dialog.confirm} preferred={side === 'confirm'} onPress={onAction} describedBy={['atr-dialog-body']} />
        </View>
      </View>
    </TVFocusGuideView>
  );
}

export function ConfirmDialogScreen(props: ScreenProps): React.ReactElement {
  const { view, onAction } = props;
  return (
    <ScreenFrame {...props} hideActions hideStatus hideTitle hideBody>
      {view.dialog !== null ? <ConfirmDialogContent dialog={view.dialog} onAction={onAction} /> : null}
    </ScreenFrame>
  );
}
