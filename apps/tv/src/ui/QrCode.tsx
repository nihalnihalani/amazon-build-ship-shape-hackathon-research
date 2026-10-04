import * as React from 'react';
import { useMemo } from 'react';
import { View } from 'react-native';
import { Rect, Svg } from '@amazon-devices/react-native-svg';
import qrcode from 'qrcode-generator';
import { matrixRuns } from '@atr/ten-foot-meter';
import { text } from '../copy';
import { colors, layout } from '../theme';
import { AppText } from './AppText';
import { useUiScale } from './scale';

/** Dark/light module matrix for a payload (error correction M), or null if it cannot be encoded. */
export function buildQrMatrix(payload: string): boolean[][] | null {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    const count = qr.getModuleCount();
    const matrix: boolean[][] = [];
    for (let row = 0; row < count; row++) {
      const cells: boolean[] = [];
      for (let col = 0; col < count; col++) cells.push(qr.isDark(row, col));
      matrix.push(cells);
    }
    return matrix;
  } catch {
    return null;
  }
}

const QUIET_ZONE_MODULES = 4;

/**
 * Pairing QR drawn with SVG Rect elements (dark runs merged per row), black on a white square with a 4 module
 * quiet zone. The payload is a join URL; it contains no credentials.
 */
export function QrCode({ payload }: { payload: string }): React.ReactElement {
  const ui = useUiScale();
  const matrix = useMemo(() => buildQrMatrix(payload), [payload]);
  if (matrix === null) {
    return (
      <AppText testID="qr-unavailable" kind="body">
        {text.pairingQrUnavailable}
      </AppText>
    );
  }
  const modules = matrix.length + 2 * QUIET_ZONE_MODULES;
  const cell = Math.max(2, Math.floor(ui.size(layout.qrSize) / modules));
  const side = cell * modules;
  const runs = matrixRuns(matrix);
  return (
    <View testID="qr-code" accessible role="img" aria-label={text.pairingQrLabel}>
      <Svg width={side} height={side}>
        <Rect x={0} y={0} width={side} height={side} fill={colors.qrLight} />
        {runs.map((run) => (
          <Rect
            key={run.y + ':' + run.x}
            x={(run.x + QUIET_ZONE_MODULES) * cell}
            y={(run.y + QUIET_ZONE_MODULES) * cell}
            width={run.w * cell}
            height={cell}
            fill={colors.qrDark}
          />
        ))}
      </Svg>
    </View>
  );
}
