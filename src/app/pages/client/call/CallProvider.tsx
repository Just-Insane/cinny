import React, {
  createContext,
  useState,
  useContext,
  useMemo,
  useCallback,
  ReactNode,
  useEffect,
} from 'react';
import { logger } from 'matrix-js-sdk/lib/logger';
import { WidgetApiToWidgetAction, WidgetApiAction, ClientWidgetApi, IWidgetApiRequestData } from 'matrix-widget-api';
import { useParams } from 'react-router-dom';
import { SmallWidget } from '../../../features/call/SmallWidget';

interface MediaStatePayload {
  data?: {
    audio_enabled?: boolean;
    video_enabled?: boolean;
  };
}

const WIDGET_MEDIA_STATE_UPDATE_ACTION = 'io.element.device_mute';
const WIDGET_HANGUP_ACTION = 'im.vector.hangup';
const WIDGET_ON_SCREEN_ACTION = 'set_always_on_screen';
const WIDGET_JOIN_ACTION = 'io.element.join';
const WIDGET_TILE_UPDATE = 'io.element.tile_layout';

interface CallContextState {
  activeCallRoomId: string | null;
  setActiveCallRoomId: (roomId: string | null) => void;
  viewedCallRoomId: string | null;
  setViewedCallRoomId: (roomId: string | null) => void;
  hangUp: () => void;
  activeClientWidgetApi: ClientWidgetApi | null;
  activeClientWidget: SmallWidget | null;
  registerActiveClientWidgetApi: (
    roomId: string | null,
    clientWidgetApi: ClientWidgetApi | null,
    clientWidget: SmallWidget,
    activeClientIframeRef: HTMLIFrameElement
  ) => void;
  sendWidgetAction: <T extends IWidgetApiRequestData = IWidgetApiRequestData>(
    action: WidgetApiToWidgetAction | string,
    data: T
  ) => Promise<void>;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isChatOpen: boolean;
  isActiveCallReady: boolean;
  toggleAudio: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  toggleChat: () => Promise<void>;
}

const CallContext = createContext<CallContextState | undefined>(undefined);

interface CallProviderProps {
  children: ReactNode;
}

const DEFAULT_AUDIO_ENABLED = true;
const DEFAULT_VIDEO_ENABLED = false;
const DEFAULT_CHAT_OPENED = false;

