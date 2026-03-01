import { ClientEvent, EventType, MatrixClient, Room } from 'matrix-js-sdk';
import {
  MSC3575Filter,
  MSC3575List,
  MSC3575SlidingSyncResponse,
  MSC3575_STATE_KEY_LAZY,
  MSC3575_STATE_KEY_ME,
  MSC3575_WILDCARD,
  SlidingSync,
  SlidingSyncEvent,
  SlidingSyncState,
} from 'matrix-js-sdk/lib/sliding-sync';
import { logger } from 'matrix-js-sdk/lib/logger';
import { sleep } from 'matrix-js-sdk/lib/utils';

const INITIAL_SYNC_TIMEOUT_MS = 20_000;

const WATCHDOG_CHECK_INTERVAL_MS = 15_000;
const WATCHDOG_STUCK_THRESHOLD_MS = 60_000; // no Complete for this long => restart
const WATCHDOG_RESTART_COOLDOWN_MS = 30_000;

const RESUME_PROGRESS_TIMEOUT_MS = 8_000;

const UNENCRYPTED_SUB_KEY = 'unencrypted_lazy_load';

/**
 * Core state events required across the application for proper rendering.
 * Includes standard room metadata, VoIP, and MSC2545 emotes/stickers.
 */
const BASE_STATE_REQUIREMENTS: [string, string][] = [
  [EventType.RoomJoinRules, ''],
  [EventType.RoomAvatar, ''],
  [EventType.RoomCanonicalAlias, ''],
  [EventType.RoomTombstone, ''],
  [EventType.RoomEncryption, ''],
  [EventType.RoomCreate, ''],
  [EventType.SpaceChild, MSC3575_WILDCARD],
  [EventType.SpaceParent, MSC3575_WILDCARD],
  [EventType.RoomMember, MSC3575_STATE_KEY_ME],
  [EventType.RoomPowerLevels, ''],

  // Call / VoIP Metadata
  ['org.matrix.msc3401.call', MSC3575_WILDCARD],
  ['org.matrix.msc3401.call.member', MSC3575_WILDCARD],
  ['m.call', MSC3575_WILDCARD],
  ['m.call.member', MSC3575_WILDCARD],

  // Custom Emotes & Stickers
  ['im.ponies.room_emotes', MSC3575_WILDCARD],
  ['im.ponies.user_emotes', MSC3575_WILDCARD],
  ['m.image_pack', MSC3575_WILDCARD],
  ['m.image_pack.aggregate', MSC3575_WILDCARD],

  // Misc
  ['in.cinny.room.power_level_tags', MSC3575_WILDCARD],
  ['org.matrix.msc3381.poll.response', MSC3575_WILDCARD],
  ['com.famedly.marked_unread', MSC3575_WILDCARD],
];

const SUBSCRIPTION_BASE = {
  timeline_limit: 50,
  required_state: BASE_STATE_REQUIREMENTS,
  include_old_rooms: {
    timeline_limit: 0,
    required_state: BASE_STATE_REQUIREMENTS,
  },
};

const SUBSCRIPTIONS = {
  DEFAULT: {
    ...SUBSCRIPTION_BASE,
    required_state: [...BASE_STATE_REQUIREMENTS, [EventType.RoomMember, MSC3575_STATE_KEY_LAZY]],
  },
  UNENCRYPTED: {
    ...SUBSCRIPTION_BASE,
    required_state: [...BASE_STATE_REQUIREMENTS, [EventType.RoomMember, MSC3575_STATE_KEY_LAZY]],
  },
  ENCRYPTED: {
    ...SUBSCRIPTION_BASE,
    required_state: [...BASE_STATE_REQUIREMENTS, [EventType.RoomMember, MSC3575_STATE_KEY_LAZY]],
  },
} as const;

