import { Path } from '@amazon-devices/react-native-svg';
import { revealBelow, revealNotScored, revealReached, revealUnqualified, vowelResult } from '../__fixtures__/views';
import { allStrings, renderView, svgElements } from './testUtils';

function glyphOf(screen: ReturnType<typeof renderView>) {
  const paths = svgElements(screen.getByTestId('result-glyph'), 'Path');
  expect(paths).toHaveLength(1);
  return paths[0]!.props as { d: string; fill: string; stroke: string };
}

describe('reveal: text label plus shape, never colour alone', () => {
  it('reached: label text and a check mark path (M L L)', () => {
    const screen = renderView(revealReached);
    expect(screen.getByTestId('result-label').props.children).toBe("Reached today's relative level band");
    const glyph = glyphOf(screen);
    expect((glyph.d.match(/[A-Za-z]/g) ?? []).join('')).toBe('MLL');
    expect(glyph.fill).toBe('none');
  });

  it('below: label text and a ring path (M A A)', () => {
    const screen = renderView(revealBelow);
    expect(screen.getByTestId('result-label').props.children).toBe("Below today's relative level band");
    expect((glyphOf(screen).d.match(/[A-Za-z]/g) ?? []).join('')).toBe('MAA');
  });

  it('not scored: label text and a dash path (M L)', () => {
    const screen = renderView(revealNotScored);
    expect(screen.getByTestId('result-label').props.children).toBe('Not scored');
    expect((glyphOf(screen).d.match(/[A-Za-z]/g) ?? []).join('')).toBe('ML');
  });

  it('neutral: label text and a filled dot', () => {
    const screen = renderView(vowelResult);
    expect(screen.getByTestId('result-label').props.children).toContain('Longest steady sound');
    const glyph = glyphOf(screen);
    expect(glyph.fill).not.toBe('none');
  });

  it('uses four different shapes for the four tones', () => {
    const shapes = [revealReached, revealBelow, revealNotScored, vowelResult].map((view) => glyphOf(renderView(view)).d);
    expect(new Set(shapes).size).toBe(4);
  });

  it('keeps the meaning when colours are ignored: label, detail, rating and listener are plain text', () => {
    const screen = renderView(revealReached);
    const strings = allStrings(screen.toJSON());
    expect(strings).toContain("Reached today's relative level band");
    expect(strings).toContain('You felt: normal');
    expect(strings).toContain('Listener: heard');
    // The store's sentences are rendered verbatim: the UI adds no prefix of its own.
    expect(strings.join(' ')).not.toMatch(/You rated|Listener: Listener|You felt: You felt/);
  });

  it('renders the "(unqualified phone)" suffix exactly as the store puts it in the label (the UI only renders it)', () => {
    const screen = renderView(revealUnqualified);
    expect(screen.getByTestId('result-label').props.children).toBe("Reached today's relative level band (unqualified phone)");
    const result = screen.getByTestId('result');
    expect(result.props.accessibilityLabel ?? result.props['aria-label']).toBe("Reached today's relative level band (unqualified phone)");
    // The UI adds nothing of its own to the label.
    expect(allStrings(screen.toJSON()).filter((s) => s.includes('unqualified'))).toHaveLength(2);
  });

  it('does not add the suffix when the store did not', () => {
    expect(allStrings(renderView(revealReached).toJSON()).join(' ')).not.toContain('unqualified');
  });

  it('shows the borderline note once, exactly as the store wrote it in the detail', () => {
    const screen = renderView(revealBelow);
    const note = "Borderline: within 1 dB of today's band edge. The result is kept.";
    expect(screen.getByTestId('result-detail').props.children).toBe(note);
    expect(allStrings(screen.toJSON()).filter((s) => s === note)).toHaveLength(1);
    expect(screen.queryByTestId('result-borderline')).toBeNull();
  });

  it('summarises the result in one accessible label', () => {
    const screen = renderView(revealBelow);
    const result = screen.getByTestId('result');
    const label = (result.props['aria-label'] ?? result.props.accessibilityLabel) as string;
    expect(label).toBe("Below today's relative level band. Borderline: within 1 dB of today's band edge. The result is kept.. Listener: not heard");
  });

  it('renders nothing for a missing result and still has controls and footer', () => {
    const screen = renderView({ ...revealReached, result: null });
    expect(screen.queryByTestId('result')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(Path)).toHaveLength(0);
    expect(screen.getByTestId('footer')).toBeTruthy();
  });
});
