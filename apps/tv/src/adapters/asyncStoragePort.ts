import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StoragePort } from '@atr/session-core';

/**
 * StoragePort over Vega AsyncStorage (the @amazon-devices package aliased to the usual name, ADR-0005).
 * A thin pass-through: key namespacing (`atr:v1:`), migration and "delete only atr: keys" are the session
 * store's job. Rejections are propagated unchanged so the store can decide how to degrade. AsyncStorage on
 * Vega is unencrypted; this is disclosed in Settings > About.
 */
export function createAsyncStoragePort(): StoragePort {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
    getAllKeys: async () => {
      const keys = await AsyncStorage.getAllKeys();
      return Array.from(keys);
    },
    multiRemove: (keys) => AsyncStorage.multiRemove(keys),
  };
}
