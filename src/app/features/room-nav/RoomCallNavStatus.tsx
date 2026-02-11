import {
  Box,
  Chip,
  Icon,
  IconButton,
  Icons,
  Text,
  Tooltip,
  TooltipProvider,
  color,
  config,
} from 'folds';
import React from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useCallState } from '../../pages/client/call/CallProvider';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';

export function CallNavStatus() {
  const {
    activeCallRoomId,
    isAudioEnabled,
    isVideoEnabled,
    toggleAudio,
    toggleVideo,
    hangUp,
  } = useCallState();
  const mx = useMatrixClient();
  const { navigateRoom } = useRoomNavigate();
  const hasActiveCall = Boolean(activeCallRoomId);

  const handleGoToCallRoom = () => {
    if (activeCallRoomId) {
      navigateRoom(activeCallRoomId);
    }
  };

  return (
    <Box
      direction="Column"
      style={{
        flexShrink: 0,
        borderTop: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
        padding: `${config.space.S200} ${config.space.S200}`,
      }}
    >
      <Box direction="Row" alignItems="Center" gap="100">
        <Box grow="Yes" style={{ minWidth: 0 }}>
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
                  variant="Background"
                  size="500"
                  fill="Soft"
                  as="button"
                  onClick={handleGoToCallRoom}
                  ref={triggerRef}
                  style={{
                    width: '100%',
                    minWidth: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon size="200" src={Icons.VolumeHigh} />
                  <Text style={{ flexGrow: 1, minWidth: 0 }} size="B400" truncate>
                    {mx.getRoom(activeCallRoomId)?.name ?? ''}
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
              <IconButton
                variant="Background"
                size="400"
                radii="400"
                ref={triggerRef}
                onClick={hangUp}
              >
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
            <IconButton
              variant="Background"
              size="400"
              radii="400"
              ref={triggerRef}
              onClick={toggleAudio}
            >
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
            <IconButton
              variant="Background"
              size="400"
              radii="400"
              ref={triggerRef}
              onClick={toggleVideo}
            >
              <Icon src={!isVideoEnabled ? Icons.VideoCameraMute : Icons.VideoCamera} />
            </IconButton>
          )}
        </TooltipProvider>
      </Box>
    </Box>
  );
}
