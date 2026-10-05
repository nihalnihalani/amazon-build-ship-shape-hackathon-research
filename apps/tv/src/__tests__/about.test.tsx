import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_VERSION } from '../config';
import { text } from '../copy';
import { about, makeView } from '../__fixtures__/views';
import { allStrings, renderView } from './testUtils';

describe('About: the privacy and storage disclosure has a single source (view.body)', () => {
  it('renders every body line verbatim', () => {
    const screen = renderView(about);
    const strings = allStrings(screen.toJSON());
    for (const line of about.body) expect(strings).toContain(line);
  });

  it('follows whatever the session core says: a changed storage line replaces it, nothing from the UI remains', () => {
    const view = makeView({ ...about, body: ['Version 9.9.9', 'A different storage sentence from the core.'] });
    const strings = allStrings(renderView(view).toJSON()).join('\n');
    expect(strings).toContain('A different storage sentence from the core.');
    expect(strings).not.toMatch(/unencrypted|stays on this TV|Delete it in Settings|never recorded or sent/i);
  });

  it('the UI copy module no longer has an About storage text', () => {
    expect('aboutStorage' in text).toBe(false);
    const source = fs.readFileSync(path.resolve(__dirname, '../copy.ts'), 'utf8');
    expect(source).not.toMatch(/aboutStorage|stored unencrypted|stays on this TV/);
    const screenSource = fs.readFileSync(path.resolve(__dirname, '../screens/AboutScreen.tsx'), 'utf8');
    expect(screenSource).not.toMatch(/unencrypted|aboutStorage/);
  });

  it('does not repeat the version when the body already has a Version line', () => {
    const screen = renderView(about);
    expect(screen.queryByTestId('about-version')).toBeNull();
    expect(allStrings(screen.toJSON()).filter((s) => s.startsWith('Version '))).toEqual(['Version 0.1.0']);
  });

  it('shows the app version when the body has none', () => {
    const screen = renderView(makeView({ ...about, body: ['Some other line.'] }));
    expect(screen.getByTestId('about-version').props.children).toBe('Version ' + APP_VERSION);
  });

  it('still shows the licence notices, as one compact paragraph', () => {
    const screen = renderView(about);
    expect(screen.getAllByTestId('about-license')).toHaveLength(1);
    expect(screen.getByTestId('about-license').props.children).toBe(text.aboutLicences);
    expect(text.aboutLicences).toContain('MIT');
    expect(text.aboutLicences).toContain('Amazon Vega SDK licence terms');
  });

  it('keeps Back as the only control, preferred', () => {
    const screen = renderView(about);
    expect(screen.getByTestId('action-back')).toBeTruthy();
  });
});
