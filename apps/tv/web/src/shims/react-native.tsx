// "react-native" for the web preview: react-native-web plus the TV-specific behaviour the app relies on.
//  - Pressable: a control with hasTVPreferredFocus takes DOM focus when it mounts (the closest web analogue of
//    the TV focus engine's initial focus) and is marked data-preferred-focus for tests.
//  - BackHandler: Escape / Backspace (see kepler.tsx) call the registered hardwareBackPress listeners, last
//    registered first, stopping when one returns true. Same contract as Vega's BackHandler.
//  - useWindowDimensions: the TV canvas size (1920 x 1080), so layout fitting matches the design canvas.
import * as React from 'react';
import { Pressable as WebPressable } from 'react-native-web';

export * from 'react-native-web';

type PressableProps = React.ComponentProps<typeof WebPressable> & { hasTVPreferredFocus?: boolean };

export const Pressable = React.forwardRef<unknown, PressableProps>(function Pressable(props, forwarded) {
  const { hasTVPreferredFocus, ...rest } = props;
  const ref = React.useRef<{ focus?: () => void } | null>(null);
  React.useEffect(() => {
    if (hasTVPreferredFocus) ref.current?.focus?.();
  }, [hasTVPreferredFocus]);
  return (
    <WebPressable
      {...rest}
      dataSet={{ ...(rest as { dataSet?: object }).dataSet, preferredFocus: hasTVPreferredFocus ? 'true' : 'false' }}
      ref={(node: unknown) => {
        ref.current = node as { focus?: () => void } | null;
        if (typeof forwarded === 'function') forwarded(node);
        else if (forwarded) (forwarded as { current: unknown }).current = node;
      }}
    />
  );
}) as unknown as typeof WebPressable;

type BackListener = () => boolean | null | undefined;
const backListeners: BackListener[] = [];

export const BackHandler = {
  exitApp(): void {
    // Not meaningful in a browser.
  },
  addEventListener(_name: 'hardwareBackPress' | 'backPress', handler: BackListener): { remove: () => void } {
    if (!backListeners.includes(handler)) backListeners.push(handler);
    return {
      remove: () => {
        const index = backListeners.indexOf(handler);
        if (index >= 0) backListeners.splice(index, 1);
      },
    };
  },
};

/** Called by the keyboard shim for Escape / Backspace. Returns true if a listener consumed it. */
export function pressHardwareBack(): boolean {
  for (let i = backListeners.length - 1; i >= 0; i--) {
    if (backListeners[i]?.()) return true;
  }
  return false;
}

export function useWindowDimensions(): { width: number; height: number; scale: number; fontScale: number } {
  return { width: 1920, height: 1080, scale: 1, fontScale: 1 };
}

/**
 * react-native-svg imports TurboModuleRegistry (a native-only export) in its Fabric helper modules. The web
 * preview never calls it; this stub keeps the unbundled dev server (npm run dev) from failing on the missing export.
 */
export const TurboModuleRegistry = {
  get: (): null => null,
  getEnforcing: (name: string): never => {
    throw new Error('Native module ' + name + ' is not available in the web preview');
  },
};
