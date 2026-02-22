import React, { useCallback, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { inviteUserPromptAtom } from '../state/inviteUserPrompt';
import { useAllJoinedRoomsSet, useGetRoom } from '../hooks/useGetRoom';
import { InviteUserPrompt } from './invite-user-prompt';

export function InviteUserPromptRenderer() {
  const state = useAtomValue(inviteUserPromptAtom);
  const setState = useSetAtom(inviteUserPromptAtom);

  const allJoinedRooms = useAllJoinedRoomsSet();
  const getRoom = useGetRoom(allJoinedRooms);
  const room = state ? getRoom(state.roomId) : undefined;

  const handleClose = useCallback(() => {
    setState(undefined);
  }, [setState]);

  useEffect(() => {
    if (state && !room) {
      setState(undefined);
    }
  }, [room, setState, state]);

  if (!state || !room) return null;

  return <InviteUserPrompt room={room} requestClose={handleClose} />;
}
