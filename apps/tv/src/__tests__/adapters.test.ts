import { resetAsyncStorageMock } from '../../jest/mocks/async-storage';
import { createAsyncStoragePort } from '../adapters/asyncStoragePort';
import { createClock, localDateString } from '../adapters/clock';

describe('asyncStoragePort', () => {
  beforeEach(() => resetAsyncStorageMock());

  it('round-trips values and reports missing keys as null', async () => {
    const port = createAsyncStoragePort();
    expect(await port.getItem('atr:v1:meta')).toBeNull();
    await port.setItem('atr:v1:meta', '{"schema_version":1}');
    expect(await port.getItem('atr:v1:meta')).toBe('{"schema_version":1}');
    await port.removeItem('atr:v1:meta');
    expect(await port.getItem('atr:v1:meta')).toBeNull();
  });

  it('lists all keys as a plain array', async () => {
    const port = createAsyncStoragePort();
    await port.setItem('atr:v1:a', '1');
    await port.setItem('other:b', '2');
    const keys = await port.getAllKeys();
    expect(Array.isArray(keys)).toBe(true);
    expect([...keys].sort()).toEqual(['atr:v1:a', 'other:b']);
  });

  it('multiRemove removes only the keys it is given (never a blanket clear)', async () => {
    const port = createAsyncStoragePort();
    await port.setItem('atr:v1:a', '1');
    await port.setItem('atr:v1:b', '2');
    await port.setItem('other:c', '3');
    await port.multiRemove(['atr:v1:a', 'atr:v1:b']);
    expect([...(await port.getAllKeys())]).toEqual(['other:c']);
  });
});

describe('clock', () => {
  it('formats the local calendar date as YYYY-MM-DD (time zone independent: built from local parts)', () => {
    expect(localDateString(new Date(2026, 9, 5, 23, 59, 59).getTime())).toBe('2026-10-05');
    expect(localDateString(new Date(2026, 9, 6, 0, 0, 0).getTime())).toBe('2026-10-06');
    expect(localDateString(new Date(2026, 0, 1, 12, 0, 0).getTime())).toBe('2026-01-01');
    expect(localDateString(new Date(2026, 11, 31, 0, 0, 1).getTime())).toBe('2026-12-31');
    expect(localDateString(new Date(2028, 1, 29, 8, 0, 0).getTime())).toBe('2028-02-29');
  });

  it('exposes now() and localDate()', () => {
    const clock = createClock();
    expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1000);
    expect(clock.localDate(new Date(2026, 9, 5, 12).getTime())).toBe('2026-10-05');
  });
});
