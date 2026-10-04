// "@amazon-devices/kepler-a11y-settings-interface-turbo" for the web preview. The UI scale comes from the
// query string (?scale=1.5) so layouts can be checked at larger scales; it never reads a real device setting.
import * as React from 'react';

function scaleFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('scale');
  const value = raw === null ? 1 : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function UiScaleSettingContextProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}
export const useUiScaleSettingLoading = (): boolean => false;
export const useUiScaleSetting = (): number => 1;
export const useScalingMultiplier = (): number => scaleFromUrl();
export const useScaledSize = (originalSize: number): number => originalSize * scaleFromUrl();
