// Jest stand-in for the aliased Vega AsyncStorage package: in-memory, promise based.
const memory = new Map<string, string>();

export function resetAsyncStorageMock(): void {
  memory.clear();
}

const AsyncStorage = {
  getItem: async (key: string): Promise<string | null> => (memory.has(key) ? (memory.get(key) as string) : null),
  setItem: async (key: string, value: string): Promise<void> => {
    memory.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    memory.delete(key);
  },
  getAllKeys: async (): Promise<readonly string[]> => Array.from(memory.keys()),
  multiRemove: async (keys: readonly string[]): Promise<void> => {
    for (const key of keys) memory.delete(key);
  },
  clear: async (): Promise<void> => {
    memory.clear();
  },
};

export default AsyncStorage;
