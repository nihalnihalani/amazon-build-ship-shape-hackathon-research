// Jest stand-in for @amazon-devices/kepler-a11y-settings-interface-turbo (UI scale hooks).
import * as React from 'react';

let scale = 1;
let loading = false;

// Controllable stand-in for KeplerA11ySettingsInterface (screen reader state only; the app uses nothing else).
const reader = {
  enabled: false,
  registerResult: true,
  listener: null as ((enabled: boolean) => void) | null,
  calls: [] as string[],
};

export function setScreenReaderMock(enabled: boolean, options: { notify?: boolean } = {}): void {
  reader.enabled = enabled;
  if (options.notify !== false) reader.listener?.(enabled);
}
export function setScreenReaderListenerRegistrationMock(result: boolean): void {
  reader.registerResult = result;
}
export function screenReaderMockCalls(): string[] {
  return reader.calls;
}
export function screenReaderListenerActive(): boolean {
  return reader.listener !== null;
}

export const KeplerA11ySettingsInterface = {
  isScreenReaderEnabled: async (): Promise<boolean> => {
    reader.calls.push('isScreenReaderEnabled');
    return reader.enabled;
  },
  addScreenReaderStateListener: async (handler: (enabled: boolean) => void): Promise<boolean> => {
    reader.calls.push('addScreenReaderStateListener');
    if (!reader.registerResult) return false;
    reader.listener = handler;
    return true;
  },
  removeScreenReaderStateListener: async (): Promise<void> => {
    reader.calls.push('removeScreenReaderStateListener');
    reader.listener = null;
  },
};

export function setUiScaleMock(next: number): void {
  scale = next;
}
export function setUiScaleLoadingMock(next: boolean): void {
  loading = next;
}
export function resetUiScaleMock(): void {
  scale = 1;
  loading = false;
  reader.enabled = false;
  reader.registerResult = true;
  reader.listener = null;
  reader.calls = [];
}

export function UiScaleSettingContextProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}

export const useUiScaleSettingLoading = (): boolean => loading;
export const useUiScaleSetting = (): number => 1;
export const useScalingMultiplier = (): number => scale;
export const useScaledSize = (originalSize: number): number => originalSize * scale;
