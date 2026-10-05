import * as React from 'react';
import { View } from 'react-native';
import type { ViewAction } from '@atr/session-core';
import { text } from '../copy';
import { colors } from '../theme';
import { AppText } from '../ui/AppText';
import { Focusable } from '../ui/Focusable';
import { QrCode } from '../ui/QrCode';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';
import { useUiScale } from '../ui/scale';
import { useNow } from '../ui/useNow';

/** M:SS from a millisecond duration (non-negative). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
}

function CodeExpiry({ expiresAt }: { expiresAt: number }): React.ReactElement {
  const now = useNow(1000);
  const remaining = expiresAt - now;
  return (
    <AppText testID="pairing-expiry" kind="muted" center>
      {remaining > 0 ? text.pairingExpiresIn + ' ' + formatCountdown(remaining) : text.pairingExpired}
    </AppText>
  );
}

/** Pairing: the 160 px room code, the QR beside it, and the code's lifetime. Only Cancel / Refresh are focusable. */
export function PairingScreen(props: ScreenProps): React.ReactElement {
  const ui = useUiScale();
  const pairing = props.view.pairing;
  const code = pairing?.code ?? null;
  return (
    <ScreenFrame {...props} describedBy={['atr-pair-code']}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', maxWidth: '100%' }}>
        <View style={{ alignItems: 'center', marginRight: ui.space(80) }}>
          <AppText kind="muted">{text.pairingCodeLabel}</AppText>
          {code !== null ? (
            <AppText
              testID="pairing-code"
              nativeID="atr-pair-code"
              kind="counter"
              accessible
              aria-label={text.pairingCodeLabel + ' ' + code.split('').join(' ')}
              style={{ letterSpacing: ui.size(8) }}
            >
              {code}
            </AppText>
          ) : (
            <AppText testID="pairing-code-pending" kind="label" color={colors.neutral}>
              {text.pairingGettingCode}
            </AppText>
          )}
        </View>
        {pairing?.qrPayload !== null && pairing?.qrPayload !== undefined ? <QrCode payload={pairing.qrPayload} /> : null}
      </View>
      {pairing?.codeExpiresAt !== null && pairing?.codeExpiresAt !== undefined ? <CodeExpiry expiresAt={pairing.codeExpiresAt} /> : null}
    </ScreenFrame>
  );
}

const PICK_ACTIONS = ['pick_choice_1', 'pick_choice_2', 'pick_choice_3'] as const;

/**
 * Number-matching join confirmation (A3-06). The phone shows one two-digit number; the TV shows three choices
 * in the order the view gives them and the user picks the one on the phone. The view does not say which choice
 * is correct, and every choice has the identical style, so nothing on screen can reveal or hint at the answer.
 * Reject is the preferred focus. The name the phone gave is untrusted text from the joining client and is shown
 * as a literal string after a fixed prefix (React Native text has no markup, links or selection).
 *
 * The heading is owned by the UI (not view.title) and view.body is not rendered: the wording of this prompt is
 * a security control and must not depend on another module's copy.
 */
export function JoinConfirmScreen(props: ScreenProps): React.ReactElement {
  const { view, onAction } = props;
  const ui = useUiScale();
  const join = view.pairing?.joinRequest ?? null;
  const reject: ViewAction = view.actions.find((a) => a.id === 'reject_join') ?? { id: 'reject_join', label: text.joinRejectLabel };
  const describedBy = ['atr-join-device'];
  return (
    <ScreenFrame {...props} titleOverride={text.joinHeading} hideBody hideActions={join !== null}>
      {join !== null ? (
        <View testID="join" style={{ alignItems: 'center' }}>
          <AppText testID="join-device" nativeID="atr-join-device" kind="label" numberOfLines={2} center>
            {text.joinNamePrefix + ' ' + join.deviceLabel}
          </AppText>
          <View testID="join-choices" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: ui.space(40), maxWidth: '100%' }}>
            {join.choices.map((choice, index) => {
              const id = PICK_ACTIONS[index] as (typeof PICK_ACTIONS)[number];
              const fromView = view.actions.find((a) => a.id === id);
              const action: ViewAction = {
                id,
                label: fromView?.label ?? text.joinNumberLabel + ' ' + choice,
                ...(fromView?.hint === undefined ? {} : { hint: fromView.hint }),
                ...(fromView?.disabled === true ? { disabled: true } : {}),
              };
              return (
                <Focusable
                  key={id}
                  action={action}
                  text={choice}
                  large
                  preferred={false}
                  onPress={onAction}
                  describedBy={describedBy}
                />
              );
            })}
          </View>
          <Focusable action={reject} preferred onPress={onAction} describedBy={describedBy} />
        </View>
      ) : null}
    </ScreenFrame>
  );
}
