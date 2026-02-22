import { useCallback, useTransition } from 'react';
import { NavigateOptions, useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { getCanonicalAliasOrRoomId } from '../utils/matrix';
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getSpacePath,
  getSpaceRoomPath,
} from '../pages/pathUtils';
import { useMatrixClient } from './useMatrixClient';
import { getOrphanParents, guessPerfectParent } from '../utils/room';
import { roomToParentsAtom } from '../state/room/roomToParents';
import { mDirectAtom } from '../state/mDirectList';
import { useSelectedSpace } from './router/useSelectedSpace';
import { useDirectSelected } from './router/useDirectSelected';
import { settingsAtom } from '../state/settings';
import { useSetting } from '../state/hooks/settings';

export const useRoomNavigate = () => {
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const roomToParents = useAtomValue(roomToParentsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const spaceSelectedId = useSelectedSpace();
  const directSelected = useDirectSelected();
  const [developerTools] = useSetting(settingsAtom, 'developerTools');
  const [isPending, startTransition] = useTransition();

  const navigateSpace = useCallback(
    (roomId: string) => {
      startTransition(() => {
        const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, roomId);
        navigate(getSpacePath(roomIdOrAlias));
      });
    },
    [mx, navigate, startTransition]
  );

  const navigateRoom = useCallback(
    (roomId: string, eventId?: string, opts?: NavigateOptions) => {
      startTransition(() => {
        const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, roomId);
        const openSpaceTimeline = developerTools && spaceSelectedId === roomId;

        if (directSelected && mDirects.has(roomId)) {
          navigate(getDirectRoomPath(roomIdOrAlias, eventId), opts);
          return;
        }

        const orphanParents = openSpaceTimeline
          ? [roomId]
          : getOrphanParents(roomToParents, roomId);
        if (orphanParents.length > 0) {
          let parentSpace: string;
          if (spaceSelectedId && orphanParents.includes(spaceSelectedId)) {
            parentSpace = spaceSelectedId;
          } else {
            parentSpace = guessPerfectParent(mx, roomId, orphanParents) ?? orphanParents[0];
          }

          const pSpaceIdOrAlias = getCanonicalAliasOrRoomId(mx, parentSpace);

          navigate(
            getSpaceRoomPath(pSpaceIdOrAlias, openSpaceTimeline ? roomId : roomIdOrAlias, eventId),
            opts
          );
          return;
        }

        if (mDirects.has(roomId)) {
          navigate(getDirectRoomPath(roomIdOrAlias, eventId), opts);
          return;
        }

        navigate(getHomeRoomPath(roomIdOrAlias, eventId), opts);
      });
    },
    [
      mx,
      navigate,
      spaceSelectedId,
      roomToParents,
      mDirects,
      developerTools,
      directSelected,
      startTransition,
    ]
  );

  return {
    navigateSpace,
    navigateRoom,
    isPending,
  };
};
