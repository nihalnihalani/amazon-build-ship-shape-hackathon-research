import { summary, summaryData, summaryIncomplete } from '../__fixtures__/views';
import { summaryLines } from '../screens/SummaryScreen';
import { renderView } from './testUtils';

describe('summary: all counts with denominators', () => {
  const lines = summaryLines(summaryData);

  it('shows completion, skipped and unscored counts with reasons', () => {
    expect(lines).toContain('Session complete');
    expect(lines).toContain('Phrases completed: 8 of 10 attempted');
    expect(lines).toContain('Phrases skipped: 2');
    expect(lines).toContain('Attempts not scored: 3');
    expect(lines).toContain('  clipped: 1');
    expect(lines).toContain('  room too noisy: 2');
  });

  it('shows reached counts for blind and other positions with their denominators', () => {
    expect(lines).toContain('Reached the far side, blind checks: 1 of 3');
    expect(lines).toContain('Reached the far side, other phrases: 5 of 7');
  });

  it('shows the longest steady sound, ratings and late responses', () => {
    expect(lines).toContain('Longest steady sound: 14.2 s');
    expect(lines).toContain('Blind check ratings (3): felt loud 1, felt normal 1, skipped 1');
    expect(lines).toContain('Late listener responses (not counted in agreement): 1');
    expect(lines).toContain('Borderline results: 2');
  });

  it('shows agreement as agree of eligible, and words when nothing is eligible (never 0 of 0)', () => {
    expect(lines).toContain('Meter and listener, blind checks: agreed on 2 of 3');
    expect(lines).toContain('Meter and listener, other phrases: No eligible listener responses');
    expect(lines.join('\n')).not.toMatch(/0 of 0/);
  });

  it('states the margin as relative, not sound level', () => {
    expect(lines).toContain('Band margin today: 9 dB above room noise (relative, not sound level)');
    expect(summaryLines({ ...summaryData, calibrationMarginDb: null }).join('\n')).not.toContain('Band margin');
  });

  it('says "none recorded" when there is no longest value', () => {
    expect(summaryLines({ ...summaryData, longestActiveMs: null })).toContain('Longest steady sound: none recorded');
  });

  it('labels an incomplete session and does not compare it', () => {
    expect(summaryLines(summaryIncomplete.summary!)[0]).toBe('Incomplete session. It is not compared with completed sessions.');
  });
});

describe('summary screen', () => {
  it('renders every line, the position rule and the core notes', () => {
    const screen = renderView(summary);
    const rendered = screen.getAllByTestId('summary-line').map((node) => node.props.children as string);
    expect(rendered.sort()).toEqual([...summaryLines(summaryData)].sort());
    expect(screen.getByTestId('summary-rule').props.children).toContain('first valid attempt');
    expect(screen.getByTestId('summary-notes')).toBeTruthy();
  });

  it('renders without a summary object', () => {
    const screen = renderView({ ...summary, summary: null });
    expect(screen.queryByTestId('summary')).toBeNull();
    expect(screen.getByTestId('footer')).toBeTruthy();
  });
});
