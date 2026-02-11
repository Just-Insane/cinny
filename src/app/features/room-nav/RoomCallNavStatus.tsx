import { Box, Chip, Icon, IconButton, Icons, Line, Text, Tooltip, TooltipProvider } from 'folds';
import React from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useCallState } from '../../pages/client/call/CallProvider';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import * as css from './RoomCallNavStatus.css';

export function CallNavStatus() {
  const { activeCallRoomId, isAudioEnabled, isVideoEnabled, toggleAudio, toggleVideo, hangUp } =
    useCallState();
  const mx = useMatrixClient();
  const { navigateRoom } = useRoomNavigate();
  const hasActiveCall = Boolean(activeCallRoomId);

  const handleGoToCallRoom = () => {
    if (activeCallRoomId) {
      navigateRoom(activeCallRoomId);
    }
  };

  return (
    <Box direction="Column" shrink="No">
      <Line variant="Surface" size="300" />
      <Box className={css.Actions} direction="Row" alignItems="Center" gap="100">
        <Box className={css.RoomButtonWrap} grow="Yes">
          {hasActiveCall && (
            <TooltipProvider
              position="Top"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>Go to Room</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <Chip
                  size="500"
                  fill="Soft"
                  as="button"
                  onClick={handleGoToCallRoom}
                  ref={triggerRef}
                  className={css.RoomButton}
                >
                  <Icon size="300" src={Icons.VolumeHigh} />
                  <Text className={css.RoomName} size="B400" truncate>
                    {mx.getRoom(activeCallRoomId ?? '')?.name ?? ''}
                  </Text>
                </Chip>
              )}
            </TooltipProvider>
          )}
        </Box>
        {hasActiveCall && (
          <TooltipProvider
            position="Top"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>Hang Up</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton fill="None" size="300" ref={triggerRef} onClick={hangUp}>
                <Icon src={Icons.Phone} />
              </IconButton>
            )}
          </TooltipProvider>
        )}
        <TooltipProvider
          position="Top"
          offset={4}
          tooltip={
            <Tooltip>
              <Text>{!isAudioEnabled ? 'Unmute' : 'Mute'}</Text>
            </Tooltip>
          }
        >
          {(triggerRef) => (
            <IconButton fill="None" size="300" ref={triggerRef} onClick={toggleAudio}>
              <Icon src={!isAudioEnabled ? Icons.MicMute : Icons.Mic} />
            </IconButton>
          )}
        </TooltipProvider>
        <TooltipProvider
          position="Top"
          offset={4}
          tooltip={
            <Tooltip>
              <Text>{!isVideoEnabled ? 'Video On' : 'Video Off'}</Text>
            </Tooltip>
          }
        >
          {(triggerRef) => (
            <IconButton fill="None" size="300" ref={triggerRef} onClick={toggleVideo}>
              <Icon src={!isVideoEnabled ? Icons.VideoCameraMute : Icons.VideoCamera} />
            </IconButton>
          )}
        </TooltipProvider>
      </Box>
    </Box>
  );
}
