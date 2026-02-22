import React, { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { JoinAddressPrompt } from './join-address-prompt';
import { joinAddressPromptAtom } from '../state/joinAddressPrompt';
import {
  encodeSearchParamValueArray,
  getHomeRoomPath,
  withSearchParam,
} from '../pages/pathUtils';
import { _RoomSearchParams } from '../pages/paths';

export function JoinAddressPromptRenderer() {
  const state = useAtomValue(joinAddressPromptAtom);
  const setState = useSetAtom(joinAddressPromptAtom);
  const navigate = useNavigate();

  const handleClose = useCallback(() => {
    setState(undefined);
  }, [setState]);

  const handleOpen = useCallback(
    (roomIdOrAlias: string, viaServers?: string[], eventId?: string) => {
      setState(undefined);
      const path = getHomeRoomPath(roomIdOrAlias, eventId);
      navigate(
        viaServers
          ? withSearchParam<_RoomSearchParams>(path, {
              viaServers: encodeSearchParamValueArray(viaServers),
            })
          : path
      );
    },
    [navigate, setState]
  );

  if (!state) return null;

  return (
    <JoinAddressPrompt
      defaultValue={state.term}
      onOpen={handleOpen}
      onCancel={handleClose}
    />
  );
}
