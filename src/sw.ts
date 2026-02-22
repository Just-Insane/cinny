/// <reference lib="WebWorker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

export type {};
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST?: unknown[] };

const DEFAULT_NOTIFICATION_ICON = '/public/res/apple/apple-touch-icon-180x180.png';
const DEFAULT_NOTIFICATION_BADGE = '/public/res/apple/apple-touch-icon-72x72.png';

type SessionInfo = {
  accessToken: string;
  baseUrl: string;
};

/**
 * Store session per client (tab)
 */
const sessions = new Map<string, SessionInfo>();

const clientToResolve = new Map<string, (value: SessionInfo | undefined) => void>();
const clientToSessionPromise = new Map<string, Promise<SessionInfo | undefined>>();

async function cleanupDeadClients() {
  const activeClients = await self.clients.matchAll();
  const activeIds = new Set(activeClients.map((c) => c.id));

  Array.from(sessions.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      sessions.delete(id);
      clientToResolve.delete(id);
      clientToSessionPromise.delete(id);
    }
  });
}

function setSession(clientId: string, accessToken: any, baseUrl: any) {
  if (typeof accessToken === 'string' && typeof baseUrl === 'string') {
    sessions.set(clientId, { accessToken, baseUrl });
  } else {
    // Logout or invalid session
    sessions.delete(clientId);
  }

  const resolveSession = clientToResolve.get(clientId);
  if (resolveSession) {
    resolveSession(sessions.get(clientId));
    clientToResolve.delete(clientId);
    clientToSessionPromise.delete(clientId);
  }
}

function requestSession(client: Client): Promise<SessionInfo | undefined> {
  const promise =
    clientToSessionPromise.get(client.id) ??
    new Promise((resolve) => {
      clientToResolve.set(client.id, resolve);
      client.postMessage({ type: 'requestSession' });
    });

  if (!clientToSessionPromise.has(client.id)) {
    clientToSessionPromise.set(client.id, promise);
  }

  return promise;
}

async function requestSessionWithTimeout(
  clientId: string,
  timeoutMs = 3000
): Promise<SessionInfo | undefined> {
  const client = await self.clients.get(clientId);
  if (!client) return undefined;

  const sessionPromise = requestSession(client);

  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), timeoutMs);
  });

  return Promise.race([sessionPromise, timeout]);
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await cleanupDeadClients();
    })()
  );
});

/**
 * Receive session updates from clients
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const client = event.source as Client | null;
  if (!client) return;

  const { type, accessToken, baseUrl, token, url, pusherData } = event.data || {};

  if (type === 'togglePush') {
    if (!token || !url) return;
    const fetchOptions = fetchConfig(token);
    event.waitUntil(
      fetch(`${url}/_matrix/client/v3/pushers/set`, {
        method: 'POST',
        ...fetchOptions,
        body: JSON.stringify(pusherData),
      })
    );
    return;
  }

  if (type === 'setSession') {
    setSession(client.id, accessToken, baseUrl);
    cleanupDeadClients();
  }
});

const MEDIA_PATHS = ['/_matrix/client/v1/media/download', '/_matrix/client/v1/media/thumbnail'];

function mediaPath(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return MEDIA_PATHS.some((p) => pathname.startsWith(p));
  } catch {
    return false;
  }
}

function validMediaRequest(url: string, baseUrl: string): boolean {
  return MEDIA_PATHS.some((p) => {
    const validUrl = new URL(p, baseUrl);
    return url.startsWith(validUrl.href);
  });
}

function fetchConfig(token: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'default',
  };
}

self.addEventListener('fetch', (event: FetchEvent) => {
  const { url, method } = event.request;

  if (method !== 'GET' || !mediaPath(url)) return;

  const { clientId } = event;
  if (!clientId) return;

  const session = sessions.get(clientId);
  if (session) {
    if (validMediaRequest(url, session.baseUrl)) {
      event.respondWith(fetch(url, fetchConfig(session.accessToken)));
    }
    return;
  }

  event.respondWith(
    requestSessionWithTimeout(clientId).then((s) => {
      if (s && validMediaRequest(url, s.baseUrl)) {
        return fetch(url, fetchConfig(s.accessToken));
      }
      return fetch(event.request);
    })
  );
});

const onPushNotification = async (event: PushEvent) => {
  let title = 'New Notification';
  const options: NotificationOptions & {
    image?: string;
    vibrate?: VibratePattern;
    actions?: Array<{ action: string; title: string; icon?: string }>;
    renotify?: boolean;
  } = {
    body: 'You have a new message!',
    icon: DEFAULT_NOTIFICATION_ICON,
    badge: DEFAULT_NOTIFICATION_BADGE,
    data: {
      url: self.registration.scope,
      timestamp: Date.now(),
    },
  };

  if (event.data) {
    try {
      const pushData = event.data.json();
      title = pushData.title || title;
      options.body = options.body ?? pushData.data?.toString();
      options.icon = pushData.icon || options.icon;
      options.badge = pushData.badge || options.badge;

      if (pushData.image) options.image = pushData.image;
      if (pushData.vibrate) options.vibrate = pushData.vibrate;
      if (pushData.actions) options.actions = pushData.actions;
      options.tag = 'Cinny';
      if (typeof pushData.renotify === 'boolean') options.renotify = pushData.renotify;
      if (typeof pushData.silent === 'boolean') options.silent = pushData.silent;

      if (pushData.data) {
        options.data = { ...options.data, ...pushData.data };
      }
      if (typeof pushData.unread === 'number') {
        try {
          self.navigator.setAppBadge(pushData.unread);
        } catch {
          // Likely Firefox/Gecko-based and doesn't support badging API
        }
      } else {
        try {
          await self.navigator.clearAppBadge();
        } catch {
          // ignore if not supported
        }
      }
    } catch {
      const pushText = event.data.text();
      options.body = pushText || options.body;
    }
  }

  return self.registration.showNotification(title, options);
};

self.addEventListener('push', (event: PushEvent) => event.waitUntil(onPushNotification(event)));

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || self.registration.scope;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          await (client as WindowClient).focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

if (self.__WB_MANIFEST) {
  precacheAndRoute(self.__WB_MANIFEST);
}
cleanupOutdatedCaches();