const INITIAL_LIST_CONFIGS: Record<string, MSC3575List> = {
  spaces: {
    ranges: [[0, 10]],
    timeline_limit: 0,
    required_state: BASE_STATE_REQUIREMENTS,
    include_old_rooms: SUBSCRIPTION_BASE.include_old_rooms,
    filters: { room_types: ['m.space'] },
  },
  invites: {
    ranges: [[0, 10]],
    timeline_limit: 1,
    required_state: BASE_STATE_REQUIREMENTS,
    include_old_rooms: SUBSCRIPTION_BASE.include_old_rooms,
    filters: { is_invite: true },
  },
  favourites: {
    ranges: [[0, 10]],
    timeline_limit: 1,
    required_state: BASE_STATE_REQUIREMENTS,
    include_old_rooms: SUBSCRIPTION_BASE.include_old_rooms,
    filters: { tags: ['m.favourite'] },
  },
  dms: {
    ranges: [[0, 10]],
    timeline_limit: 1,
    required_state: BASE_STATE_REQUIREMENTS,
    include_old_rooms: SUBSCRIPTION_BASE.include_old_rooms,
    filters: { is_dm: true, is_invite: false, not_tags: ['m.favourite', 'm.lowpriority'] },
  },
  untagged: {
    ranges: [[0, 10]],
    timeline_limit: 1,
    required_state: BASE_STATE_REQUIREMENTS,
    include_old_rooms: SUBSCRIPTION_BASE.include_old_rooms,
  },
};

export type SyncListUpdatePayload = {
  filters?: MSC3575Filter;
  sort?: string[];
  ranges?: [number, number][];
};

export const synchronizeGlobalEmotes = async (client: MatrixClient) => {
  const emoteEvent = client.getAccountData('im.ponies.emote_rooms');
  if (!emoteEvent) return;

  const rooms = Object.keys(emoteEvent.getContent()?.rooms || {});
  const syncInstance = SlidingSyncController.getInstance().syncInstance;
  if (!syncInstance || rooms.length === 0) return;

  const activeSubs = syncInstance.getRoomSubscriptions();
  rooms.forEach((id) => activeSubs.add(id));

  // Some SDK versions type this as void; still performs async work.
  await Promise.resolve(syncInstance.modifyRoomSubscriptions(activeSubs) as any);
  logger.debug(`[SlidingSync] Subscribed to ${rooms.length} global emote rooms.`);
};

export class SlidingSyncController {
  public static isSupportedOnServer = false;

  private static instance: SlidingSyncController;

  public syncInstance?: SlidingSync;

  private matrixClient?: MatrixClient;

  private initializationResolve?: () => void;
  private initializationPromise: Promise<void>;

  private slidingSyncEnabled = false;
  private slidingSyncDisabled = false;

  // Serialize mutations that can race (setListRanges, setList, modifyRoomSubscriptions, etc.)
  private op: Promise<void> = Promise.resolve();

  // Lifecycle / watchdog tracking
  private lastCompleteAt = 0;
  private lastRequestFinishedAt = 0;
  private lastRestartAt = 0;

  private lifecycleHandler?: (state: SlidingSyncState, resp: any, err?: Error) => void;
  private watchdogIntervalId?: number;

  private inResume: Promise<void> | null = null;

  private constructor() {
    this.initializationPromise = new Promise((resolve) => {
      this.initializationResolve = resolve;
    });
  }

  public static getInstance(): SlidingSyncController {
    if (!SlidingSyncController.instance) {
      SlidingSyncController.instance = new SlidingSyncController();
    }
    return SlidingSyncController.instance;
  }

