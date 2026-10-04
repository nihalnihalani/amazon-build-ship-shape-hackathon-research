import type { StoragePort } from './contract.js';

/** In-memory StoragePort used by fixture mode (never touches real history) and by tests. */
export function createMemoryStorage(initial?: Record<string, string>): StoragePort & { dump(): Record<string, string> } {
  const map = new Map<string, string>(initial ? Object.entries(initial) : []);
  return {
    getItem: (key) => Promise.resolve(map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
    getAllKeys: () => Promise.resolve([...map.keys()]),
    multiRemove: (keys) => {
      for (const key of keys) map.delete(key);
      return Promise.resolve();
    },
    dump: () => Object.fromEntries(map),
  };
}
