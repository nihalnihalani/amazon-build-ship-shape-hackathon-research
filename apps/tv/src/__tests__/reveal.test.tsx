import { Path } from '@amazon-devices/react-native-svg';
import { revealBelow, revealNotScored, revealReached, vowelResult } from '../__fixtures__/views';
import { allStrings, renderView, svgElements } from './testUtils';

function glyphOf(screen: ReturnType<typeof renderView>) {
  const paths = svgElements(screen.getByTestId('result-glyph'), 'Path');
  expect(paths).toHaveLength(1);
  return paths[0]!.props as { d: string; fill: string; stroke: string };
}

describe('reveal: text label plus shape, never colour alone', () => {
  it('reached: label text and a check mark path (M L L)', () => {
    const screen = renderView(revealReached);
    expect(screen.getByTestId('result-label').props.children).toBe('Reached the far side');
    const glyph = glyphOf(screen);
    expect((glyph.d.match(/[A-Za-z]/g) ?? []).join('')).toBe('MLL');
    expect(glyph.fill).toBe('none');
  });

  it('below: label text and a ring path (M A A)', () => {
    const screen = renderView(revealBelow);
    expect(screen.getByTestId('result-label').props.children).toBe('Did not reach the far side');
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
    expect(strings).toContain('Reached the far side');
    expect(strings).toContain("Above today's band");
    expect(strings).toContain('You rated: Felt normal');
    expect(strings).toContain('Listener: Heard');
  });

  it('adds words for a borderline result', () => {
    const screen = renderView(revealBelow);
    expect(screen.getByTestId('result-borderline').props.children).toBe('Close to the band edge');
  });

  it('summarises the result in one accessible label', () => {
    const screen = renderView(revealBelow);
    const result = screen.getByTestId('result');
    const label = (result.props['aria-label'] ?? result.props.accessibilityLabel) as string;
    expect(label).toBe("Did not reach the far side. Below today's band. Close to the band edge");
  });

  it('renders nothing for a missing result and still has controls and footer', () => {
    const screen = renderView({ ...revealReached, result: null });
    expect(screen.queryByTestId('result')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(Path)).toHaveLength(0);
    expect(screen.getByTestId('footer')).toBeTruthy();
  });
});
