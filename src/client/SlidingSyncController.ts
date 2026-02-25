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

const INITIAL_SYNC_TIMEOUT_MS = 20000;

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

// IMPORTANT: Always request BASE_STATE_REQUIREMENTS for subscriptions.
// Your old UNENCRYPTED subscription did NOT include these, which can lead to
// missing/misaligned room state and weird UI behavior.
const SUBSCRIPTION_BASE = {
  timeline_limit: 50,
  required_state: BASE_STATE_REQUIREMENTS,
  include_old_rooms: {
    timeline_limit: 0,
    required_state: BASE_STATE_REQUIREMENTS,
  },
};

// Keep custom subscription support, but make them SAFE (include BASE_STATE_REQUIREMENTS).
const SUBSCRIPTIONS = {
  /**
   * Default subscription should be "safe + reasonably small":
   * - BASE_STATE_REQUIREMENTS (room metadata, encryption state, etc.)
   * - LAZY members so sender displaynames/avatars resolve as events arrive.
   */
  DEFAULT: {
    ...SUBSCRIPTION_BASE,
    required_state: [...BASE_STATE_REQUIREMENTS, [EventType.RoomMember, MSC3575_STATE_KEY_LAZY]],
  },

  /**
   * Unencrypted can also use lazy members, but MUST keep BASE_STATE_REQUIREMENTS.
   * (If you want to further reduce bandwidth for unencrypted rooms, do it with
   * timeline_limit or by trimming BASE_STATE_REQUIREMENTS, not by dropping it.)
   */
  UNENCRYPTED: {
    ...SUBSCRIPTION_BASE,
    required_state: [...BASE_STATE_REQUIREMENTS, [EventType.RoomMember, MSC3575_STATE_KEY_LAZY]],
  },

  /**
   * Encrypted rooms do NOT need wildcard required_state. That is extremely heavy.
   * Keep BASE_STATE_REQUIREMENTS + lazy members.
   */
  ENCRYPTED: {
    ...SUBSCRIPTION_BASE,
    required_state: [...BASE_STATE_REQUIREMENTS, [EventType.RoomMember, MSC3575_STATE_KEY_LAZY]],
  },
} as const;

const UNENCRYPTED_SUB_KEY = 'unencrypted_lazy_load';

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

  if (rooms.length > 0 && syncInstance) {
    const activeSubs = syncInstance.getRoomSubscriptions();
    rooms.forEach((id) => activeSubs.add(id));
    // This call is "void" typed in some versions, but does async work internally.
    syncInstance.modifyRoomSubscriptions(activeSubs);
    logger.debug(`[SlidingSync] Subscribed to ${rooms.length} global emote rooms.`);
  }
};

export class SlidingSyncController {
  public static isSupportedOnServer: boolean = false;

  private static instance: SlidingSyncController;

  public syncInstance?: SlidingSync;

  private matrixClient?: MatrixClient;
  private initializationResolve?: () => void;
  private initializationPromise: Promise<void>;

  // serialize mutations that can race (setListRanges, setList, modifyRoomSubscriptions, etc.)
  private op: Promise<void> = Promise.resolve();

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
    // keep the chain alive regardless of success/failure
    this.op = Promise.resolve(next).then(
      () => undefined,
      () => undefined
    );
    return Promise.resolve(next);
  }

  /**
   * Initializes the SlidingSync instance and triggers background list population.
   */
  public async initialize(client: MatrixClient): Promise<SlidingSync> {
    this.matrixClient = client;

    const configuredLists = new Map(Object.entries(INITIAL_LIST_CONFIGS));

    const sync = new SlidingSync(
      client.baseUrl,
      configuredLists,
      SUBSCRIPTIONS.DEFAULT,
      client,
      INITIAL_SYNC_TIMEOUT_MS
    );

    sync.addCustomSubscription(UNENCRYPTED_SUB_KEY, SUBSCRIPTIONS.UNENCRYPTED);

    this.syncInstance = sync;
    this.initializationResolve?.();

    logger.info(`[SlidingSync] Activated at ${client.baseUrl}`);

    this.executeBackgroundSpidering(sync, 100, 0);

    return sync;
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
          // IMPORTANT: include BASE_STATE_REQUIREMENTS here too
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
   */
  public async focusRoom(roomId: string): Promise<void> {
    await this.initializationPromise;

    const sync = this.syncInstance;
    const client = this.matrixClient;
    if (!sync || !client) return;

    // Snapshot subscriptions from the sync instance
    const subs = sync.getRoomSubscriptions();
    if (subs.has(roomId)) return;

    subs.add(roomId);

    const roomContext = client.getRoom(roomId);

    // Decide whether to use the unencrypted custom subscription
    const crypto = client.getCrypto();
    const isEncrypted = crypto ? await crypto.isEncryptionEnabledInRoom(roomId) : false;

    // Serialize all sync mutations (useCustomSubscription + modifyRoomSubscriptions)
    await this.enqueue(async () => {
      if (!isEncrypted) {
        sync.useCustomSubscription(roomId, UNENCRYPTED_SUB_KEY);
      }
      await sync.modifyRoomSubscriptions(subs);
    });

    // Wait for the JS SDK to emit the room if it's completely new to the client
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
   * Checks if the homeserver advertises native Simplified Sliding Sync support.
   */
  public async verifyServerSupport(client: MatrixClient): Promise<boolean> {
    const isSupported = await client?.doesServerSupportUnstableFeature(
      'org.matrix.simplified_msc3575'
    );
    SlidingSyncController.isSupportedOnServer = !!isSupported;

    if (isSupported) {
      logger.debug('[SlidingSync] Native org.matrix.simplified_msc3575 support detected.');
    }
    return SlidingSyncController.isSupportedOnServer;
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

          // Serialize list range updates to avoid racing other sync mutations
          await this.enqueue(() => sync.setListRanges(listName, [[0, expandedBound]]));

          expansionsOccurred = true;
        }
      }

      // Unsubscribe once all lists have fully paginated
      if (!expansionsOccurred) {
        sync.off(SlidingSyncEvent.Lifecycle, handleSyncLifecycle);
        logger.debug('[SlidingSync] Background spidering complete.');
      }
    };

    sync.on(SlidingSyncEvent.Lifecycle, handleSyncLifecycle);
  }
}
