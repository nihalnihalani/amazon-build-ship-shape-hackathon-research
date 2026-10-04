// AsyncStorage for the web preview, backed by localStorage when available and memory otherwise.
const memory = new Map<string, string>();

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    const s = store();
    return s !== null ? s.getItem(key) : (memory.get(key) ?? null);
  },
  async setItem(key: string, value: string): Promise<void> {
    const s = store();
    if (s !== null) s.setItem(key, value);
    else memory.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    const s = store();
    if (s !== null) s.removeItem(key);
    else memory.delete(key);
  },
  async getAllKeys(): Promise<readonly string[]> {
    const s = store();
    if (s === null) return Array.from(memory.keys());
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key !== null) keys.push(key);
    }
    return keys;
  },
  async multiRemove(keys: readonly string[]): Promise<void> {
    for (const key of keys) await AsyncStorage.removeItem(key);
  },
};

export default AsyncStorage;
