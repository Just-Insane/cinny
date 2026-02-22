import { useState, useCallback } from 'react';
import type { AccountDataEvents } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import { useAccountDataCallback } from './useAccountDataCallback';

export function useAccountData(eventType: keyof AccountDataEvents | string) {
  const mx = useMatrixClient();
  const [event, setEvent] = useState(() =>
    mx.getAccountData(eventType as keyof AccountDataEvents)
  );

  useAccountDataCallback(
    mx,
    useCallback(
      (evt) => {
        if (evt.getType() === eventType) {
          setEvent(evt);
        }
      },
      [eventType, setEvent]
    )
  );

  return event;
}
