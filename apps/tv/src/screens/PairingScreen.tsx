import * as React from 'react';
import { View } from 'react-native';
import { text } from '../copy';
import { colors } from '../theme';
import { AppText } from '../ui/AppText';
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
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

/** Join confirmation: the phone's label and the digits the user compares with the phone before accepting. */
export function JoinConfirmScreen(props: ScreenProps): React.ReactElement {
  const ui = useUiScale();
  const join = props.view.pairing?.joinRequest ?? null;
  return (
    <ScreenFrame {...props} describedBy={['atr-join-device', 'atr-join-digits']}>
      {join !== null ? (
        <View style={{ alignItems: 'center' }}>
          <AppText testID="join-device" nativeID="atr-join-device" kind="title" accessible aria-label={text.joinDevice + ' ' + join.deviceLabel}>
            {text.joinDevice + ': ' + join.deviceLabel}
          </AppText>
          <AppText kind="muted" style={{ marginTop: ui.space(24) }}>
            {text.joinConfirmDigits}
          </AppText>
          <AppText
            testID="join-digits"
            nativeID="atr-join-digits"
            kind="counter"
            accessible
            aria-label={text.joinConfirmDigits + ' ' + join.confirmDigits.split('').join(' ')}
            style={{ letterSpacing: ui.size(12) }}
          >
            {join.confirmDigits}
          </AppText>
        </View>
      ) : null}
    </ScreenFrame>
  );
}
