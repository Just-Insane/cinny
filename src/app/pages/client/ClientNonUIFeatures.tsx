import { useAtomValue } from 'jotai';
import React, { ReactNode, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Room, RoomEvent, RoomEventHandlerMap } from 'matrix-js-sdk';
import { roomToUnreadAtom, unreadEqual, unreadInfoToUnread } from '../../state/room/roomToUnread';
import LogoSVG from '../../../../public/res/svg/cinny.svg';
import LogoUnreadSVG from '../../../../public/res/svg/cinny-unread.svg';
import LogoHighlightSVG from '../../../../public/res/svg/cinny-highlight.svg';
import NotificationSound from '../../../../public/sound/notification.ogg';
import InviteSound from '../../../../public/sound/invite.ogg';
import { notificationPermission, setFavicon } from '../../utils/dom';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { pushSessionToSW } from '../../../sw-session';
import { usePathWithOrigin } from '../../hooks/usePathWithOrigin';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { usePreviousValue } from '../../hooks/usePreviousValue';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getInboxInvitesPath, getInboxNotificationsPath } from '../pathUtils';
import {
  getMemberDisplayName,
  getNotificationType,
  getUnreadInfo,
  isNotificationEvent,
} from '../../utils/room';
import { NotificationType, UnreadInfo } from '../../../types/matrix/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { useInboxNotificationsSelected } from '../../hooks/router/useInbox';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';

function SystemEmojiFeature() {
  const [twitterEmoji] = useSetting(settingsAtom, 'twitterEmoji');

  if (twitterEmoji) {
    document.documentElement.style.setProperty('--font-emoji', 'Twemoji');
  } else {
    document.documentElement.style.setProperty('--font-emoji', 'Twemoji_DISABLED');
  }

  return null;
}

function PageZoomFeature() {
  const [pageZoom] = useSetting(settingsAtom, 'pageZoom');

  if (pageZoom === 100) {
    document.documentElement.style.removeProperty('font-size');
  } else {
    document.documentElement.style.setProperty('font-size', `calc(1em * ${pageZoom / 100})`);
  }

  return null;
}

function FaviconUpdater() {
  const roomToUnread = useAtomValue(roomToUnreadAtom);

  useEffect(() => {
    let notification = false;
    let highlight = false;
    let total = 0;
    roomToUnread.forEach((unread) => {
      if (unread.from === null) {
        total += unread.total;
      }
      if (unread.total > 0) {
        notification = true;
      }
      if (unread.highlight > 0) {
        highlight = true;
      }
    });

    if (notification) {
      setFavicon(highlight ? LogoHighlightSVG : LogoUnreadSVG);
    } else {
      setFavicon(LogoSVG);
    }
    try {
      navigator.setAppBadge(total);
    } catch (e) {
      // Likely Firefox/Gecko-based and doesn't support badging API
    }
  }, [roomToUnread]);

  return null;
}

