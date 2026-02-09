import React, { createContext, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { logger } from 'matrix-js-sdk/lib/logger';
import { ClientWidgetApi } from 'matrix-widget-api';
import { Box } from 'folds';
import { useParams } from 'react-router-dom';
import { useCallState } from './CallProvider';
import {
  createVirtualWidget,
  SmallWidget,
  getWidgetData,
  getWidgetUrl,
} from '../../../features/call/SmallWidget';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { ThemeKind, useTheme } from '../../../hooks/useTheme';

interface PersistentCallContainerProps {
  children: ReactNode;
}

export const PrimaryRefContext = createContext(null);

export function PersistentCallContainer({ children }: PersistentCallContainerProps) {
  const primaryIframeRef = useRef<HTMLIFrameElement | null>(null);
  const primaryWidgetApiRef = useRef<ClientWidgetApi | null>(null);
  const primarySmallWidgetRef = useRef<SmallWidget | null>(null);

  const {
    activeCallRoomId,
    viewedCallRoomId,
    isChatOpen,
    isActiveCallReady,
    registerActiveClientWidgetApi,
    activeClientWidget,
  } = useCallState();
  const mx = useMatrixClient();
  const clientConfig = useClientConfig();
  const screenSize = useScreenSizeContext();
  const theme = useTheme()
  const isMobile = screenSize === ScreenSize.Mobile;
  const { roomIdOrAlias: viewedRoomId } = useParams();
  const isViewingActiveCall = useMemo(
    () => activeCallRoomId !== null && activeCallRoomId === viewedRoomId,
    [activeCallRoomId, viewedRoomId]
  );

  /* eslint-disable no-param-reassign */

  const setupWidget = useCallback(
    (
      widgetApiRef: { current: ClientWidgetApi },
      smallWidgetRef: { current: SmallWidget },
      iframeRef: { current: { src: string } },
      skipLobby: { toString: () => any },
      themeKind: ThemeKind | null
    ) => {
      if (mx?.getUserId()) {
          logger.debug(`CallContextJ: iframe src - ${iframeRef.current.src}`)
          logger.debug(`CallContextJ: activeCallRoomId: ${activeCallRoomId} viewedId: ${viewedCallRoomId} isactive: ${isActiveCallReady}`)
        if (
          (activeCallRoomId !== viewedCallRoomId && isActiveCallReady) ||
          (activeCallRoomId && !isActiveCallReady) ||
          (!activeCallRoomId && viewedCallRoomId && !isActiveCallReady)
        ) {
          const roomIdToSet = (skipLobby ? activeCallRoomId : viewedCallRoomId) ?? '';
          if (roomIdToSet === '') {
            return;
          }
          const widgetId = `element-call-${roomIdToSet}-${Date.now()}`;
          const newUrl = getWidgetUrl(
            mx,
            roomIdToSet,
            clientConfig.elementCallUrl ?? '',
            widgetId,
            {
              skipLobby: skipLobby.toString(),
              returnToLobby: 'true',
              perParticipantE2EE: 'true',
              theme: themeKind
            }
          );

          if (
            primarySmallWidgetRef.current?.roomId &&
            (activeClientWidget?.roomId && activeClientWidget.roomId === primarySmallWidgetRef.current?.roomId)
          ) {
            return;
          }

          if (iframeRef.current && (!iframeRef.current.src || iframeRef.current.src !== newUrl.toString())) {
            iframeRef.current.src = newUrl.toString();
          }

          const iframeElement = iframeRef.current;
          if (!iframeElement) {
            return;
          }

          const userId = mx.getUserId() ?? '';
          const app = createVirtualWidget(
            mx,
            widgetId,
            userId,
            'Element Call',
            'm.call',
            newUrl,
            true,
            getWidgetData(mx, roomIdToSet, {}, { skipLobby: true }),
            roomIdToSet
          );

          const smallWidget = new SmallWidget(app);
          smallWidgetRef.current = smallWidget;

          const widgetApiInstance = smallWidget.startMessaging(iframeElement);
          widgetApiRef.current = widgetApiInstance;
          registerActiveClientWidgetApi(roomIdToSet, widgetApiRef.current, smallWidget);
          
          widgetApiInstance.once('ready', () => {
            logger.info(`PersistentCallContainer: Widget for ${roomIdToSet} is ready.`);
          });
        }
      }
    },
    [
      mx,
      activeCallRoomId,
      viewedCallRoomId,
      isActiveCallReady,
      clientConfig.elementCallUrl,
      activeClientWidget,
      registerActiveClientWidgetApi,
    ]
  );

  useEffect(() => {
    logger.debug(`CallContextJ: ${isActiveCallReady} ${isViewingActiveCall}`)
  }, [isActiveCallReady, isViewingActiveCall])
  useEffect(() => {
    if (activeCallRoomId){
      setupWidget(primaryWidgetApiRef, primarySmallWidgetRef, primaryIframeRef, true, theme.kind);
      logger.debug(`CallContextJ: set primary widget: ${primaryWidgetApiRef.current?.eventNames()} ${primarySmallWidgetRef.current} ${primaryIframeRef.current?.baseURI}`)
    }
  }, [
    theme,
    setupWidget,
    primaryWidgetApiRef,
    primarySmallWidgetRef,
    primaryIframeRef,
    registerActiveClientWidgetApi,
    activeCallRoomId,
    viewedCallRoomId,
    isActiveCallReady
  ]);

  const memoizedIframeRef = useMemo(() => primaryIframeRef, [primaryIframeRef]);

  return (
    <PrimaryRefContext.Provider value={memoizedIframeRef}>
        <Box grow="No">
          <Box
            direction="Column"
            style={{
              position: 'relative',
              zIndex: 0,
              display: isMobile && isChatOpen ? 'none' : 'flex',
              width: isMobile && isChatOpen ? '0%' : '100%',
              height: isMobile && isChatOpen ? '0%' : '100%',
            }}
          >
            <Box
              grow="Yes"
              style={{
                position: 'relative',
              }}
            >
              <iframe
                ref={primaryIframeRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  display: 'flex',
                  width: '100%',
                  height: '100%',
                  border: 'none',
                }}
                title="Persistent Element Call"
                sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-modals allow-downloads"
                allow="microphone; camera; display-capture; autoplay; clipboard-write;"
                src="about:blank"
              />
            </Box>
          </Box>
        </Box>
        {children}
    </PrimaryRefContext.Provider>
  );
}
