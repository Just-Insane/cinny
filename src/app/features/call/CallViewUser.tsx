import { as, Avatar, Box, Icon, Icons, Text } from 'folds';
import React from 'react';
import classNames from 'classnames';
import { Room } from 'matrix-js-sdk';
import { CallMembership } from 'matrix-js-sdk/lib/matrixrtc/CallMembership';
import { UserAvatar } from '../../components/user-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { openProfileViewer } from '../../../client/action/navigation';
import * as css from './CallView.css';

type CallViewUserProps = {
  room: Room;
  callMembership: CallMembership;
};

export const UserProfileButton = as<'button'>(
  ({ as: AsUserProfileButton = 'button', className, ...props }, ref) => (
    <AsUserProfileButton className={classNames(css.UserLink, className)} {...props} ref={ref} />
  )
);

export const CallViewUserBase = as<'div'>(({ className, ...props }, ref) => (
  <Box
    direction="Column"
    gap="300"
    className={classNames(css.CallViewUser, className)}
    {...props}
    ref={ref}
  />
));

export function CallViewUser({ room, callMembership }: CallViewUserProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const userId = callMembership.sender ?? '';
  const avatarMxcUrl = getMemberAvatarMxc(room, userId);
  const avatarUrl = avatarMxcUrl
    ? mx.mxcUrlToHttp(avatarMxcUrl, 32, 32, 'crop', undefined, false, useAuthentication)
    : undefined;
  const getName = getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId);

  const handleUserClick = () => {
    openProfileViewer(userId, room.roomId);
  };

  return (
    <UserProfileButton onClick={handleUserClick} aria-label={getName}>
      <CallViewUserBase>
        <Box direction="Column" grow="Yes" alignItems="Center" gap="200" justifyContent="Center">
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
      </CallViewUserBase>
    </UserProfileButton>
  );
}
