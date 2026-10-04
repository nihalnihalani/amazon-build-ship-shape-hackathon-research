import * as React from 'react';
import { View } from 'react-native';
import { micText } from '../copy';
import { AppText } from '../ui/AppText';
import { CueChip } from '../ui/CueChip';
import { MeterBlock } from '../ui/MeterBlock';
import { PhraseCounter } from '../ui/PhraseCounter';
import { PhraseText } from '../ui/PhraseText';
import { ResultBadge } from '../ui/ResultBadge';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';
import { TimerDisplay } from '../ui/TimerDisplay';
import { useUiScale } from '../ui/scale';

/** Waiting for the phone to grant the microphone: the state is spelled out, never "off" without the phone's say-so. */
export function PermissionPendingScreen(props: ScreenProps): React.ReactElement {
  return (
    <ScreenFrame {...props}>
      <AppText testID="permission-state" kind="label" center role="summary">
        {micText(props.view.mic)}
      </AppText>
    </ScreenFrame>
  );
}

/** Quiet check: a countdown while the room floor is measured. The timer is hidden from screen readers. */
export function QuietCheckScreen(props: ScreenProps): React.ReactElement {
  const { view } = props;
  return (
    <ScreenFrame {...props}>
      {view.timer !== null ? <TimerDisplay timer={view.timer} capturing={view.capturing} /> : null}
      <MeterBlock view={view} />
    </ScreenFrame>
  );
}

/** Calibration phrase window: countdown plus the arc once the session view provides a meter. */
export function CalibrationScreen(props: ScreenProps): React.ReactElement {
  const { view } = props;
  return (
    <ScreenFrame {...props}>
      {view.timer !== null ? <TimerDisplay timer={view.timer} capturing={view.capturing} /> : null}
      <MeterBlock view={view} />
    </ScreenFrame>
  );
}

/** Sustained sound: counts up in 160 px digits; the result (after the window) is shown with text and shape. */
export function VowelScreen(props: ScreenProps): React.ReactElement {
  const { view } = props;
  return (
    <ScreenFrame {...props}>
      {view.timer !== null ? <TimerDisplay timer={view.timer} capturing={view.capturing} /> : null}
      <MeterBlock view={view} />
      {view.result !== null ? <ResultBadge result={view.result} /> : null}
    </ScreenFrame>
  );
}

/**
 * Phrase card. The phrase is 72 to 96 px and stays within two lines. The arc is mounted only when the view
 * has a meter; during a hidden first attempt the view has none, so nothing level-related is rendered.
 */
export function PhraseScreen(props: ScreenProps): React.ReactElement {
  const { view } = props;
  const ui = useUiScale();
  return (
    <ScreenFrame {...props} describedBy={['atr-phrase-text']}>
      {view.phrase !== null ? (
        <View style={{ alignItems: 'center', marginBottom: ui.space(24) }}>
          <PhraseCounter phrase={view.phrase} />
          <PhraseText phrase={view.phrase.text} />
        </View>
      ) : null}
      <MeterBlock view={view} />
      {view.timer !== null ? <TimerDisplay timer={view.timer} capturing={view.capturing} /> : null}
      {view.cue !== null ? <CueChip cue={view.cue} /> : null}
      {view.result !== null ? <ResultBadge result={view.result} /> : null}
    </ScreenFrame>
  );
}

/** After the window: the speaker's rating (left and right), or waiting for the listener. No level is shown. */
export function ResponseScreen(props: ScreenProps): React.ReactElement {
  const { view } = props;
  const ui = useUiScale();
  return (
    <ScreenFrame {...props} describedBy={['atr-phrase-text']}>
      {view.phrase !== null ? (
        <View style={{ alignItems: 'center', marginBottom: ui.space(16) }}>
          <PhraseCounter phrase={view.phrase} />
          <AppText testID="response-phrase" nativeID="atr-phrase-text" kind="label" center>
            {view.phrase.text}
          </AppText>
        </View>
      ) : null}
      {view.cue !== null ? <CueChip cue={view.cue} /> : null}
    </ScreenFrame>
  );
}

/** Reveal: result label, shape icon and detail. Colour is never the only carrier of the result. */
export function RevealScreen(props: ScreenProps): React.ReactElement {
  const { view } = props;
  const ui = useUiScale();
  return (
    <ScreenFrame {...props} describedBy={['atr-result']}>
      {view.phrase !== null ? (
        <View style={{ alignItems: 'center', marginBottom: ui.space(24) }}>
          <PhraseCounter phrase={view.phrase} />
          <AppText testID="reveal-phrase" kind="label" center>
            {view.phrase.text}
          </AppText>
        </View>
      ) : null}
      {view.result !== null ? <ResultBadge result={view.result} /> : null}
    </ScreenFrame>
  );
}
