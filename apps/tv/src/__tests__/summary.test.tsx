import { summary, summaryData, summaryIncomplete } from '../__fixtures__/views';
import { summaryLines } from '../screens/SummaryScreen';
import { renderView } from './testUtils';

describe('summary: all counts with denominators', () => {
  const lines = summaryLines(summaryData);

  it('shows completion, skipped and unscored counts with reasons on compact lines', () => {
    expect(lines).toContain('Session complete');
    expect(lines).toContain('Phrases completed: 8 of 10 attempted, 2 skipped');
    expect(lines).toContain('Attempts not scored: 3 (clipped 1, room too noisy 2)');
  });

  it('omits the reason list when nothing was unscored', () => {
    expect(summaryLines({ ...summaryData, attemptsInvalid: 0, invalidReasons: {} })).toContain('Attempts not scored: 0');
  });

  it("uses the ADR-0001 wording for reached counts: today's relative level band, with denominators", () => {
    expect(lines).toContain("Reached today's relative level band, blind checks: 1 of 3");
    expect(lines).toContain("Reached today's relative level band, other phrases: 5 of 7");
    expect(lines.join('\n')).not.toMatch(/far side|loud enough|heard/i);
  });

  it('shows the longest steady sound, ratings, late responses and borderline results', () => {
    expect(lines).toContain('Longest steady sound: 14.2 s');
    expect(lines).toContain('Blind check ratings (3): felt loud 1, felt normal 1, skipped 1');
    expect(lines).toContain('Late listener responses (not counted in agreement): 1. Borderline results: 2');
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

  it('keeps the summary short enough for one screen at UI scales up to 1.25: at most 11 statistic lines', () => {
    expect(lines.length).toBeLessThanOrEqual(11);
  });
});

describe('summary screen', () => {
  it('renders every statistic line and the notes the core provides', () => {
    const screen = renderView(summary);
    const rendered = screen.getAllByTestId('summary-line').map((node) => node.props.children as string);
    expect(rendered).toEqual(summaryLines(summaryData));
    expect(screen.getByTestId('summary-notes')).toBeTruthy();
    expect(summaryData.lines.length).toBeGreaterThan(0);
  });

  it('renders without a summary object', () => {
    const screen = renderView({ ...summary, summary: null });
    expect(screen.queryByTestId('summary')).toBeNull();
    expect(screen.getByTestId('footer')).toBeTruthy();
  });
});
