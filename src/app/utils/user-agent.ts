import { UAParser } from 'ua-parser-js';

export const ua = () => UAParser(window.navigator.userAgent);

export const isMacOS = () => ua().os.name === 'Mac OS';

export const mobileOrTablet = (): boolean => {
  const userAgent = ua();
  const { os, device } = userAgent;
  if (device.type === 'mobile' || device.type === 'tablet') return true;
  if (os.name === 'Android' || os.name === 'iOS') return true;
  return false;
};

/**
 * Running inside a Tauri desktop application? The UA string includes "Tauri" and
 * there will also be a build-time env variable available. We use this primarily to
 * handle permission quirks that don't apply to browsers (e.g. notification
 * permission is effectively always granted on desktop).
 */
export const isDesktop = (): boolean => {
  // `import.meta.env.TAURI_PLATFORM` is injected by Vite when building for
  // Tauri; it will be undefined in a regular browser build.
  // Fallback to checking the UA for the recognizable "Tauri" marker.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((import.meta.env as any).TAURI_PLATFORM) {
      return true;
    }
  } catch {
    // ignore in older build environments
  }
  return window.navigator.userAgent.includes('Tauri');
};
