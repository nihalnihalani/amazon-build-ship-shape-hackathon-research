// Jest stand-in for @amazon-devices/kepler-a11y-settings-interface-turbo (UI scale hooks).
import * as React from 'react';

let scale = 1;
let loading = false;

export function setUiScaleMock(next: number): void {
  scale = next;
}
export function setUiScaleLoadingMock(next: boolean): void {
  loading = next;
}
export function resetUiScaleMock(): void {
  scale = 1;
  loading = false;
}

export function UiScaleSettingContextProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}

export const useUiScaleSettingLoading = (): boolean => loading;
export const useUiScaleSetting = (): number => 1;
export const useScalingMultiplier = (): number => scale;
export const useScaledSize = (originalSize: number): number => originalSize * scale;
