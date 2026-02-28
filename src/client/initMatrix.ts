import { createClient, MatrixClient, IndexedDBStore, IndexedDBCryptoStore } from 'matrix-js-sdk';

import { cryptoCallbacks } from './secretStorageKeys';
import { SlidingSyncController } from './SlidingSyncController';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { pushSessionToSW } from '../sw-session';
import { Session, getSessionStoreName } from '../app/state/sessions';
import { getSettings } from '../app/state/settings';

export const initClient = async (session: Session): Promise<MatrixClient> => {
  const settings = getSettings();
  pushSessionToSW(session.baseUrl, session.accessToken, session.userId, {
    showPushNotificationContent: settings.showPushNotificationContent,
  });
  const storeName = getSessionStoreName(session);
  const indexedDBStore = new IndexedDBStore({
    indexedDB: global.indexedDB,
    localStorage: global.localStorage,
    dbName: storeName.sync,
  });

  const legacyCryptoStore = new IndexedDBCryptoStore(global.indexedDB, storeName.crypto);

  const mx = createClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    store: indexedDBStore,
    cryptoStore: legacyCryptoStore,
    deviceId: session.deviceId,
    timelineSupport: true,
    cryptoCallbacks: cryptoCallbacks as any,
    verificationMethods: ['m.sas.v1'],
  });

  await indexedDBStore.startup();
  await mx.initRustCrypto();

  mx.setMaxListeners(50);

  return mx;
};

export const startClient = async (mx: MatrixClient) => {
  const syncController = SlidingSyncController.getInstance();

  await syncController.verifyServerSupport(mx);

  if (SlidingSyncController.isSupportedOnServer) {
    const slidingSync = await syncController.initialize(mx);

    await mx.startClient({
      slidingSync,
      lazyLoadMembers: true,
    });
    return;
  }

  // tell the controller we are NOT using sliding sync
  syncController.disable();

  await mx.startClient({
    initialSyncLimit: 20,
    lazyLoadMembers: true,
  });
};

export const clearCacheAndReload = async (mx: MatrixClient) => {
  SlidingSyncController.getInstance().dispose();

  mx.stopClient();
  clearNavToActivePathStore(mx.getSafeUserId());
  await mx.store.deleteAllData();
  window.location.reload();
};

export const logoutClient = async (mx: MatrixClient) => {
  pushSessionToSW();
  SlidingSyncController.getInstance().dispose();

  mx.stopClient();
  try {
    await mx.logout();
  } catch {
    // ignore if failed to logout
  }
  await mx.clearStores();
  window.localStorage.clear();
  window.location.reload();
};

export const clearLoginData = async () => {
  const dbs = await window.indexedDB.databases();

  dbs.forEach((idbInfo) => {
    const { name } = idbInfo;
    if (name) {
      window.indexedDB.deleteDatabase(name);
    }
  });

  window.localStorage.clear();
  window.location.reload();
};