  private enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.op.then(() => fn());
    this.op = Promise.resolve(next).then(
      () => undefined,
      () => undefined
    );
    return Promise.resolve(next);
  }

  /**
   * Call on logout / full reload to prevent leaked intervals/listeners.
   */
  public dispose(): void {
    const sync = this.syncInstance;

    if (this.watchdogIntervalId) {
      window.clearInterval(this.watchdogIntervalId);
      this.watchdogIntervalId = undefined;
    }

    if (sync && this.lifecycleHandler) {
      sync.off(SlidingSyncEvent.Lifecycle, this.lifecycleHandler as any);
    }
    this.lifecycleHandler = undefined;

    // nuke subscriptions on dispose so server no longer sends us data
    if (sync) {
      try {
        // typings may not expose this helper method in older SDK versions
        // @ts-ignore
        (sync as any).setRoomSubscriptions(new Set());
      } catch {
        // ignore
      }
    }

    try {
      sync?.stop();
    } catch {
      // ignore
    }

    this.syncInstance = undefined;
    this.matrixClient = undefined;

    this.slidingSyncEnabled = false;
    this.slidingSyncDisabled = false;

    // reset init promise for next session if needed
    this.initializationPromise = new Promise((resolve) => {
      this.initializationResolve = resolve;
    });

    this.lastCompleteAt = 0;
    this.lastRequestFinishedAt = 0;
    this.lastRestartAt = 0;
    this.inResume = null;
    this.op = Promise.resolve();
  }

  /**
   * Initializes the SlidingSync instance and triggers background list population.
   * IMPORTANT: This should be called only if server support is detected and you plan to pass
   * the returned SlidingSync instance into mx.startClient({ slidingSync }).
   */
  public async initialize(client: MatrixClient): Promise<SlidingSync> {
    this.matrixClient = client;
    this.slidingSyncEnabled = true;
    this.slidingSyncDisabled = false;

    // If we’re re-initializing in same page session, clean previous listeners/intervals.
    if (this.watchdogIntervalId) {
      window.clearInterval(this.watchdogIntervalId);
      this.watchdogIntervalId = undefined;
    }
    if (this.syncInstance && this.lifecycleHandler) {
      this.syncInstance.off(SlidingSyncEvent.Lifecycle, this.lifecycleHandler as any);
    }

    // build a typed Map without relying on ES2017 features such as entries
    // to keep compatibility with older TS lib targets.
    const configuredLists = new Map<string, MSC3575List>();
    for (const key of Object.keys(INITIAL_LIST_CONFIGS)) {
      configuredLists.set(key, INITIAL_LIST_CONFIGS[key]);
    }

    let sync: SlidingSync;

    try {
      sync = new SlidingSync(
        client.baseUrl,
        configuredLists,
        // cast to any because the type is readonly and the SDK expects mutable
        SUBSCRIPTIONS.DEFAULT as any,
        client,
        INITIAL_SYNC_TIMEOUT_MS
      );

      // @ts-ignore readonly vs mutable mismatch
      sync.addCustomSubscription(UNENCRYPTED_SUB_KEY, SUBSCRIPTIONS.UNENCRYPTED as any);

      this.syncInstance = sync;
      logger.info(`[SlidingSync] Activated at ${client.baseUrl}`);
    } catch (err) {
      // make sure callers waiting for initialization are unblocked even on error
      this.initializationResolve?.();
      throw err;
    }

    // signal that initialization has completed successfully
    this.initializationResolve?.();

    // Track progress + errors from lifecycle events.
    this.lastCompleteAt = Date.now();

    this.lifecycleHandler = (state: SlidingSyncState, _resp: any, err?: Error) => {
      if (err) {
        logger.warn('[SlidingSync] lifecycle error', { state, err });
        return;
      }
      if (state === SlidingSyncState.RequestFinished) {
        this.lastRequestFinishedAt = Date.now();
      }
      if (state === SlidingSyncState.Complete) {
        this.lastCompleteAt = Date.now();
      }
    };

    // watch for encryption state events so we can switch unencrypted subscriptions
    const handleEvent = async (ev: any) => {
      if (ev.getType() !== EventType.RoomEncryption) return;
      const rid = ev.getRoomId();
      const sync = this.syncInstance;
      if (!sync) return;
      const subs = sync.getRoomSubscriptions();
      if (!subs.has(rid)) return;
      const crypto = this.matrixClient?.getCrypto();
      const isEncrypted = crypto ? await crypto.isEncryptionEnabledInRoom(rid) : false;
      if (!isEncrypted) {
        try {
          sync.useCustomSubscription(rid, UNENCRYPTED_SUB_KEY);
        } catch {}
      } else {
        try {
          // @ts-ignore may be missing in SDK
          (sync as any).removeCustomSubscription?.(rid);
        } catch {}
      }
    };
    client.on(ClientEvent.Event, handleEvent);
    // remember to remove when disposing
    const origDispose = this.dispose.bind(this);
    this.dispose = () => {
      client.off(ClientEvent.Event, handleEvent);
      origDispose();
    };

    sync.on(SlidingSyncEvent.Lifecycle, this.lifecycleHandler as any);

    // Watchdog: restart if we stop seeing completes for too long.
    this.watchdogIntervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      const now = Date.now();
      const age = now - this.lastCompleteAt;
      if (age <= WATCHDOG_STUCK_THRESHOLD_MS) return;

      if (now - this.lastRestartAt < WATCHDOG_RESTART_COOLDOWN_MS) return;
      this.lastRestartAt = now;

      logger.warn('[SlidingSync] appears stuck; restarting', { ageMs: age });

      try {
        sync.stop();
      } catch {}
      try {
        sync.start();
      } catch {}

      // give it a fresh grace period
      this.lastCompleteAt = now;
      this.lastRequestFinishedAt = now;
    }, WATCHDOG_CHECK_INTERVAL_MS);

    // Background list expansion
    this.executeBackgroundSpidering(sync, 100, 0);

    return sync;
  }

  public disable(): void {
    // If already enabled (initialize called), don’t “disable” mid-flight here.
    if (this.slidingSyncEnabled || this.slidingSyncDisabled) return;

    this.slidingSyncDisabled = true;
    this.initializationResolve?.(); // unblock focusRoom callers
  }

  /**
   * Creates or updates a specific UI list in the sync request.
   */
  public async configureList(listId: string, payload: SyncListUpdatePayload): Promise<MSC3575List> {
    await this.initializationPromise;

    const sync = this.syncInstance;
    if (!sync) throw new Error('Sync instance not initialized');

    const existingList = sync.getListParams(listId);

    // If we're only updating ranges, use the lighter operation
    if (existingList && payload.ranges && Object.keys(payload).length === 1) {
      await this.enqueue(() => sync.setListRanges(listId, payload.ranges!));
      return sync.getListParams(listId)!;
    }

    const mergedList: MSC3575List = existingList
      ? { ...existingList, ...payload }
      : {
          ranges: [[0, 50]],
          sort: ['by_notification_level', 'by_recency'],
          timeline_limit: 1,
          required_state: [
            ...BASE_STATE_REQUIREMENTS,
            [EventType.RoomMember, MSC3575_STATE_KEY_LAZY],
          ],
          include_old_rooms: SUBSCRIPTION_BASE.include_old_rooms,
          ...payload,
        };

    if (JSON.stringify(existingList) !== JSON.stringify(mergedList)) {
      await this.enqueue(async () => {
        try {
          await sync.setList(listId, mergedList);
        } catch (error) {
          logger.error(`[SlidingSync] Failed to configure list ${listId}:`, error);
        }
      });
    }

    return sync.getListParams(listId)!;
  }

  /**
   * Forces immediate state population when a user explicitly navigates to a room.
   * Safe to call even when sliding sync is not active; it becomes a fast no-op.
   */
  public async focusRoom(roomId: string): Promise<void> {
    if (this.slidingSyncDisabled) return;
    if (!this.slidingSyncEnabled && !this.syncInstance) return;

    await this.initializationPromise;

    const sync = this.syncInstance;
    const client = this.matrixClient;
    if (!sync || !client) return;

    const subs = sync.getRoomSubscriptions();
    // if we were about to unsubscribe the room, cancel that
    const pending = this.pendingUnfocus.get(roomId);
    if (pending) {
      window.clearTimeout(pending);
      this.pendingUnfocus.delete(roomId);
    }
    if (subs.has(roomId)) {
      // already subscribed, but make sure our timeline limit is generous enough
      // @ts-ignore missing in some SDK typings
      const params = (sync as any).getRoomParams(roomId);
      if (params && params.timeline_limit < 100) {
        await this.enqueue(() =>
          // @ts-ignore
          (sync as any).setRoom(roomId, { ...params, timeline_limit: 100 })
        );
      }
      return;
    }

    subs.add(roomId);

    const roomContext = client.getRoom(roomId);

    const crypto = client.getCrypto();
    const isEncrypted = crypto ? await crypto.isEncryptionEnabledInRoom(roomId) : false;

    await this.enqueue(async () => {
      if (!isEncrypted) {
        sync.useCustomSubscription(roomId, UNENCRYPTED_SUB_KEY);
      }
      // also bump timeline_limit so users see more history on first open
      // @ts-ignore
      const baseParams = (sync as any).getRoomParams(roomId);
      const newParams = baseParams
        ? { ...baseParams, timeline_limit: Math.max(baseParams.timeline_limit, 100) }
        : undefined;
      if (newParams) {
        // @ts-ignore
        await (sync as any).setRoom(roomId, newParams);
      }
      await Promise.resolve(sync.modifyRoomSubscriptions(subs) as any);
    });

    // Verify and retry once (defensive against races/overwrites)
    if (!sync.getRoomSubscriptions().has(roomId)) {
      const subs2 = sync.getRoomSubscriptions();
      subs2.add(roomId);
      await Promise.resolve(sync.modifyRoomSubscriptions(subs2) as any);
    }

    if (!roomContext) {
      await new Promise<void>((resolve) => {
        const onRoomAdded = (r: Room) => {
          if (r.roomId === roomId) {
            client.off(ClientEvent.Room, onRoomAdded);
            resolve();
          }
        };
        client.on(ClientEvent.Room, onRoomAdded);
      });
    }
  }

  /**
   * Remove a room from the sliding-sync subscription set.  Called when the UI
   * stops showing the room, to prevent unbounded subscription growth.
   */
  // unsubscriptions are delayed to avoid thrashing when the user rapidly
  // switches between rooms.  we store a timeout handle for each room and only
  // actually modify the subscriptions once the timer fires.  if the room is
  // re‑focused before that happens we cancel the pending removal.
  private pendingUnfocus = new Map<string, number>();

  public async unfocusRoom(roomId: string): Promise<void> {
    if (this.slidingSyncDisabled) return;
    if (!this.slidingSyncEnabled && !this.syncInstance) return;

    // cancel any previous pending removal (defensive)
    const prev = this.pendingUnfocus.get(roomId);
    if (prev) {
      window.clearTimeout(prev);
      this.pendingUnfocus.delete(roomId);
    }

    const timer = window.setTimeout(async () => {
      this.pendingUnfocus.delete(roomId);
      const sync = this.syncInstance;
      if (!sync) return;

      const subs = sync.getRoomSubscriptions();
      if (!subs.has(roomId)) return;

      subs.delete(roomId);
      await this.enqueue(() => Promise.resolve(sync.modifyRoomSubscriptions(subs) as any));
    }, 30_000); // keep subscription for 30s

    this.pendingUnfocus.set(roomId, timer);
  }

  /**
   * Checks if the homeserver advertises native Simplified Sliding Sync support.
   */
  public async verifyServerSupport(client: MatrixClient): Promise<boolean> {
    const isSupported = await client?.doesServerSupportUnstableFeature(
      'org.matrix.simplified_msc3575'
    );

    SlidingSyncController.isSupportedOnServer = !!isSupported;

    if (isSupported) {
      logger.debug('[SlidingSync] Native org.matrix.simplified_msc3575 support detected.');
    } else {
      this.disable();
    }

    return SlidingSyncController.isSupportedOnServer;
  }

  private waitForNextRequestFinished(afterMs: number, timeoutMs: number): Promise<boolean> {
    const sync = this.syncInstance;
    if (!sync) return Promise.resolve(false);

    return new Promise((resolve) => {
      let done = false;

      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        sync.off(SlidingSyncEvent.Lifecycle, onLife as any);
        resolve(false);
      }, timeoutMs);

      const onLife = (
        state: SlidingSyncState,
        _r: MSC3575SlidingSyncResponse | null,
        _err?: Error
      ) => {
        if (state !== SlidingSyncState.RequestFinished) return;
        if (this.lastRequestFinishedAt <= afterMs) return;

        if (done) return;
        done = true;
        window.clearTimeout(timer);
        sync.off(SlidingSyncEvent.Lifecycle, onLife as any);
        resolve(true);
      };

      sync.on(SlidingSyncEvent.Lifecycle, onLife as any);
    });
  }

  /**
   * For iOS PWA / flaky networks: when coming back to foreground, force a resend and if
   * we don’t observe progress, do a controlled restart.
   */
  // returns a promise that resolves when the resume sequence finishes; callers
  // may ignore the return value but it can be waited on for testing or logging.
  public resumeFromAppForeground(): Promise<void> | null {
    if (this.slidingSyncDisabled) return null;
    if (this.inResume) return this.inResume;

    this.inResume = (async () => {
      await this.initializationPromise;
      const sync = this.syncInstance;
      if (!sync) return;

      const lastProgress = Math.max(this.lastRequestFinishedAt, this.lastCompleteAt);

      // Light poke
      try {
        sync.resend();
      } catch (e) {
        logger.debug('[SlidingSync] resend() failed (ignored)', e);
      }

      const progressed = await this.waitForNextRequestFinished(
        lastProgress,
        RESUME_PROGRESS_TIMEOUT_MS
      );
      if (progressed) return;

      logger.info('[SlidingSync] No progress after resume; restarting sliding sync.');

      try {
        sync.stop();
      } catch {}

      try {
        sync.start();
      } catch (e) {
        logger.warn('[SlidingSync] restart start() failed', e);
      }

      const now = Date.now();
      this.lastRestartAt = now;
      this.lastCompleteAt = now;
      this.lastRequestFinishedAt = now;
    })();

    // clear the reference when the promise settles without using finally
    this.inResume.then(
      () => {
        this.inResume = null;
      },
      () => {
        this.inResume = null;
      }
    );

    return this.inResume;
  }

  /**
   * Incrementally expands list ranges to fetch all user rooms in the background.
   */
  private executeBackgroundSpidering(sync: SlidingSync, batchLimit: number, delayMs: number): void {
    const boundsTracker = new Map<string, number>(
      Object.keys(INITIAL_LIST_CONFIGS).map((key) => [key, INITIAL_LIST_CONFIGS[key].ranges[0][1]])
    );

    const handleSyncLifecycle = async (
      state: SlidingSyncState,
      _: MSC3575SlidingSyncResponse | null,
      err?: Error
    ) => {
      if (state !== SlidingSyncState.Complete) return;
      if (err) return;

      if (delayMs > 0) await sleep(delayMs);

      let expansionsOccurred = false;

      for (const [listName, currentBound] of boundsTracker.entries()) {
        const totalAvailable = sync.getListData(listName)?.joinedCount ?? 0;

        if (currentBound < totalAvailable) {
          const expandedBound = currentBound + batchLimit;
          boundsTracker.set(listName, expandedBound);

          await this.enqueue(() => sync.setListRanges(listName, [[0, expandedBound]]));
          expansionsOccurred = true;
        }
      }

      if (!expansionsOccurred) {
        sync.off(SlidingSyncEvent.Lifecycle, handleSyncLifecycle as any);
        logger.debug('[SlidingSync] Background spidering complete.');
      }
    };

    sync.on(SlidingSyncEvent.Lifecycle, handleSyncLifecycle as any);
  }
}