function InviteNotifications() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const invites = useAtomValue(allInvitesAtom);
  const perviousInviteLen = usePreviousValue(invites.length, 0);
  const mx = useMatrixClient();

  const navigate = useNavigate();
  const [showNotifications] = useSetting(settingsAtom, 'useInAppNotifications');
  const [notificationSound] = useSetting(settingsAtom, 'isNotificationSounds');

  const notify = useCallback(
    (count: number) => {
      const userId = mx.getSafeUserId();
      const inviteRooms = invites
        .map((roomId) => mx.getRoom(roomId))
        .filter((room): room is Room => !!room);
      const latestInvite = inviteRooms
        .map((room) => {
          const memberEvent = room.getMember(userId)?.events.member;
          const ts = memberEvent?.getTs() ?? 0;
          const senderId = memberEvent?.getSender();
          const senderName = senderId
            ? getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId
            : 'Unknown';
          const roomName = room.name ?? room.getCanonicalAlias() ?? room.roomId;
          return { roomName, senderName, ts };
        })
        .sort((a, b) => b.ts - a.ts)[0];
      const senderName = latestInvite?.senderName ?? 'Invitation';
      const roomName = latestInvite?.roomName ?? 'Unknown';
      const noti = new window.Notification(`${senderName} — ${roomName}`, {
        icon: LogoSVG,
        badge: LogoSVG,
        body: `You have ${count} new invitation${count > 1 ? 's' : ''}.`,
        silent: true,
      });

      noti.onclick = () => {
        if (!window.closed) navigate(getInboxInvitesPath());
        noti.close();
      };
    },
    [invites, mx, navigate]
  );

  const playSound = useCallback(() => {
    const audioElement = audioRef.current;
    audioElement?.play();
  }, []);

  useEffect(() => {
    if (invites.length > perviousInviteLen && mx.getSyncState() === 'SYNCING') {
      if (showNotifications && notificationPermission('granted')) {
        notify(invites.length - perviousInviteLen);
      }

      if (notificationSound) {
        playSound();
      }
    }
  }, [mx, invites, perviousInviteLen, showNotifications, notificationSound, notify, playSound]);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio ref={audioRef} style={{ display: 'none' }}>
      <source src={InviteSound} type="audio/ogg" />
    </audio>
  );
}

function MessageNotifications() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const notifRef = useRef<Notification>();
  const unreadCacheRef = useRef<Map<string, UnreadInfo>>(new Map());
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [showNotifications] = useSetting(settingsAtom, 'useInAppNotifications');
  const [notificationSound] = useSetting(settingsAtom, 'isNotificationSounds');

  const navigate = useNavigate();
  const notificationSelected = useInboxNotificationsSelected();
  const selectedRoomId = useSelectedRoom();

  const notify = useCallback(
    ({
      roomName,
      roomAvatar,
      username,
      body,
    }: {
      roomName: string;
      roomAvatar?: string;
      username: string;
      body: string;
      roomId: string;
      eventId: string;
    }) => {
      const noti = new window.Notification(`${username} — ${roomName}`, {
        icon: roomAvatar,
        badge: roomAvatar,
        body,
        silent: true,
      });

      noti.onclick = () => {
        if (!window.closed) navigate(getInboxNotificationsPath());
        noti.close();
        notifRef.current = undefined;
      };

      notifRef.current?.close();
      notifRef.current = noti;
    },
    [navigate]
  );

  const playSound = useCallback(() => {
    const audioElement = audioRef.current;
    audioElement?.play();
  }, []);

  useEffect(() => {
    const handleTimelineEvent: RoomEventHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      room,
      toStartOfTimeline,
      removed,
      data
    ) => {
      if (mx.getSyncState() !== 'SYNCING') return;
      if (document.hasFocus() && (selectedRoomId === room?.roomId || notificationSelected)) return;

      if (
        !room ||
        !data.liveEvent ||
        room.isSpaceRoom() ||
        !isNotificationEvent(mEvent) ||
        getNotificationType(mx, room.roomId) === NotificationType.Mute
      ) {
        return;
      }

      const sender = mEvent.getSender();
      const eventId = mEvent.getId();
      if (!sender || !eventId || mEvent.getSender() === mx.getUserId()) return;
      const unreadInfo = getUnreadInfo(room);
      const cachedUnreadInfo = unreadCacheRef.current.get(room.roomId);
      unreadCacheRef.current.set(room.roomId, unreadInfo);

      if (unreadInfo.total === 0) return;
      if (
        cachedUnreadInfo &&
        unreadEqual(unreadInfoToUnread(cachedUnreadInfo), unreadInfoToUnread(unreadInfo))
      ) {
        return;
      }

      if (showNotifications && notificationPermission('granted')) {
        const avatarMxc =
          room.getAvatarFallbackMember()?.getMxcAvatarUrl() ?? room.getMxcAvatarUrl();
        const content = mEvent.getContent();
        const messageBody =
          typeof content?.body === 'string' && content.body.trim()
            ? content.body
            : 'You have a new message!';
        notify({
          roomName: room.name ?? 'Unknown',
          roomAvatar: avatarMxc
            ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined
            : undefined,
          username: getMemberDisplayName(room, sender) ?? getMxIdLocalPart(sender) ?? sender,
          body: messageBody,
          roomId: room.roomId,
          eventId,
        });
      }

      if (notificationSound) {
        playSound();
      }
    };
    mx.on(RoomEvent.Timeline, handleTimelineEvent);
    return () => {
      mx.removeListener(RoomEvent.Timeline, handleTimelineEvent);
    };
  }, [
    mx,
    notificationSound,
    notificationSelected,
    showNotifications,
    playSound,
    notify,
    selectedRoomId,
    useAuthentication,
  ]);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio ref={audioRef} style={{ display: 'none' }}>
      <source src={NotificationSound} type="audio/ogg" />
    </audio>
  );
}

