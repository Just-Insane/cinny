/* eslint-disable react/destructuring-assignment */
import React, {
  Dispatch,
  MouseEventHandler,
  RefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Direction,
  EventTimeline,
  EventTimelineSet,
  EventTimelineSetHandlerMap,
  IContent,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomEvent,
  RoomEventHandlerMap,
} from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import classNames from 'classnames';
import { ReactEditor } from 'slate-react';
import { Editor } from 'slate';
import to from 'await-to-js';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  Badge,
  Box,
  Chip,
  ContainerColor,
  Icon,
  Icons,
  Line,
  Scroll,
  Text,
  as,
  color,
  config,
  toRem,
} from 'folds';
import { isKeyHotkey } from 'is-hotkey';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { useTranslation } from 'react-i18next';
import { eventWithShortcode, factoryEventSentBy, getMxIdLocalPart } from '../../utils/matrix';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useVirtualPaginator, ItemRange } from '../../hooks/useVirtualPaginator';
import { useAlive } from '../../hooks/useAlive';
import { editableActiveElement, scrollToBottom } from '../../utils/dom';
import {
  DefaultPlaceholder,
  CompactPlaceholder,
  Reply,
  MessageBase,
  MessageUnsupportedContent,
  Time,
  MessageNotDecryptedContent,
  RedactedContent,
  MSticker,
  ImageContent,
  EventContent,
} from '../../components/message';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../plugins/react-custom-html-parser';
import {
  canEditEvent,
  decryptAllTimelineEvent,
  getEditedEvent,
  getEventReactions,
  getLatestEditableEvt,
  getMemberDisplayName,
  getReactionContent,
  isMembershipChanged,
  reactionOrEditEvent,
} from '../../utils/room';
import { useSetting } from '../../state/hooks/settings';
import { MessageLayout, settingsAtom } from '../../state/settings';
import { useOpenUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { useMatrixEventRenderer } from '../../hooks/useMatrixEventRenderer';
import { Reactions, Message, Event, EncryptedContent } from './message';
import { useMemberEventParser } from '../../hooks/useMemberEventParser';
import * as customHtmlCss from '../../styles/CustomHtml.css';
import { RoomIntro } from '../../components/room-intro';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';
import { markAsRead } from '../../utils/notifications';
import { useDebounce } from '../../hooks/useDebounce';
import { getResizeObserverEntry, useResizeObserver } from '../../hooks/useResizeObserver';
import * as css from './RoomTimeline.css';
import { inSameDay, minuteDifference, timeDayMonthYear, today, yesterday } from '../../utils/time';
import { createMentionElement, isEmptyEditor, moveCursor } from '../../components/editor';
import { roomIdToReplyDraftAtomFamily } from '../../state/room/roomInputDrafts';
import { usePowerLevelsAPI, usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { GetContentCallback, MessageEvent, StateEvent } from '../../../types/matrix/room';
import { useKeyDown } from '../../hooks/useKeyDown';
import { useDocumentFocusChange } from '../../hooks/useDocumentFocusChange';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { Image } from '../../components/media';
import { ImageViewer } from '../../components/image-viewer';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { useMentionClickHandler } from '../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../hooks/useSpoilerClickHandler';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { useImagePackRooms } from '../../hooks/useImagePackRooms';
import { GetPowerLevelTag } from '../../hooks/usePowerLevelTags';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { useTheme } from '../../hooks/useTheme';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';

const TimelineFloat = as<'div', css.TimelineFloatVariants>(
  ({ position, className, ...props }, ref) => (
    <Box
      className={classNames(css.TimelineFloat({ position }), className)}
      justifyContent="Center"
      alignItems="Center"
      gap="200"
      {...props}
      ref={ref}
    />
  )
);

const TimelineDivider = as<'div', { variant?: ContainerColor | 'Inherit' }>(
  ({ variant, children, ...props }, ref) => (
    <Box gap="100" justifyContent="Center" alignItems="Center" {...props} ref={ref}>
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
      {children}
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
    </Box>
  )
);

export const getLiveTimeline = (room: Room): EventTimeline =>
  room.getUnfilteredTimelineSet().getLiveTimeline();

export const getEventTimeline = (room: Room, eventId: string): EventTimeline | undefined => {
  const timelineSet = room.getUnfilteredTimelineSet();
  return timelineSet.getTimelineForEvent(eventId) ?? undefined;
};

export const getFirstLinkedTimeline = (
  timeline: EventTimeline,
  direction: Direction
): EventTimeline => {
  const linkedTm = timeline.getNeighbouringTimeline(direction);
  if (!linkedTm) return timeline;
  return getFirstLinkedTimeline(linkedTm, direction);
};

export const getLinkedTimelines = (timeline: EventTimeline): EventTimeline[] => {
  const firstTimeline = getFirstLinkedTimeline(timeline, Direction.Backward);
  const timelines: EventTimeline[] = [];

  for (
    let nextTimeline: EventTimeline | null = firstTimeline;
    nextTimeline;
    nextTimeline = nextTimeline.getNeighbouringTimeline(Direction.Forward)
  ) {
    timelines.push(nextTimeline);
  }
  return timelines;
};

const compareTimelineEvents = (a: MatrixEvent, b: MatrixEvent) => {
  const at = a.getTs() ?? 0;
  const bt = b.getTs() ?? 0;
  if (at !== bt) return at - bt;

  // stable tie-breaker
  const aid = a.getId() ?? '';
  const bid = b.getId() ?? '';
  return aid.localeCompare(bid);
};

// ---- Stable React keys for message rows ------------------------------------
// Some events can temporarily not have an event_id (e.g. local echo) or can mutate in-place
// (decrypt/replaced/redaction). We need a stable key to keep React from reusing wrong nodes.
const getEventStableKey = (ev: MatrixEvent): string => {
  const id = ev.getId();
  if (id) return id;

  // txnId exists for local echoes in many SDK paths
  const txnId = (ev as any).getTxnId?.() as string | undefined;
  if (txnId) return `local:${txnId}`;

  // last-resort stable-ish fallback (won't be perfect but avoids index keys)
  const ts = ev.getTs() ?? 0;
  const sender = ev.getSender() ?? '';
  return `fallback:${sender}:${ts}:${ev.getType()}:${ev.getStateKey() ?? ''}`;
};

// ---- Cache invalidation ----------------------------------------------------
// Our sort cache is per EventTimeline (WeakMap). If events mutate in-place (decrypt/edit),
// length + "lastKey" can remain unchanged, so we must explicitly invalidate.
const invalidateTimelineSortedCache = (timelines: EventTimeline[]) => {
  for (const t of timelines) timelineSortedCache.delete(t);
};

// Cache per EventTimeline to avoid sorting on every render
const timelineSortedCache = new WeakMap<
  EventTimeline,
  { len: number; lastKey: string; events: MatrixEvent[] }
>();

const getTimelineEventsOrdered = (t: EventTimeline): MatrixEvent[] => {
  const evs = t.getEvents();
  const first = evs[0];
  const mid = evs[Math.floor(evs.length / 2)];
  const last = evs[evs.length - 1];

  const lastKey = [
    evs.length,
    first?.getId() ?? '',
    first?.getTs() ?? 0,
    mid?.getId() ?? '',
    mid?.getTs() ?? 0,
    last?.getId() ?? '',
    last?.getTs() ?? 0,
  ].join('|');

  const cached = timelineSortedCache.get(t);
  if (cached && cached.len === evs.length && cached.lastKey === lastKey) {
    return cached.events;
  }

  const ordered = [...evs].sort(compareTimelineEvents);
  timelineSortedCache.set(t, { len: evs.length, lastKey, events: ordered });
  return ordered;
};

export const timelineToEventsCount = (t: EventTimeline) => getTimelineEventsOrdered(t).length;
export const getTimelinesEventsCount = (timelines: EventTimeline[]): number => {
  const timelineEventCountReducer = (count: number, tm: EventTimeline) =>
    count + timelineToEventsCount(tm);
  return timelines.reduce(timelineEventCountReducer, 0);
};

export const getTimelineAndBaseIndex = (
  timelines: EventTimeline[],
  index: number
): [EventTimeline | undefined, number] => {
  let upto = 0;

  for (const t of timelines) {
    const ordered = getTimelineEventsOrdered(t);
    const len = ordered.length;

    if (index < upto + len) {
      return [t, upto];
    }
    upto += len;
  }

  return [undefined, 0];
};

export const getTimelineRelativeIndex = (absoluteIndex: number, timelineBaseIndex: number) =>
  absoluteIndex - timelineBaseIndex;

export const getTimelineEvent = (timeline: EventTimeline, index: number): MatrixEvent | undefined =>
  getTimelineEventsOrdered(timeline)[index];

export const getEventIdAbsoluteIndex = (
  timelines: EventTimeline[],
  eventTimeline: EventTimeline,
  eventId: string
): number | undefined => {
  const timelineIndex = timelines.findIndex((t) => t === eventTimeline);
  if (timelineIndex === -1) return undefined;

  const events = getTimelineEventsOrdered(eventTimeline);
  const eventIndex = events.findIndex((evt) => evt.getId() === eventId);
  if (eventIndex === -1) return undefined;

  const baseIndex = timelines
    .slice(0, timelineIndex)
    .reduce((accValue, timeline) => getTimelineEventsOrdered(timeline).length + accValue, 0);

  return baseIndex + eventIndex;
};

/**
 * NOTE: Virtualized renderers do not guarantee that items render strictly in order.
 * Any "previous item" logic must be computed deterministically from the absolute index.
 */
export const getPrevEventForIndex = (
  timelines: EventTimeline[],
  absoluteIndex: number
): MatrixEvent | undefined => {
  if (absoluteIndex <= 0) return undefined;
  const prevIndex = absoluteIndex - 1;
  const [prevTimeline, prevBaseIndex] = getTimelineAndBaseIndex(timelines, prevIndex);
  if (!prevTimeline) return undefined;
  return getTimelineEvent(prevTimeline, getTimelineRelativeIndex(prevIndex, prevBaseIndex));
};

type RoomTimelineProps = {
  room: Room;
  eventId?: string;
  roomInputRef: RefObject<HTMLElement>;
  editor: Editor;
  getPowerLevelTag: GetPowerLevelTag;
  accessibleTagColors: Map<string, string>;
};

const PAGINATION_LIMIT = 80;

type Timeline = {
  linkedTimelines: EventTimeline[];
  range: ItemRange;
};

const useEventTimelineLoader = (
  mx: MatrixClient,
  room: Room,
  onLoad: (eventId: string, linkedTimelines: EventTimeline[], evtAbsIndex: number) => void,
  onError: (err: Error | null) => void
) => {
  const loadEventTimeline = useCallback(
    async (eventId: string) => {
      const [err, replyEvtTimeline] = await to(
        mx.getEventTimeline(room.getUnfilteredTimelineSet(), eventId)
      );
      if (!replyEvtTimeline) {
        onError(err ?? null);
        return;
      }
      const linkedTimelines = getLinkedTimelines(replyEvtTimeline);
      const absIndex = getEventIdAbsoluteIndex(linkedTimelines, replyEvtTimeline, eventId);

      if (absIndex === undefined) {
        onError(err ?? null);
        return;
      }

      onLoad(eventId, linkedTimelines, absIndex);
    },
    [mx, room, onLoad, onError]
  );

  return loadEventTimeline;
};

const useTimelinePagination = (
  mx: MatrixClient,
  timeline: Timeline,
  setTimeline: Dispatch<SetStateAction<Timeline>>,
  limit: number
) => {
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const alive = useAlive();

  const handleTimelinePagination = useMemo(() => {
    let fetching = false;

    const recalibratePagination = (
      linkedTimelines: EventTimeline[],
      timelinesEventsCount: number[],
      backwards: boolean
    ) => {
      const topTimeline = linkedTimelines[0];
      const timelineMatch = (mt: EventTimeline) => (t: EventTimeline) => t === mt;

      const newLTimelines = getLinkedTimelines(topTimeline);
      const topTmIndex = newLTimelines.findIndex(timelineMatch(topTimeline));
      const topAddedTm = topTmIndex === -1 ? [] : newLTimelines.slice(0, topTmIndex);

      const topTmAddedEvt =
        timelineToEventsCount(newLTimelines[topTmIndex]) - timelinesEventsCount[0];
      const offsetRange = getTimelinesEventsCount(topAddedTm) + (backwards ? topTmAddedEvt : 0);

      setTimeline((currentTimeline) => ({
        linkedTimelines: newLTimelines,
        range:
          offsetRange > 0
            ? {
                start: currentTimeline.range.start + offsetRange,
                end: currentTimeline.range.end + offsetRange,
              }
            : { ...currentTimeline.range },
      }));
    };

    return async (backwards: boolean) => {
      if (fetching) return;

      const { linkedTimelines: lTimelines } = timelineRef.current;
      const timelinesEventsCount = lTimelines.map(timelineToEventsCount);

      const timelineToPaginate = backwards ? lTimelines[0] : lTimelines[lTimelines.length - 1];
      if (!timelineToPaginate) return;

      const paginationToken = timelineToPaginate.getPaginationToken(
        backwards ? Direction.Backward : Direction.Forward
      );

      if (
        !paginationToken &&
        getTimelinesEventsCount(lTimelines) !==
          getTimelinesEventsCount(getLinkedTimelines(timelineToPaginate))
      ) {
        recalibratePagination(lTimelines, timelinesEventsCount, backwards);
        return;
      }

      fetching = true;
      try {
        const [err] = await to(mx.paginateEventTimeline(timelineToPaginate, { backwards, limit }));
        if (err) {
          logger.warn('[RoomTimeline] pagination failed', err);
          return;
        }

        const fetchedTimeline =
          timelineToPaginate.getNeighbouringTimeline(
            backwards ? Direction.Backward : Direction.Forward
          ) ?? timelineToPaginate;

        // decrypt ahead of render cycle (don’t let errors wedge pagination)
        const roomId = fetchedTimeline.getRoomId();
        const r = roomId ? mx.getRoom(roomId) : null;
        if (r?.hasEncryptionStateEvent()) {
          await to(decryptAllTimelineEvent(mx, fetchedTimeline));
        }

        if (alive()) {
          recalibratePagination(lTimelines, timelinesEventsCount, backwards);
        }
      } finally {
        fetching = false;
      }
    };
  }, [mx, alive, setTimeline, limit]);
  return handleTimelinePagination;
};

const useLiveEventArrive = (room: Room, onArrive: (mEvent: MatrixEvent) => void) => {
  useEffect(() => {
    const handleTimelineEvent: EventTimelineSetHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      toStartOfTimeline,
      removed,
      data
    ) => {
      if (eventRoom?.roomId !== room.roomId) return;
      if (removed) return;
      // Sliding Sync and some JS-SDK versions do not always set `data.liveEvent`.
      // Treat events as live unless the SDK explicitly marks them as non-live.
      const isExplicitlyNotLive =
        !!data && 'liveEvent' in (data as any) && (data as any).liveEvent === false;
      if (isExplicitlyNotLive) return;
      if (toStartOfTimeline) return;
      onArrive(mEvent);
    };
    const handleRedaction: RoomEventHandlerMap[RoomEvent.Redaction] = (mEvent, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return;
      onArrive(mEvent);
    };

    room.on(RoomEvent.Timeline, handleTimelineEvent);
    room.on(RoomEvent.Redaction, handleRedaction);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimelineEvent);
      room.removeListener(RoomEvent.Redaction, handleRedaction);
    };
  }, [room, onArrive]);
};

