export const appEvents = {
  onVisibilityHidden: null as (() => void) | null,
  onVisibilityChange: null as ((isVisible: boolean) => void) | null,
  onAppForeground: null as (() => void) | null,
  onAppFocus: null as (() => void) | null,
  onNetworkOnline: null as (() => void) | null,
};
