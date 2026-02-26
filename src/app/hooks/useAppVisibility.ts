import { useEffect } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { useAtom } from 'jotai';
import { togglePusher } from '../features/settings/notifications/PushNotifications';
import { appEvents } from '../utils/appEvents';
import { useClientConfig } from './useClientConfig';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { pushSubscriptionAtom } from '../state/pushSubscription';
import { SlidingSyncController } from '../../client/SlidingSyncController';

export function useAppVisibility(mx: MatrixClient | undefined) {
  const clientConfig = useClientConfig();
  const [usePushNotifications] = useSetting(settingsAtom, 'usePushNotifications');
  const pushSubAtom = useAtom(pushSubscriptionAtom);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible';

      appEvents.onVisibilityChange?.(isVisible);

      if (isVisible) {
        appEvents.onAppForeground?.();
      } else {
        appEvents.onVisibilityHidden?.();
      }
    };

    const handleFocus = () => {
      appEvents.onAppFocus?.();
      appEvents.onAppForeground?.();
    };

    const handleOnline = () => {
      appEvents.onNetworkOnline?.();
      appEvents.onAppForeground?.();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  useEffect(() => {
    if (!mx) return;

    const handleVisibilityForNotifications = (isVisible: boolean) => {
      togglePusher(mx, clientConfig, isVisible, usePushNotifications, pushSubAtom);
    };

    appEvents.onVisibilityChange = handleVisibilityForNotifications;
    return () => {
      appEvents.onVisibilityChange = null;
    };
  }, [mx, clientConfig, usePushNotifications, pushSubAtom]);

  useEffect(() => {
    if (!mx) return;

    const controller = SlidingSyncController.getInstance();

    const resume = () => {
      if (!SlidingSyncController.isSupportedOnServer) return;
      void controller.resumeFromAppForeground();
    };

    appEvents.onAppForeground = resume;
    appEvents.onAppFocus = resume;
    appEvents.onNetworkOnline = resume;

    return () => {
      appEvents.onAppForeground = null;
      appEvents.onAppFocus = null;
      appEvents.onNetworkOnline = null;
    };
  }, [mx]);
}