const useLiveTimelineRefresh = (room: Room, onRefresh: () => void) => {
  useEffect(() => {
    const handleTimelineRefresh: RoomEventHandlerMap[RoomEvent.TimelineRefresh] = (r) => {
      if (r.roomId !== room.roomId) return;
      onRefresh();
    };

    // Some SDK versions also emit TimelineReset; treat it like a refresh.
    // @ts-expect-error - TimelineReset may not exist in all sdk versions
    const handleTimelineReset: RoomEventHandlerMap[RoomEvent.TimelineRefresh] = (r) => {
      if ((r as any).roomId !== room.roomId) return;
      onRefresh();
    };

    room.on(RoomEvent.TimelineRefresh, handleTimelineRefresh);
    // @ts-expect-error - TimelineReset may not exist in all sdk versions
    room.on(RoomEvent.TimelineReset, handleTimelineReset);

    return () => {
      room.removeListener(RoomEvent.TimelineRefresh, handleTimelineRefresh);
      // @ts-expect-error - TimelineReset may not exist in all sdk versions
      room.removeListener(RoomEvent.TimelineReset, handleTimelineReset);
    };
  }, [room, onRefresh]);
};

const getInitialTimeline = (room: Room) => {
  const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
  const evLength = getTimelinesEventsCount(linkedTimelines);
  return {
    linkedTimelines,
    range: {
      start: Math.max(evLength - PAGINATION_LIMIT, 0),
      end: evLength,
    },
  };
};