function PushNotificationBridge() {
  const mx = useMatrixClient();
  const appBaseUrl = usePathWithOrigin('');
  const [showPushNotificationContent] = useSetting(settingsAtom, 'showPushNotificationContent');

  useEffect(() => {
    pushSessionToSW(mx.baseUrl, mx.getAccessToken() ?? undefined, mx.getUserId() ?? undefined, {
      showPushNotificationContent,
      appBaseUrl,
    });
  }, [mx, showPushNotificationContent, appBaseUrl]);

  return null;
}

function PushTargetNavigator() {
  const { navigateRoom } = useRoomNavigate();
  const navigate = useNavigate();

  const handleTarget = useCallback(
    (data: { roomId?: string; eventId?: string; action?: string }) => {
      if (data.action === 'invites') {
        navigate(getInboxInvitesPath(), { replace: true });
        return;
      }
      if (data.roomId) {
        navigateRoom(data.roomId, data.eventId, { replace: true });
      }
    },
    [navigate, navigateRoom]
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const roomId = url.searchParams.get('pushRoomId') ?? undefined;
    const eventId = url.searchParams.get('pushEventId') ?? undefined;
    const action = url.searchParams.get('pushAction') ?? undefined;
    if (!roomId && !action) return;

    url.searchParams.delete('pushRoomId');
    url.searchParams.delete('pushEventId');
    url.searchParams.delete('pushAction');
    window.history.replaceState({}, '', url.toString());

    handleTarget({ roomId, eventId, action });
  }, [handleTarget]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (ev: MessageEvent) => {
      const data = ev.data ?? {};
      if (data.type !== 'pushNavigate') return;
      handleTarget({
        roomId: data.roomId,
        eventId: data.eventId,
        action: data.action,
      });
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [handleTarget]);

  return null;
}

type ClientNonUIFeaturesProps = {
  children: ReactNode;
};

export function ClientNonUIFeatures({ children }: ClientNonUIFeaturesProps) {
  const [showNotifications] = useSetting(settingsAtom, 'useInAppNotifications');

  // When the user asks for in‑app notifications make sure we request the
  // browser permission. On normal browsers this pops up a prompt; on desktop
  // builds the promise resolves to "granted" immediately, which prevents the
  // permission check below from blocking our notifications. This mirrors the
  // behaviour prior to the push/permission refactor.
  React.useEffect(() => {
    if (
      showNotifications &&
      'Notification' in window &&
      window.Notification.permission === 'default'
    ) {
      // we don't await this on purpose; failures here are non‑fatal.
      Notification.requestPermission().catch(() => {});
    }
  }, [showNotifications]);

  return (
    <>
      <SystemEmojiFeature />
      <PageZoomFeature />
      <FaviconUpdater />
      <InviteNotifications />
      <MessageNotifications />
      <PushNotificationBridge />
      <PushTargetNavigator />
      {children}
    </>
  );
}
