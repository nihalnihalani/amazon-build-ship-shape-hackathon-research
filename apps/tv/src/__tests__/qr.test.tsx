import { render } from '@testing-library/react-native';
import { matrixRuns } from '@atr/ten-foot-meter';
import { QrCode, buildQrMatrix } from '../ui/QrCode';
import { svgElements } from './testUtils';

const PAYLOAD = 'https://relay.example.test/join?c=ACDEFH';

describe('QR matrix', () => {
  const matrix = buildQrMatrix(PAYLOAD);

  it('is a square with a valid QR size (21 + 4 * (version - 1))', () => {
    expect(matrix).not.toBeNull();
    const size = matrix?.length ?? 0;
    expect((size - 21) % 4).toBe(0);
    expect(size).toBeGreaterThanOrEqual(21);
    for (const row of matrix ?? []) expect(row).toHaveLength(size);
  });

  it('has the three finder patterns (7x7: solid ring, white ring, 3x3 core) in the corners', () => {
    const m = matrix as boolean[][];
    const n = m.length;
    const finder = (top: number, left: number): string[] =>
      Array.from({ length: 7 }, (_, r) => Array.from({ length: 7 }, (_, c) => (m[top + r]?.[left + c] ? '1' : '0')).join(''));
    const expected = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
    expect(finder(0, 0)).toEqual(expected);
    expect(finder(0, n - 7)).toEqual(expected);
    expect(finder(n - 7, 0)).toEqual(expected);
  });

  it('has the alternating timing pattern on row 6 between the finders', () => {
    const m = matrix as boolean[][];
    for (let c = 8; c < m.length - 8; c++) expect(m[6]?.[c]).toBe(c % 2 === 0);
  });

  it('is deterministic and different for a different payload', () => {
    expect(buildQrMatrix(PAYLOAD)).toEqual(matrix);
    expect(buildQrMatrix(PAYLOAD + 'x')).not.toEqual(matrix);
  });

  it('returns null for a payload that cannot be encoded', () => {
    expect(buildQrMatrix('x'.repeat(5000))).toBeNull();
  });
});

describe('QrCode component', () => {
  it('draws a white square plus dark Rect runs that reproduce the matrix exactly', () => {
    const screen = render(<QrCode payload={PAYLOAD} />);
    const rects = svgElements(screen.UNSAFE_root, 'Rect');
    const background = rects[0]?.props as { width: number; height: number; fill: string };
    expect(background.fill).toBe('#FFFFFF');
    expect(background.width).toBe(background.height);
    const matrix = buildQrMatrix(PAYLOAD) as boolean[][];
    const quiet = 4;
    const cell = background.width / (matrix.length + 2 * quiet);
    expect(Number.isInteger(cell)).toBe(true);
    const rebuilt = matrix.map((row) => row.map(() => false));
    for (const rect of rects.slice(1)) {
      const p = rect.props as { x: number; y: number; width: number; height: number; fill: string };
      expect(p.fill).toBe('#000000');
      expect(p.height).toBe(cell);
      const row = p.y / cell - quiet;
      const col = p.x / cell - quiet;
      for (let i = 0; i < p.width / cell; i++) {
        const target = rebuilt[row];
        expect(target).toBeDefined();
        if (target) target[col + i] = true;
      }
    }
    expect(rebuilt).toEqual(matrix);
    expect(rects.length - 1).toBe(matrixRuns(matrix).length);
  });

  it('is exposed as one labelled image', () => {
    const screen = render(<QrCode payload={PAYLOAD} />);
    const qr = screen.getByTestId('qr-code');
    expect(qr.props.role).toBe('img');
    expect(qr.props.accessibilityLabel ?? qr.props['aria-label']).toContain('pairing');
  });

  it('falls back to words when the payload cannot be encoded', () => {
    const screen = render(<QrCode payload={'x'.repeat(5000)} />);
    expect(screen.getByTestId('qr-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('qr-code')).toBeNull();
  });
});