const getEmptyTimeline = () => ({
  range: { start: 0, end: 0 },
  linkedTimelines: [],
});

const getRoomUnreadInfo = (room: Room, scrollTo = false) => {
  const readUptoEventId = room.getEventReadUpTo(room.client.getUserId() ?? '');
  if (!readUptoEventId) return undefined;
  const evtTimeline = getEventTimeline(room, readUptoEventId);
  const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
  return {
    readUptoEventId,
    inLiveTimeline: latestTimeline === room.getLiveTimeline(),
    scrollTo,
  };
};

export function RoomTimeline({
  room,
  eventId,
  roomInputRef,
  editor,
  getPowerLevelTag,
  accessibleTagColors,
}: RoomTimelineProps) {
  const mx = useMatrixClient();
  const { t } = useTranslation();
  const useAuthentication = useMediaAuthentication();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const [messageLayout] = useSetting(settingsAtom, 'messageLayout');
  const [messageSpacing] = useSetting(settingsAtom, 'messageSpacing');
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
  const direct = useIsDirectRoom();
  const [hideMembershipEvents] = useSetting(settingsAtom, 'hideMembershipEvents');
  const [hideNickAvatarEvents] = useSetting(settingsAtom, 'hideNickAvatarEvents');
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  const showUrlPreview = room.hasEncryptionStateEvent() ? encUrlPreview : urlPreview;
  const [showHiddenEvents] = useSetting(settingsAtom, 'showHiddenEvents');
  const [showDeveloperTools] = useSetting(settingsAtom, 'developerTools');

  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const ignoredUsersList = useIgnoredUsers();
  const ignoredUsersSet = useMemo(() => new Set(ignoredUsersList), [ignoredUsersList]);

  const setReplyDraft = useSetAtom(roomIdToReplyDraftAtomFamily(room.roomId));
  const powerLevels = usePowerLevelsContext();
  const { canDoAction, canSendEvent, canSendStateEvent, getPowerLevel } =
    usePowerLevelsAPI(powerLevels);
  const getMemberPowerTag = useCallback(
    (userId: string) => getPowerLevelTag(getPowerLevel(userId)),
    [getPowerLevel, getPowerLevelTag]
  );

  const creators = useRoomCreators(room);
  const myPowerLevel = getPowerLevel(mx.getUserId() ?? '');
  const creatorsTag = useRoomCreatorsTag();
  const powerLevelTags = usePowerLevelTags(room, powerLevels);

  const theme = useTheme();
  const accessiblePowerTagColors = useAccessiblePowerTagColors(
    theme.kind,
    creatorsTag,
    powerLevelTags
  );

  const permissions = useRoomPermissions(creators, powerLevels);

  const canRedact = permissions.action('redact', mx.getSafeUserId());
  const canDeleteOwn = permissions.event(MessageEvent.RoomRedaction, mx.getSafeUserId());
  const canSendReaction = permissions.event(MessageEvent.Reaction, mx.getSafeUserId());
  const canPinEvent = permissions.stateEvent(StateEvent.RoomPinnedEvents, mx.getSafeUserId());
  const [editId, setEditId] = useState<string>();

  const roomToParents = useAtomValue(roomToParentsAtom);
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const { navigateRoom } = useRoomNavigate();
  const mentionClickHandler = useMentionClickHandler(room.roomId);
  const spoilerClickHandler = useSpoilerClickHandler();
  const openUserRoomProfile = useOpenUserRoomProfile();
  const space = useSpaceOptionally();

  const imagePackRooms: Room[] = useImagePackRooms(room.roomId, roomToParents);

  const [unreadInfo, setUnreadInfo] = useState(() => getRoomUnreadInfo(room, true));
  const readUptoEventIdRef = useRef<string>();
  if (unreadInfo) {
    readUptoEventIdRef.current = unreadInfo.readUptoEventId;
  }

  const atBottomAnchorRef = useRef<HTMLElement>(null);
  const [atBottom, setAtBottom] = useState<boolean>(true);
  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef({
    count: 0,
    smooth: true,
  });

  const [focusItem, setFocusItem] = useState<
    | {
        index: number;
        scrollTo: boolean;
        highlight: boolean;
      }
    | undefined
  >();
  const alive = useAlive();

  const linkifyOpts = useMemo<LinkifyOpts>(
    () => ({
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention((href) =>
        renderMatrixMention(mx, room.roomId, href, makeMentionCustomProps(mentionClickHandler))
      ),
    }),
    [mx, room, mentionClickHandler]
  );
  const htmlReactParserOptions = useMemo<HTMLReactParserOptions>(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, {
        linkifyOpts,
        useAuthentication,
        handleSpoilerClick: spoilerClickHandler,
        handleMentionClick: mentionClickHandler,
      }),
    [mx, room, linkifyOpts, spoilerClickHandler, mentionClickHandler, useAuthentication]
  );
  const parseMemberEvent = useMemberEventParser();

  const [timeline, setTimeline] = useState<Timeline>(() =>
    eventId ? getEmptyTimeline() : getInitialTimeline(room)
  );

  const [timelineVersion, setTimelineVersion] = useState(0);

  // Stable absolute index for the "New Messages" divider (the first event AFTER read-up-to).
  // This avoids misplacement when timelines are stitched/refreshed and events are inserted.

  const eventsLength = useMemo(
    () => getTimelinesEventsCount(timeline.linkedTimelines),
    [timeline.linkedTimelines, timelineVersion]
  );

  const readMarkerAbsIndex = useMemo(() => {
    const readUpToId = unreadInfo?.readUptoEventId;
    if (!readUpToId) return undefined;

    const evtTimeline = getEventTimeline(room, readUpToId);
    if (!evtTimeline) return undefined;

    return getEventIdAbsoluteIndex(timeline.linkedTimelines, evtTimeline, readUpToId);
  }, [room, timeline.linkedTimelines, unreadInfo?.readUptoEventId, timelineVersion]);

  const liveTimelineLinked =
    timeline.linkedTimelines[timeline.linkedTimelines.length - 1] === getLiveTimeline(room);
  const canPaginateBack =
    typeof timeline.linkedTimelines[0]?.getPaginationToken(Direction.Backward) === 'string';
  const rangeAtStart = timeline.range.start === 0;
  const rangeAtEnd = timeline.range.end === eventsLength;
  const atLiveEndRef = useRef(liveTimelineLinked && rangeAtEnd);
  atLiveEndRef.current = liveTimelineLinked && rangeAtEnd;

  const handleTimelinePagination = useTimelinePagination(
    mx,
    timeline,
    setTimeline,
    PAGINATION_LIMIT
  );

  // Any time events can mutate without changing list length (decrypt/edit/redaction),
  // bump this to force derived calculations + virtual list to refresh.
  const linkedTimelinesRef = useRef<EventTimeline[]>(timeline.linkedTimelines);

  // keep ref updated (no TDZ)
  useEffect(() => {
    linkedTimelinesRef.current = timeline.linkedTimelines;
  }, [timeline.linkedTimelines]);

  const bumpTimelineVersion = useCallback(() => {
    // invalidate sort cache for current stitched timelines
    invalidateTimelineSortedCache(linkedTimelinesRef.current);
    setTimelineVersion((v) => v + 1);
  }, []);

  const getScrollElement = useCallback(() => scrollRef.current, []);

  // iOS PWA: when restoring from background / push-open / BFCache,
  // force a re-stitch of linked timelines + range to avoid blank timelines.
  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          bumpTimelineVersion();
          setTimeline((ct) => {
            const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
            const evLength = getTimelinesEventsCount(linkedTimelines);

            if (atBottomRef.current) {
              return {
                linkedTimelines,
                range: { start: Math.max(evLength - PAGINATION_LIMIT, 0), end: evLength },
              };
            }

            return {
              linkedTimelines,
              range: {
                start: Math.min(ct.range.start, evLength),
                end: Math.min(ct.range.end, evLength),
              },
            };
          });

          if (atBottomRef.current) {
            scrollToBottomRef.current.count += 1;
            scrollToBottomRef.current.smooth = false;
          }
        });
      });
    };

    window.addEventListener('pageshow', onResume);
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);

    return () => {
      window.removeEventListener('pageshow', onResume);
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [room]);

  const { getItems, scrollToItem, scrollToElement, observeBackAnchor, observeFrontAnchor } =
    useVirtualPaginator({
      count: eventsLength,
      limit: PAGINATION_LIMIT,
      range: timeline.range,
      onRangeChange: useCallback((r) => setTimeline((cs) => ({ ...cs, range: r })), []),
      getScrollElement,
      getItemElement: useCallback((index: number) => {
        const root = scrollRef.current;
        if (!root) return undefined;

        for (let i = index; i >= Math.max(0, index - 50); i -= 1) {
          const el = root.querySelector(`[data-message-item="${i}"]`) as HTMLElement | null;
          if (el) return el;
        }
        return undefined;
      }, []),
      onEnd: handleTimelinePagination,
    });

  const loadEventTimeline = useEventTimelineLoader(
    mx,
    room,
    useCallback(
      (evtId, lTimelines, evtAbsIndex) => {
        if (!alive()) return;
        const evLength = getTimelinesEventsCount(lTimelines);

        setFocusItem({
          index: evtAbsIndex,
          scrollTo: true,
          highlight: evtId !== readUptoEventIdRef.current,
        });
        setTimeline({
          linkedTimelines: lTimelines,
          range: {
            start: Math.max(evtAbsIndex - PAGINATION_LIMIT, 0),
            end: Math.min(evtAbsIndex + PAGINATION_LIMIT, evLength),
          },
        });
      },
      [alive]
    ),
    useCallback(() => {
      if (!alive()) return;
      setTimeline(getInitialTimeline(room));
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
    }, [alive, room])
  );

  const seenEventsRef = useRef(new WeakSet<MatrixEvent>());

  useLiveEventArrive(
    room,
    useCallback(
      (mEvt: MatrixEvent) => {
        // Attach mutation listeners once per MatrixEvent object:
        if (!seenEventsRef.current.has(mEvt)) {
          seenEventsRef.current.add(mEvt);

          const bump = () => bumpTimelineVersion();

          // Use string event names to avoid sdk enum/version mismatches
          try {
            (mEvt as any).on?.('Event.decrypted', bump);
            (mEvt as any).on?.('Event.replaced', bump);
            (mEvt as any).on?.('Event.redaction', bump);
          } catch {
            // ignore listener attachment issues
          }
        }

        // Any new live event implies timelines can change; invalidate + bump
        bumpTimelineVersion();

        // Keep our view of linked timelines in sync with the Room's live timeline.
        const refreshFromRoom = () => getLinkedTimelines(getLiveTimeline(room));

        if (atBottomRef.current) {
          if (document.hasFocus() && (!unreadInfo || mEvt.getSender() === mx.getUserId())) {
            requestAnimationFrame(() => markAsRead(mx, mEvt.getRoomId()!, hideActivity));
          }

          if (!document.hasFocus() && !unreadInfo) {
            setUnreadInfo(getRoomUnreadInfo(room));
          }

          scrollToBottomRef.current.count += 1;
          scrollToBottomRef.current.smooth = true;

          setTimeline(getInitialTimeline(room));
          return;
        }

        // Not at bottom: still refresh linked timelines, but keep range.
        setTimeline((ct) => ({
          linkedTimelines: refreshFromRoom(),
          range: { ...ct.range },
        }));

        if (!unreadInfo) {
          setUnreadInfo(getRoomUnreadInfo(room));
        }
      },
      [mx, room, unreadInfo, hideActivity, bumpTimelineVersion]
    )
  );

  const handleOpenEvent = useCallback(
    async (
      evtId: string,
      highlight = true,
      onScroll: ((scrolled: boolean) => void) | undefined = undefined
    ) => {
      const evtTimeline = getEventTimeline(room, evtId);
      const absoluteIndex =
        evtTimeline && getEventIdAbsoluteIndex(timeline.linkedTimelines, evtTimeline, evtId);

      if (typeof absoluteIndex === 'number') {
        const scrolled = scrollToItem(absoluteIndex, {
          behavior: 'smooth',
          align: 'center',
          stopInView: true,
        });
        if (onScroll) onScroll(scrolled);
        setFocusItem({
          index: absoluteIndex,
          scrollTo: false,
          highlight,
        });
      } else {
        setTimeline(getEmptyTimeline());
        loadEventTimeline(evtId);
      }
    },
    [room, timeline, scrollToItem, loadEventTimeline]
  );

  useLiveTimelineRefresh(
    room,
    useCallback(() => {
      bumpTimelineVersion();

      if (atBottomRef.current) {
        setTimeline(getInitialTimeline(room));
        scrollToBottomRef.current.count += 1;
        scrollToBottomRef.current.smooth = false;
        return;
      }

      setTimeline((ct) => {
        const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
        const evLength = getTimelinesEventsCount(linkedTimelines);
        return {
          linkedTimelines,
          range: {
            start: Math.min(ct.range.start, evLength),
            end: Math.min(ct.range.end, evLength),
          },
        };
      });
    }, [room, bumpTimelineVersion])
  );

  useResizeObserver(
    useMemo(() => {
      let mounted = false;
      return (entries) => {
        if (!mounted) {
          // skip initial mounting call
          mounted = true;
          return;
        }
        if (!roomInputRef.current) return;
        const editorBaseEntry = getResizeObserverEntry(roomInputRef.current, entries);
        const scrollElement = getScrollElement();
        if (!editorBaseEntry || !scrollElement) return;

        if (atBottomRef.current) {
          scrollToBottom(scrollElement);
        }
      };
    }, [getScrollElement, roomInputRef]),
    useCallback(() => roomInputRef.current, [roomInputRef])
  );

  const tryAutoMarkAsRead = useCallback(() => {
    const readUptoEventId = readUptoEventIdRef.current;
    if (!readUptoEventId) {
      requestAnimationFrame(() => markAsRead(mx, room.roomId, hideActivity));
      return;
    }
    const evtTimeline = getEventTimeline(room, readUptoEventId);
    const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
    if (latestTimeline === room.getLiveTimeline()) {
      requestAnimationFrame(() => markAsRead(mx, room.roomId, hideActivity));
    }
  }, [mx, room, hideActivity]);

  const debounceSetAtBottom = useDebounce(
    useCallback((entry: IntersectionObserverEntry) => {
      if (!entry.isIntersecting) setAtBottom(false);
    }, []),
    { wait: 1000 }
  );
  useIntersectionObserver(
    useCallback(
      (entries) => {
        const target = atBottomAnchorRef.current;
        if (!target) return;
        const targetEntry = getIntersectionObserverEntry(target, entries);
        if (targetEntry) debounceSetAtBottom(targetEntry);
        if (targetEntry?.isIntersecting && atLiveEndRef.current) {
          setAtBottom(true);
          if (document.hasFocus()) {
            tryAutoMarkAsRead();
          }
        }
      },
      [debounceSetAtBottom, tryAutoMarkAsRead]
    ),
    useCallback(
      () => ({
        root: getScrollElement(),
        rootMargin: '100px',
      }),
      [getScrollElement]
    ),
    useCallback(() => atBottomAnchorRef.current, [])
  );

  useDocumentFocusChange(
    useCallback(
      (inFocus) => {
        if (inFocus && atBottomRef.current) {
          if (unreadInfo?.inLiveTimeline) {
            handleOpenEvent(unreadInfo.readUptoEventId, false, (scrolled) => {
              // the unread event is already in view
              // so, try mark as read;
              if (!scrolled) {
                tryAutoMarkAsRead();
              }
            });
            return;
          }
          tryAutoMarkAsRead();
        }
      },
      [tryAutoMarkAsRead, unreadInfo, handleOpenEvent]
    )
  );

  // Handle up arrow edit
  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (
          isKeyHotkey('arrowup', evt) &&
          editableActiveElement() &&
          document.activeElement?.getAttribute('data-editable-name') === 'RoomInput' &&
          isEmptyEditor(editor)
        ) {
          const editableEvt = getLatestEditableEvt(room.getLiveTimeline(), (mEvt) =>
            canEditEvent(mx, mEvt)
          );
          const editableEvtId = editableEvt?.getId();
          if (!editableEvtId) return;
          setEditId(editableEvtId);
          evt.preventDefault();
        }
      },
      [mx, room, editor]
    )
  );

  useEffect(() => {
    if (eventId) {
      setTimeline(getEmptyTimeline());
      loadEventTimeline(eventId);
    }
  }, [eventId, loadEventTimeline]);

  // Scroll to bottom on initial timeline load
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollToBottom(scrollEl);
    }
  }, []);

  // if live timeline is linked and unreadInfo change
  // Scroll to last read message
  useLayoutEffect(() => {
    const { readUptoEventId, inLiveTimeline, scrollTo } = unreadInfo ?? {};
    if (readUptoEventId && inLiveTimeline && scrollTo) {
      const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
      const evtTimeline = getEventTimeline(room, readUptoEventId);
      const absoluteIndex =
        evtTimeline && getEventIdAbsoluteIndex(linkedTimelines, evtTimeline, readUptoEventId);
      if (typeof absoluteIndex === 'number') {
        scrollToItem(absoluteIndex, {
          behavior: 'instant',
          align: 'start',
          stopInView: true,
        });
      }
    }
  }, [room, unreadInfo, scrollToItem]);

  // scroll to focused message
  useLayoutEffect(() => {
    if (focusItem && focusItem.scrollTo) {
      scrollToItem(focusItem.index, {
        behavior: 'instant',
        align: 'center',
        stopInView: true,
      });
    }

    setTimeout(() => {
      if (!alive()) return;
      setFocusItem((currentItem) => {
        if (currentItem === focusItem) return undefined;
        return currentItem;
      });
    }, 2000);
  }, [alive, focusItem, scrollToItem]);

  // scroll to bottom of timeline
  const scrollToBottomCount = scrollToBottomRef.current.count;
  useLayoutEffect(() => {
    if (scrollToBottomCount > 0) {
      const scrollEl = scrollRef.current;
      if (scrollEl)
        scrollToBottom(scrollEl, scrollToBottomRef.current.smooth ? 'smooth' : 'instant');
    }
  }, [scrollToBottomCount]);

  // Remove unreadInfo on mark as read
  useEffect(() => {
    if (!unread) {
      setUnreadInfo(undefined);
    }
  }, [unread]);

  const handleEdit = useCallback(
    (editEvtId?: string) => {
      if (editEvtId) {
        setEditId(editEvtId);
        return;
      }
      setEditId(undefined);
      ReactEditor.focus(editor);
    },
    [editor]
  );

  useEffect(() => {
    if (editId) {
      const editMsgElement =
        (scrollRef.current?.querySelector(`[data-message-id="${editId}"]`) as HTMLElement) ??
        undefined;
      if (editMsgElement) {
        scrollToElement(editMsgElement, {
          align: 'center',
          behavior: 'smooth',
          stopInView: true,
        });
      }
    }
  }, [scrollToElement, editId]);

  const handleJumpToLatest = () => {
    if (eventId) {
      navigateRoom(room.roomId, undefined, { replace: true });
    }
    setTimeline(getInitialTimeline(room));
    scrollToBottomRef.current.count += 1;
    scrollToBottomRef.current.smooth = false;
  };

  const handleJumpToUnread = () => {
    if (unreadInfo?.readUptoEventId) {
      setTimeline(getEmptyTimeline());
      loadEventTimeline(unreadInfo.readUptoEventId);
    }
  };

  const handleMarkAsRead = () => {
    markAsRead(mx, room.roomId, hideActivity);
  };

  const handleOpenReply: MouseEventHandler = useCallback(
    async (evt) => {
      const targetId = evt.currentTarget.getAttribute('data-event-id');
      if (!targetId) return;
      handleOpenEvent(targetId);
    },
    [handleOpenEvent]
  );

  const handleUserClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const userId = evt.currentTarget.getAttribute('data-user-id');
      if (!userId) {
        console.warn('Button should have "data-user-id" attribute!');
        return;
      }
      openUserRoomProfile(
        room.roomId,
        undefined,
        userId,
        evt.currentTarget.getBoundingClientRect()
      );
    },
    [openUserRoomProfile, room.roomId]
  );
  const handleUsernameClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt) => {
      evt.preventDefault();
      const userId = evt.currentTarget.getAttribute('data-user-id');
      if (!userId) {
        console.warn('Button should have "data-user-id" attribute!');
        return;
      }
      const name = getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
      editor.insertNode(
        createMentionElement(
          userId,
          name.startsWith('@') ? name : `@${name}`,
          userId === mx.getUserId()
        )
      );
      ReactEditor.focus(editor);
      moveCursor(editor);
    },
    [mx, room, editor]
  );

  const handleReplyClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt, startThread = false) => {
      const replyId = evt.currentTarget.getAttribute('data-event-id');
      if (!replyId) {
        console.warn('Button should have "data-event-id" attribute!');
        return;
      }
      const replyEvt = room.findEventById(replyId);
      if (!replyEvt) return;
      const editedReply = getEditedEvent(replyId, replyEvt, room.getUnfilteredTimelineSet());
      const content: IContent = editedReply?.getContent()['m.new_content'] ?? replyEvt.getContent();
      const { body, formatted_body: formattedBody } = content;
      const { 'm.relates_to': relation } = startThread
        ? { 'm.relates_to': { rel_type: 'm.thread', event_id: replyId } }
        : replyEvt.getWireContent();
      const senderId = replyEvt.getSender();
      if (senderId && typeof body === 'string') {
        setReplyDraft({
          userId: senderId,
          eventId: replyId,
          body,
          formattedBody,
          relation,
        });
        setTimeout(() => ReactEditor.focus(editor), 100);
      }
    },
    [room, setReplyDraft, editor]
  );

  const handleReactionToggle = useCallback(
    (targetEventId: string, key: string, shortcode?: string) => {
      const relations = getEventReactions(room.getUnfilteredTimelineSet(), targetEventId);
      const allReactions = relations?.getSortedAnnotationsByKey() ?? [];
      const [, reactionsSet] = allReactions.find(([k]) => k === key) ?? [];
      const reactions = reactionsSet ? Array.from(reactionsSet) : [];
      const myReaction = reactions.find(factoryEventSentBy(mx.getUserId()!));

      if (myReaction && !!myReaction?.isRelation()) {
        mx.redactEvent(room.roomId, myReaction.getId()!);
        return;
      }
      const rShortcode =
        shortcode ||
        (reactions.find(eventWithShortcode)?.getContent().shortcode as string | undefined);
      mx.sendEvent(
        room.roomId,
        MessageEvent.Reaction as any,
        getReactionContent(targetEventId, key, rShortcode)
      );
    },
    [mx, room]
  );

  const renderMatrixEvent = useMatrixEventRenderer<
    [string, MatrixEvent, number, EventTimelineSet, boolean]
  >(
    {
      [MessageEvent.RoomMessage]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
        const hasReactions = reactions && reactions.length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;

        const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
        const getContent = (() =>
          editedEvent?.getContent()['m.new_content'] ?? mEvent.getContent()) as GetContentCallback;

        const senderId = mEvent.getSender() ?? '';
        const senderPowerLevel = getPowerLevel(mEvent.getSender());
        const senderDisplayName =
          getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;

        return (
          <Message
            key={getEventStableKey(mEvent)}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            edit={editId === mEventId}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            onEditId={handleEdit}
            reply={
              replyEventId && (
                <Reply
                  room={room}
                  timelineSet={timelineSet}
                  replyEventId={replyEventId}
                  threadRootId={threadRootId}
                  onClick={handleOpenReply}
                  getMemberPowerTag={getMemberPowerTag}
                  accessibleTagColors={accessiblePowerTagColors}
                  legacyUsernameColor={legacyUsernameColor || direct}
                />
              )
            }
            reactions={
              reactionRelations && (
                <Reactions
                  style={{ marginTop: config.space.S200 }}
                  room={room}
                  relations={reactionRelations}
                  mEventId={mEventId}
                  canSendReaction={canSendReaction}
                  onReactionToggle={handleReactionToggle}
                />
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            powerLevelTag={getPowerLevelTag(senderPowerLevel)}
            accessibleTagColors={accessibleTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            {mEvent.isRedacted() ? (
              <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
            ) : (
              <RenderMessageContent
                displayName={senderDisplayName}
                msgType={mEvent.getContent().msgtype ?? ''}
                ts={mEvent.getTs()}
                edited={!!editedEvent}
                getContent={getContent}
                mediaAutoLoad={mediaAutoLoad}
                urlPreview={showUrlPreview}
                htmlReactParserOptions={htmlReactParserOptions}
                linkifyOpts={linkifyOpts}
                outlineAttachment={messageLayout === MessageLayout.Bubble}
              />
            )}
          </Message>
        );
      },
      [MessageEvent.RoomMessageEncrypted]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
        const hasReactions = reactions && reactions.length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderPowerLevel = getPowerLevel(mEvent.getSender());

        return (
          <Message
            key={getEventStableKey(mEvent)}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            edit={editId === mEventId}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            onEditId={handleEdit}
            reply={
              replyEventId && (
                <Reply
                  room={room}
                  timelineSet={timelineSet}
                  replyEventId={replyEventId}
                  threadRootId={threadRootId}
                  onClick={handleOpenReply}
                  getMemberPowerTag={getMemberPowerTag}
                  accessibleTagColors={accessiblePowerTagColors}
                  legacyUsernameColor={legacyUsernameColor || direct}
                />
              )
            }
            reactions={
              reactionRelations && (
                <Reactions
                  style={{ marginTop: config.space.S200 }}
                  room={room}
                  relations={reactionRelations}
                  mEventId={mEventId}
                  canSendReaction={canSendReaction}
                  onReactionToggle={handleReactionToggle}
                />
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            powerLevelTag={getPowerLevelTag(senderPowerLevel)}
            accessibleTagColors={accessibleTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            <EncryptedContent mEvent={mEvent}>
              {() => {
                if (mEvent.isRedacted()) return <RedactedContent />;
                if (mEvent.getType() === MessageEvent.Sticker)
                  return (
                    <MSticker
                      content={mEvent.getContent()}
                      renderImageContent={(props) => (
                        <ImageContent
                          {...props}
                          autoPlay={mediaAutoLoad}
                          renderImage={(p) => <Image {...p} loading="lazy" />}
                          renderViewer={(p) => <ImageViewer {...p} />}
                        />
                      )}
                    />
                  );
                if (mEvent.getType() === MessageEvent.RoomMessage) {
                  const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
                  const getContent = (() =>
                    editedEvent?.getContent()['m.new_content'] ??
                    mEvent.getContent()) as GetContentCallback;

                  const senderId = mEvent.getSender() ?? '';
                  const senderPowerLevel = getPowerLevel(mEvent.getSender());
                  const senderDisplayName =
                    getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
                  return (
                    <RenderMessageContent
                      displayName={senderDisplayName}
                      msgType={mEvent.getContent().msgtype ?? ''}
                      ts={mEvent.getTs()}
                      edited={!!editedEvent}
                      getContent={getContent}
                      mediaAutoLoad={mediaAutoLoad}
                      urlPreview={showUrlPreview}
                      htmlReactParserOptions={htmlReactParserOptions}
                      linkifyOpts={linkifyOpts}
                      outlineAttachment={messageLayout === MessageLayout.Bubble}
                    />
                  );
                }
                if (mEvent.getType() === MessageEvent.RoomMessageEncrypted)
                  return (
                    <Text>
                      <MessageNotDecryptedContent />
                    </Text>
                  );
                return (
                  <Text>
                    <MessageUnsupportedContent />
                  </Text>
                );
              }}
            </EncryptedContent>
          </Message>
        );
      },
      [MessageEvent.Sticker]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
        const hasReactions = reactions && reactions.length > 0;
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderPowerLevel = getPowerLevel(mEvent.getSender());

        return (
          <Message
            key={getEventStableKey(mEvent)}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            reactions={
              reactionRelations && (
                <Reactions
                  style={{ marginTop: config.space.S200 }}
                  room={room}
                  relations={reactionRelations}
                  mEventId={mEventId}
                  canSendReaction={canSendReaction}
                  onReactionToggle={handleReactionToggle}
                />
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            powerLevelTag={getPowerLevelTag(senderPowerLevel)}
            accessibleTagColors={accessibleTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            {mEvent.isRedacted() ? (
              <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
            ) : (
              <MSticker
                content={mEvent.getContent()}
                renderImageContent={(props) => (
                  <ImageContent
                    {...props}
                    autoPlay={mediaAutoLoad}
                    renderImage={(p) => <Image {...p} loading="lazy" />}
                    renderViewer={(p) => <ImageViewer {...p} />}
                  />
                )}
              />
            )}
          </Message>
        );
      },
      [StateEvent.RoomMember]: (mEventId, mEvent, item) => {
        const membershipChanged = isMembershipChanged(mEvent);
        if (membershipChanged && hideMembershipEvents) return null;
        if (!membershipChanged && hideNickAvatarEvents) return null;

        const highlighted = focusItem?.index === item && focusItem.highlight;
        const parsed = parseMemberEvent(mEvent);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={getEventStableKey(mEvent)}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={parsed.icon}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    {parsed.body}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomName]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={getEventStableKey(mEvent)}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={Icons.Hash}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {t('Organisms.RoomCommon.changed_room_name')}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomTopic]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={getEventStableKey(mEvent)}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={Icons.Hash}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {' changed room topic'}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomAvatar]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={getEventStableKey(mEvent)}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={Icons.Hash}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {' changed room avatar'}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
    },
    (mEventId, mEvent, item) => {
      if (!showHiddenEvents) return null;
      const highlighted = focusItem?.index === item && focusItem.highlight;
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={getEventStableKey(mEvent)}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Code}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <b>{senderName}</b>
                  {' sent '}
                  <code className={customHtmlCss.Code}>{mEvent.getType()}</code>
                  {' state event'}
                </Text>
              </Box>
            }
          />
        </Event>
      );
    },
    (mEventId, mEvent, item) => {
      if (!showHiddenEvents) return null;
      if (Object.keys(mEvent.getContent()).length === 0) return null;
      if (mEvent.getRelation()) return null;
      if (mEvent.isRedaction()) return null;

      const highlighted = focusItem?.index === item && focusItem.highlight;
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={getEventStableKey(mEvent)}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Code}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <b>{senderName}</b>
                  {' sent '}
                  <code className={customHtmlCss.Code}>{mEvent.getType()}</code>
                  {' event'}
                </Text>
              </Box>
            }
          />
        </Event>
      );
    }
  );

  const eventRenderer = (item: number) => {
    const [eventTimeline, baseIndex] = getTimelineAndBaseIndex(timeline.linkedTimelines, item);
    if (!eventTimeline) return null;
    const timelineSet = eventTimeline?.getTimelineSet();
    const mEvent = getTimelineEvent(eventTimeline, getTimelineRelativeIndex(item, baseIndex));
    const mEventId = mEvent?.getId();
    if (!mEvent) return null;

    // keep stable rendering even if event_id isn't present yet
    const stableKey = getEventStableKey(mEvent);

    const eventSender = mEvent.getSender();
    if (eventSender && ignoredUsersSet.has(eventSender)) {
      return null;
    }
    if (mEvent.isRedacted() && !showHiddenEvents) {
      return null;
    }

    // Deterministic adjacency: derive "previous event" from absolute index, not render order.
    const prevEvent = getPrevEventForIndex(timeline.linkedTimelines, item);
    const newDivider = typeof readMarkerAbsIndex === 'number' && item === readMarkerAbsIndex + 1;

    const prevTs = prevEvent?.getTs();
    const curTs = mEvent.getTs();

    const hasTs = typeof prevTs === 'number' && typeof curTs === 'number';

    // Guard UI grouping against time going backwards OR missing timestamps.
    const tsBackwards = hasTs ? prevTs > curTs : false;

    const dayDivider = !!prevEvent && hasTs && !tsBackwards && !inSameDay(prevTs, curTs);

    const collapsed =
      !!prevEvent &&
      hasTs &&
      !dayDivider &&
      !tsBackwards &&
      (!newDivider || eventSender === mx.getUserId()) &&
      prevEvent.getSender() === eventSender &&
      prevEvent.getType() === mEvent.getType() &&
      minuteDifference(prevTs, curTs) < 2;

    const eventJSX = reactionOrEditEvent(mEvent)
      ? null
      : renderMatrixEvent(
          mEvent.getType(),
          typeof mEvent.getStateKey() === 'string',
          mEventId,
          mEvent,
          item,
          timelineSet,
          collapsed
        );

    const newDividerJSX =
      newDivider && eventJSX && eventSender !== mx.getUserId() ? (
        <MessageBase space={messageSpacing}>
          <TimelineDivider style={{ color: color.Success.Main }} variant="Inherit">
            <Badge as="span" size="500" variant="Success" fill="Solid" radii="300">
              <Text size="L400">New Messages</Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      ) : null;

    const ts = mEvent.getTs();

    const dayDividerJSX =
      dayDivider && eventJSX ? (
        <MessageBase space={messageSpacing}>
          <TimelineDivider variant="Surface">
            <Badge as="span" size="500" variant="Secondary" fill="None" radii="300">
              <Text size="L400">
                {(() => {
                  if (!ts) return 'Unknown date';
                  if (today(ts)) return 'Today';
                  if (yesterday(ts)) return 'Yesterday';
                  return timeDayMonthYear(ts);
                })()}
              </Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      ) : null;

    if (eventJSX && (newDividerJSX || dayDividerJSX)) {
      const stableKey = getEventStableKey(mEvent);

      return (
        <React.Fragment key={stableKey}>
          {newDividerJSX}
          {dayDividerJSX}
          {eventJSX}
        </React.Fragment>
      );
    }

    return eventJSX;
  };

  return (
    <Box grow="Yes" style={{ position: 'relative' }}>
      {unreadInfo?.readUptoEventId && !unreadInfo?.inLiveTimeline && (
        <TimelineFloat position="Top">
          <Chip
            variant="Primary"
            radii="Pill"
            outlined
            before={<Icon size="50" src={Icons.MessageUnread} />}
            onClick={handleJumpToUnread}
          >
            <Text size="L400">Jump to Unread</Text>
          </Chip>

          <Chip
            variant="SurfaceVariant"
            radii="Pill"
            outlined
            before={<Icon size="50" src={Icons.CheckTwice} />}
            onClick={handleMarkAsRead}
          >
            <Text size="L400">Mark as Read</Text>
          </Chip>
        </TimelineFloat>
      )}
      <Scroll ref={scrollRef} visibility="Hover">
        <Box
          direction="Column"
          justifyContent="End"
          style={{ minHeight: '100%', padding: `${config.space.S600} 0` }}
        >
          {!canPaginateBack && rangeAtStart && getItems().length > 0 && (
            <div
              style={{
                padding: `${config.space.S700} ${config.space.S400} ${config.space.S600} ${
                  messageLayout === MessageLayout.Compact ? config.space.S400 : toRem(64)
                }`,
              }}
            >
              <RoomIntro room={room} />
            </div>
          )}
          {(canPaginateBack || !rangeAtStart) &&
            (messageLayout === MessageLayout.Compact ? (
              <>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase ref={observeBackAnchor}>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
              </>
            ) : (
              <>
                <MessageBase>
                  <DefaultPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase ref={observeBackAnchor}>
                  <DefaultPlaceholder key={getItems().length} />
                </MessageBase>
              </>
            ))}

          {getItems().map(eventRenderer)}

          {(!liveTimelineLinked || !rangeAtEnd) &&
            (messageLayout === MessageLayout.Compact ? (
              <>
                <MessageBase ref={observeFrontAnchor}>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={getItems().length} />
                </MessageBase>
              </>
            ) : (
              <>
                <MessageBase ref={observeFrontAnchor}>
                  <DefaultPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={getItems().length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={getItems().length} />
                </MessageBase>
              </>
            ))}
          <span ref={atBottomAnchorRef} />
        </Box>
      </Scroll>
      {!atBottom && (
        <TimelineFloat position="Bottom">
          <Chip
            variant="SurfaceVariant"
            radii="Pill"
            outlined
            before={<Icon size="50" src={Icons.ArrowBottom} />}
            onClick={handleJumpToLatest}
          >
            <Text size="L400">Jump to Latest</Text>
          </Chip>
        </TimelineFloat>
      )}
    </Box>
  );
}