export function CallProvider({ children }: CallProviderProps) {
  const [activeCallRoomId, setActiveCallRoomIdState] = useState<string | null>(null);
  const [viewedCallRoomId, setViewedCallRoomIdState] = useState<string | null>(null);

  const [activeClientWidgetApi, setActiveClientWidgetApiState] = useState<ClientWidgetApi | null>(null);
  const [activeClientWidget, setActiveClientWidget] = useState<SmallWidget | null>(null);
  const [activeClientWidgetApiRoomId, setActiveClientWidgetApiRoomId] = useState<string | null>(null);
  const [activeClientWidgetIframeRef, setActiveClientWidgetIframeRef] = useState<HTMLIFrameElement | null>(null)

  const [isAudioEnabled, setIsAudioEnabledState] = useState<boolean>(DEFAULT_AUDIO_ENABLED);
  const [isVideoEnabled, setIsVideoEnabledState] = useState<boolean>(DEFAULT_VIDEO_ENABLED);
  const [isChatOpen, setIsChatOpenState] = useState<boolean>(DEFAULT_CHAT_OPENED);
  const [isActiveCallReady, setIsActiveCallReady] = useState<boolean>(false);

  const { roomIdOrAlias: viewedRoomId } = useParams<{ roomIdOrAlias: string }>();

  const setActiveCallRoomId = useCallback(
    (roomId: string | null) => {
      logger.warn(`CallContext: Setting activeCallRoomId to ${roomId}`);
      setActiveCallRoomIdState(roomId);
    },
    []
  );

  const setViewedCallRoomId = useCallback(
    (roomId: string | null) => {
      logger.warn(`CallContext: Setting viewedCallRoomId to ${roomId}`);
      setViewedCallRoomIdState(roomId);
    },
    [setViewedCallRoomIdState]
  );

  const setActiveClientWidgetApi = useCallback(
    (
      clientWidgetApi: ClientWidgetApi | null,
      clientWidget: SmallWidget | null,
      roomId: string | null,
      clientWidgetIframeRef: HTMLIFrameElement | null
    ) => {
      setActiveClientWidgetApiState(clientWidgetApi);
      setActiveClientWidget(clientWidget);
      setActiveClientWidgetApiRoomId(roomId);
      setActiveClientWidgetIframeRef(clientWidgetIframeRef)
    },
    []
  );

  const registerActiveClientWidgetApi = useCallback(
    (
      roomId: string | null,
      clientWidgetApi: ClientWidgetApi | null,
      clientWidget: SmallWidget | null,
      clientWidgetIframeRef: HTMLIFrameElement | null
    ) => {
      if (activeClientWidgetApi && activeClientWidgetApi !== clientWidgetApi) {
        logger.debug(`CallContext: Cleaning up listeners for previous clientWidgetApi instance.`);
      }

      
      if (roomId && clientWidgetApi) {
        logger.debug(`CallContext: Registering active clientWidgetApi for room ${roomId}.`);
        setActiveClientWidgetApi(clientWidgetApi, clientWidget, roomId, clientWidgetIframeRef);
      } else if (roomId === activeClientWidgetApiRoomId || roomId === null) {
        setActiveClientWidgetApi(null, null, null, null);
      }
    },
    [activeClientWidgetApi, activeClientWidgetApiRoomId, setActiveClientWidgetApi]
  );

  const hangUp = useCallback(
    () => {
      setActiveClientWidgetApi(null, null, null, null);
      setActiveCallRoomIdState(null);
      activeClientWidgetApi?.transport.send(`${WIDGET_HANGUP_ACTION}`, {});
      setIsActiveCallReady(false);

      logger.debug(`CallContext: Hang up called.`);
    },
    [
      activeClientWidgetApi?.transport,
      setActiveClientWidgetApi,
    ]
  );


  const sendWidgetAction = useCallback(
    async <T extends IWidgetApiRequestData = IWidgetApiRequestData,>(action: WidgetApiToWidgetAction | string, data: T): Promise<void> => {
      if (!activeClientWidgetApi) {
        logger.warn(
          `CallContext: Cannot send action '${action}', no active API clientWidgetApi registered.`
        );
        return Promise.reject(new Error('No active call clientWidgetApi'));
      }
      if (!activeClientWidgetApiRoomId || activeClientWidgetApiRoomId !== activeCallRoomId) {
        logger.debug(
          `CallContext: Cannot send action '${action}', clientWidgetApi room (${activeClientWidgetApiRoomId}) does not match active call room (${activeCallRoomId}). Stale clientWidgetApi?`
        );
        return Promise.reject(new Error('Mismatched active call clientWidgetApi'));
      }


      logger.debug(
        `CallContext: Sending action '${action}' via active clientWidgetApi (room: ${activeClientWidgetApiRoomId}) with data:`,
        data
      );
      await activeClientWidgetApi.transport.send(action as WidgetApiAction, data);

      return Promise.resolve()
    },
    [activeClientWidgetApi, activeCallRoomId, activeClientWidgetApiRoomId]
  );

  const toggleAudio = useCallback(async () => {
    const newState = !isAudioEnabled;
    logger.debug(`CallContext: Toggling audio. New state: enabled=${newState}`);
    setIsAudioEnabledState(newState);

    if(isActiveCallReady) {
      try {
        await sendWidgetAction(WIDGET_MEDIA_STATE_UPDATE_ACTION, {
          audio_enabled: newState,
          video_enabled: isVideoEnabled,
        });
        logger.debug(`CallContext: Successfully sent audio toggle action.`);
      } catch (error) {
        setIsAudioEnabledState(!newState);
        throw error;
      }
    }
  }, [isAudioEnabled, isVideoEnabled, sendWidgetAction, isActiveCallReady]);

  const toggleVideo = useCallback(async () => {
    const newState = !isVideoEnabled;
    logger.debug(`CallContext: Toggling video. New state: enabled=${newState}`);
    setIsVideoEnabledState(newState);

    if(isActiveCallReady){
      try {
        await sendWidgetAction(WIDGET_MEDIA_STATE_UPDATE_ACTION, {
          audio_enabled: isAudioEnabled,
          video_enabled: newState,
        });
        logger.debug(`CallContext: Successfully sent video toggle action.`);
      } catch (error) {
        setIsVideoEnabledState(!newState);
        throw error;
      }
    }
  }, [isVideoEnabled, isAudioEnabled, sendWidgetAction, isActiveCallReady]);


  useEffect(() => {
    if (!activeCallRoomId && !viewedCallRoomId) {
      return;
    }

    if (!activeClientWidgetApi) {
      return;
    }

    const handleHangup = (ev: CustomEvent) => {
      ev.preventDefault();
      if (isActiveCallReady && ev.detail.widgetId === activeClientWidgetApi.widget.id) {
        activeClientWidgetApi.transport.reply(ev.detail, {});
      }
      logger.debug(
        `CallContext: Received hangup action from widget in room ${activeCallRoomId}.`,
        ev
      );
    };

    const handleMediaStateUpdate = (ev: CustomEvent<MediaStatePayload>) => {
      if(!isActiveCallReady) return;
      ev.preventDefault();
      logger.debug(
        `CallContext: Received media state update from widget in room ${activeCallRoomId}:`,
        ev.detail
      );

      /* eslint-disable camelcase */
      const { audio_enabled, video_enabled } = ev.detail.data ?? {};

      if (typeof audio_enabled === 'boolean' && audio_enabled !== isAudioEnabled) {
        logger.debug(`CallContext: Updating audio enabled state from widget: ${audio_enabled}`);
        setIsAudioEnabledState(audio_enabled);
      }
      if (typeof video_enabled === 'boolean' && video_enabled !== isVideoEnabled) {
        logger.debug(`CallContext: Updating video enabled state from widget: ${video_enabled}`);
        setIsVideoEnabledState(video_enabled);
      }
      /* eslint-enable camelcase */
    };

    const handleOnScreenStateUpdate = (ev: CustomEvent) => {
      ev.preventDefault();
      activeClientWidgetApi.transport.reply(ev.detail, {});
    };

    const handleOnTileLayout = (ev: CustomEvent) => {
      ev.preventDefault();

      activeClientWidgetApi.transport.reply(ev.detail, {});
    };

    const handleJoin = (ev: CustomEvent) => {
      ev.preventDefault();

      activeClientWidgetApi.transport.reply(ev.detail, {});

      const iframeDoc =
        activeClientWidgetIframeRef?.contentWindow?.document || 
        activeClientWidgetIframeRef?.contentDocument;

      if(iframeDoc){

        const observer = new MutationObserver(() => {
          const button = iframeDoc.querySelector('[data-testid="incall_leave"]');
          if (button) {
            button.addEventListener('click', () => {
              hangUp()
            });
          }
          observer.disconnect();
        });
        logger.debug('Join Call');
        observer.observe(iframeDoc, { childList: true, subtree: true });
      }
      
      setIsActiveCallReady(true);
      
    };
    
    logger.debug(
      `CallContext: Setting up listeners for clientWidgetApi in room ${activeCallRoomId}`
    );

    sendWidgetAction(WIDGET_MEDIA_STATE_UPDATE_ACTION, {
      audio_enabled: isAudioEnabled,
      video_enabled: isVideoEnabled,
    });

    activeClientWidgetApi.on(`action:${WIDGET_HANGUP_ACTION}`, handleHangup);
    activeClientWidgetApi.on(`action:${WIDGET_MEDIA_STATE_UPDATE_ACTION}`, handleMediaStateUpdate);
    activeClientWidgetApi.on(`action:${WIDGET_TILE_UPDATE}`, handleOnTileLayout);
    activeClientWidgetApi.on(`action:${WIDGET_ON_SCREEN_ACTION}`, handleOnScreenStateUpdate);
    activeClientWidgetApi.on(`action:${WIDGET_JOIN_ACTION}`, handleJoin);

  }, [
    activeClientWidgetIframeRef,
    activeClientWidgetApi,
    activeCallRoomId,
    activeClientWidgetApiRoomId,
    hangUp,
    isChatOpen,
    isAudioEnabled,
    isVideoEnabled,
    isActiveCallReady,
    viewedRoomId,
    viewedCallRoomId,
    setViewedCallRoomId,
    activeClientWidget?.iframe?.contentDocument,
    activeClientWidget?.iframe?.contentWindow?.document,
    sendWidgetAction
  ]);

  const toggleChat = useCallback(async () => {
    const newState = !isChatOpen;
    setIsChatOpenState(newState);
  }, [isChatOpen]);

  const contextValue = useMemo<CallContextState>(
    () => ({
      activeCallRoomId,
      setActiveCallRoomId,
      viewedCallRoomId,
      setViewedCallRoomId,
      hangUp,
      activeClientWidgetApi,
      registerActiveClientWidgetApi,
      activeClientWidget,
      sendWidgetAction,
      isChatOpen,
      isAudioEnabled,
      isVideoEnabled,
      isActiveCallReady,
      toggleAudio,
      toggleVideo,
      toggleChat
    }),
    [
      activeCallRoomId,
      setActiveCallRoomId,
      viewedCallRoomId,
      setViewedCallRoomId,
      hangUp,
      activeClientWidgetApi,
      registerActiveClientWidgetApi,
      activeClientWidget,
      sendWidgetAction,
      isChatOpen,
      isAudioEnabled,
      isVideoEnabled,
      isActiveCallReady,
      toggleAudio,
      toggleVideo,
      toggleChat
    ]
  );

  return <CallContext.Provider value={contextValue}>{children}</CallContext.Provider>;
}

export function useCallState(): CallContextState {
  const context = useContext(CallContext);
  if (context === undefined) {
    throw new Error('useCallState must be used within a CallProvider');
  }
  return context;
}
