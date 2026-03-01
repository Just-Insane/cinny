/* eslint-disable import/first */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import { configClass, varsClass } from 'folds';

enableMapSet();

import './index.css';

import { trimTrailingSlash } from './app/utils/common';
import App from './app/pages/App';

// import i18n (needs to be bundled ;))
import './app/i18n';
import { pushSessionToSW } from './sw-session';
import { getSecret } from './client/state/auth';
import { getSettings } from './app/state/settings';

document.body.classList.add(configClass, varsClass);

// Register Service Worker
// The SW is only relevant for web push. Desktop builds don’t use it and some
// platforms (e.g. file:// schemes used by Tauri) may reject registration with
// noisy errors, so bail out early.
if ('serviceWorker' in navigator && !/Tauri/.test(navigator.userAgent)) {
  const baseUrl = trimTrailingSlash(import.meta.env.BASE_URL || '/');
  const swUrl = import.meta.env.MODE === 'production' ? `${baseUrl}/sw.js` : `${baseUrl}/dev-sw.js?dev-sw`;
  const swType: RegistrationOptions['type'] =
    import.meta.env.MODE === 'production' ? 'classic' : 'module';

  const sendSessionToSW = () => {
    const session = getSecret();
    const settings = getSettings();
    pushSessionToSW(session?.baseUrl, session?.accessToken, session?.userId, {
      showPushNotificationContent: settings.showPushNotificationContent,
    });
  };

  navigator.serviceWorker.register(swUrl, { type: swType }).then(sendSessionToSW);
  navigator.serviceWorker.ready.then(sendSessionToSW);

  navigator.serviceWorker.addEventListener('message', (ev) => {
    const { type } = ev.data ?? {};

    if (type === 'requestSession') {
      sendSessionToSW();
    }
  });
}

const mountApp = () => {
  const rootContainer = document.getElementById('root');

  if (rootContainer === null) {
    console.error('Root container element not found!');
    return;
  }

  const root = createRoot(rootContainer);
  root.render(<App />);
};

mountApp();
