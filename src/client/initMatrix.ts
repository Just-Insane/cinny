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

type ClearCacheOptions = {
  /**
   * Extra delay to give the SW time to process NUKE_CACHES before we unregister it.
   * Keep small; we do NOT rely on this for correctness.
   */
  swMessageGraceMs?: number;
  /**
   * If true, clears local/session storage too.
   */
  clearWebStorage?: boolean;
};

async function nukeViaServiceWorker(): Promise<void> {
  try {
    // Best-effort: ask the active SW to clear its caches
    navigator.serviceWorker?.controller?.postMessage({ type: 'NUKE_CACHES' });
    // Best-effort: also ask it to activate any waiting SW (helps avoid "stuck old" cases)
    navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' });
  } catch {
    // ignore
  }
}

async function unregisterAllServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    // ignore
  }
}

async function deleteAllCaches(): Promise<void> {
  if (!('caches' in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    // ignore
  }
}

function reloadWithCacheBust(): void {
  const url = new URL(window.location.href);
  // Kill old query params that might affect routing; keep pathname + hash
  url.searchParams.set('_cb', String(Date.now()));
  window.location.replace(url.toString());
}

/**
 * Clear app data + ensure the next load is not controlled by an old SW.
 *
 * Call from both the SettingTile button and the MenuItem.
 */
export async function clearCacheAndReload(
  mx?: MatrixClient,
  opts: ClearCacheOptions = {}
): Promise<void> {
  const { swMessageGraceMs = 200, clearWebStorage = false } = opts;

  try {
    // 0) Best-effort: stop sync, close client, etc. (don’t block if it fails)
    try {
      mx?.stopClient?.();
    } catch {}
    try {
      // matrix-js-sdk has varied APIs depending on version; this is best-effort
      (mx as any)?.store?.deleteAllData?.();
    } catch {}

    // 1) Ask the currently controlling SW to clear its caches.
    //    (This helps cases where the old SW would otherwise repopulate caches during reload.)
    await nukeViaServiceWorker();

    // Give the SW a brief chance to process the message, if it’s still alive.
    if (swMessageGraceMs > 0) {
      await new Promise((r) => setTimeout(r, swMessageGraceMs));
    }

    // 2) Unregister all SWs so the next navigation is uncontrolled.
    await unregisterAllServiceWorkers();

    // 3) Delete all Cache Storage entries (Workbox precache/runtime + your debug cache).
    await deleteAllCaches();

    // 4) Optional: clear web storage (only if you truly mean “all local data”).
    if (clearWebStorage) {
      try {
        localStorage.clear();
      } catch {}
      try {
        sessionStorage.clear();
      } catch {}
    }

    // 5) Reload with a cache-busting param.
    reloadWithCacheBust();
  } catch {
    // Last-resort: at least reload with cache-bust
    reloadWithCacheBust();
  }
}

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
