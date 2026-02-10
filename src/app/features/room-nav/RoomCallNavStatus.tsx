import { Box, Chip, Icon, IconButton, Icons, Text, Tooltip, TooltipProvider } from 'folds';
import React from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useCallState } from '../../pages/client/call/CallProvider';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';

export function CallNavStatus() {
  const {
    activeCallRoomId,
    isAudioEnabled,
    isVideoEnabled, 
    isActiveCallReady,   
    toggleAudio,
    toggleVideo,
    hangUp,
  } = useCallState();
  const mx = useMatrixClient();
  const { navigateRoom } = useRoomNavigate();
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
        borderTop: `1px solid #e0e0e0`,
        justifyContent: 'center',
      }}
    >
      <Box direction="Row" justifyContent='SpaceBetween' alignItems='Center'>
        {/* Going to need better icons for this */}

        <Box>
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
                  display: isActiveCallReady ? 'flex' : 'none',
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                <Icon src={Icons.VolumeHigh}/>
                <Text style={{ flexGrow: 1 }} size="B400" truncate>
                  {activeCallRoomId ? mx.getRoom(activeCallRoomId)?.name : ""}
                </Text>
              </Chip>
            )}
          </TooltipProvider>
        </Box>

        <Box>
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
              <IconButton variant="Background" ref={triggerRef} onClick={toggleAudio}>
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
              <IconButton variant="Background" ref={triggerRef} onClick={toggleVideo}>
                <Icon src={!isVideoEnabled ? Icons.VideoCameraMute : Icons.VideoCamera} />
              </IconButton>
            )}
          </TooltipProvider>

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
                ref={triggerRef} 
                onClick={hangUp}
                style={{
                  display: isActiveCallReady ? 'block' : 'none'
                }}
                >
                <Icon src={Icons.Phone} />
              </IconButton>
            )}
          </TooltipProvider>
        </Box>
      </Box>
    </Box>
  );
}
