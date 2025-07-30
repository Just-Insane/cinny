import { Avatar, Box, Icon, Icons, Text } from 'folds';
import React from 'react';
import { Room } from 'matrix-js-sdk';
import { CallMembership } from 'matrix-js-sdk/lib/matrixrtc/CallMembership';
import { NavButton, NavItem, NavItemContent } from '../../components/nav';
import { UserAvatar } from '../../components/user-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useCallState } from '../../pages/client/call/CallProvider';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { openProfileViewer } from '../../../client/action/navigation';

type RoomNavUserProps = {
  room: Room;
  callMembership: CallMembership;
};
export function RoomNavUser({ room, callMembership }: RoomNavUserProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const { isCallActive, activeCallRoomId } = useCallState();
  const isActiveCall = isCallActive && activeCallRoomId === room.roomId;
  const userId = callMembership.sender ?? '';
  const avatarMxcUrl = getMemberAvatarMxc(room, userId);
  const avatarUrl = avatarMxcUrl
    ? mx.mxcUrlToHttp(avatarMxcUrl, 32, 32, 'crop', undefined, false, useAuthentication)
    : undefined;
  const getName = getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId);
  const isCallParticipant = isActiveCall && userId !== mx.getUserId();

  const handleNavUserClick = () => {
    openProfileViewer(userId, room.roomId);
  };

  const ariaLabel = isCallParticipant ? `Call Participant: ${getName}` : getName;

  return (
    <NavItem variant="Background" radii="400">
      <NavButton onClick={handleNavUserClick} aria-label={ariaLabel}>
        <NavItemContent>
          <Box direction="Column" grow="Yes" gap="200" justifyContent="Stretch">
            <Box as="span" alignItems="Center" gap="200">
              <Avatar size="200">
                <UserAvatar
                  userId={userId}
                  src={avatarUrl ?? undefined}
                  alt={getName}
                  renderFallback={() => <Icon size="50" src={Icons.User} filled />}
                />
              </Avatar>
              <Text size="B400" priority="300" truncate>
                {getName}
              </Text>
            </Box>
          </Box>
        </NavItemContent>
      </NavButton>
    </NavItem>
  );
}
