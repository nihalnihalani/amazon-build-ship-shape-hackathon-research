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

// Screen reader state for the preview (read-only API surface, like the real package). The initial value comes
// from the query string (?screenReader=1); window.__atr.setScreenReader(true | false) changes it and notifies the
// registered listener, exactly as the platform would.
let screenReaderEnabled = new URLSearchParams(window.location.search).get('screenReader') === '1';
let screenReaderListener: ((enabled: boolean) => void) | null = null;

export function setPreviewScreenReader(enabled: boolean): void {
  screenReaderEnabled = enabled;
  screenReaderListener?.(enabled);
}

export const KeplerA11ySettingsInterface = {
  async isScreenReaderEnabled(): Promise<boolean> {
    return screenReaderEnabled;
  },
  async addScreenReaderStateListener(handler: (enabled: boolean) => void): Promise<boolean> {
    screenReaderListener = handler;
    return true;
  },
  async removeScreenReaderStateListener(): Promise<void> {
    screenReaderListener = null;
  },
};
