import * as React from 'react';
import { View } from 'react-native';
import { Path, Svg } from '@amazon-devices/react-native-svg';
import { bandTick, halfDial, levelArcPath, levelCue, trackArcPath } from '@atr/ten-foot-meter';
import type { MeterView } from '@atr/session-core';
import { text } from '../copy';
import { colors, layout } from '../theme';
import { AppText } from './AppText';
import { ToneGlyph } from './ToneGlyph';
import { useUiScale } from './scale';
import { useSmoothedLevel } from './useSmoothedLevel';

export interface ArcMeterProps {
  meter: MeterView;
  /** While a window is open the arc is hidden from the screen-reader tree. */
  capturing: boolean;
  /** Base radius (px at UI scale 1.0). Defaults to the full-size dial. */
  radius?: number;
}

/**
 * Relative-level arc with a band tick, a text cue and a shape cue. It is mounted ONLY when the view carries
 * a meter (`view.meter !== null`): hidden first attempts have no meter in the view, so this component is not
 * in the tree at all and has no accessible label or announcement that depends on level.
 */
export function ArcMeter({ meter, capturing, radius: baseRadius = layout.arcRadius }: ArcMeterProps): React.ReactElement {
  const ui = useUiScale();
  const smoothed = useSmoothedLevel(meter.levelRelDb);
  const radius = ui.size(baseRadius);
  const stroke = ui.size(layout.arcStroke);
  const pad = stroke;
  const width = 2 * (radius + pad);
  const height = radius + 2 * pad;
  const arc = halfDial(radius + pad, radius + pad, radius);
  const track = trackArcPath(arc);
  const fill = smoothed === null ? '' : levelArcPath(arc, smoothed);
  const tick = bandTick(arc, meter.bandRelDb, radius - stroke, radius + stroke);
  const cue = levelCue(smoothed, meter.bandRelDb, meter.active);
  const label = meter.caption + '. ' + cue.text;
  return (
    <View
      testID="arc-meter"
      accessible={!capturing}
      role="img"
      aria-label={label}
      aria-hidden={capturing}
      importantForAccessibility={capturing ? 'no-hide-descendants' : 'auto'}
      style={{ alignItems: 'center' }}
    >
      <Svg width={width} height={height}>
        <Path d={track} stroke={colors.arcTrack} strokeWidth={stroke} fill="none" />
        {fill.length > 0 ? <Path testID="arc-fill" d={fill} stroke={colors.arcFill} strokeWidth={stroke} fill="none" /> : null}
        {tick !== null ? (
          <Path testID="arc-band-tick" d={tick.d} stroke={colors.bandTick} strokeWidth={Math.max(4, Math.round(stroke / 4))} fill="none" />
        ) : null}
      </Svg>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: ui.space(8) }}>
        <ToneGlyph testID="arc-cue-glyph" shape={cue.shape} color={colors.arcFill} baseSize={48} />
        <AppText testID="arc-cue-text" kind="label" style={{ marginLeft: ui.space(16) }}>
          {cue.text}
        </AppText>
      </View>
      <AppText testID="arc-caption" kind="muted" center>
        {meter.caption}
      </AppText>
      {tick !== null ? (
        <AppText testID="arc-legend" kind="muted" center>
          {text.arcLegend + (tick.offScale === null ? '' : tick.offScale === 'above' ? ' (above the scale)' : ' (below the scale)')}
        </AppText>
      ) : null}
    </View>
  );
}
