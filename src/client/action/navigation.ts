import { getDefaultStore } from 'jotai';
import type { Position, RectCords } from 'folds';

import { createRoomModalAtom } from '../../app/state/createRoomModal';
import { createSpaceModalAtom } from '../../app/state/createSpaceModal';
import { inviteUserPromptAtom } from '../../app/state/inviteUserPrompt';
import { joinAddressPromptAtom } from '../../app/state/joinAddressPrompt';
import { userRoomProfileAtom } from '../../app/state/userRoomProfile';

const store = getDefaultStore();

export function openCreateRoom(isSpace = false, parentId: string | null = null) {
  if (isSpace) {
    store.set(createSpaceModalAtom, { spaceId: parentId ?? undefined });
    return;
  }

  store.set(createRoomModalAtom, { spaceId: parentId ?? undefined });
}

export function openJoinAlias(term?: string) {
  store.set(joinAddressPromptAtom, { term });
}

export function openInviteUser(roomId: string, searchTerm?: string) {
  store.set(inviteUserPromptAtom, { roomId, searchTerm });
}

export function openProfileViewer(
  userId: string,
  roomId: string,
  cords?: RectCords,
  position?: Position
) {
  const anchor =
    cords ??
    (document.activeElement instanceof HTMLElement
      ? document.activeElement.getBoundingClientRect()
      : document.body.getBoundingClientRect());

  store.set(userRoomProfileAtom, {
    roomId,
    spaceId: undefined,
    userId,
    cords: anchor,
    position,
  });
}
