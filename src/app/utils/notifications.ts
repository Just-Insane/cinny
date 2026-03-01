import { MatrixClient, ReceiptType } from 'matrix-js-sdk';

export async function markAsRead(mx: MatrixClient, roomId: string, privateReceipt: boolean) {
  const room = mx.getRoom(roomId);
  if (!room) return;

  const timeline = room.getLiveTimeline().getEvents();
  const readEventId = room.getEventReadUpTo(mx.getUserId()!);

  const getLatestValidEvent = () => {
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const latestEvent = timeline[i];
      if (latestEvent.getId() === readEventId) return null;
      if (!latestEvent.isSending() && !latestEvent.getRelation()) return latestEvent;
    }
    return null;
  };
  let latestEvent = getLatestValidEvent();
  if (!latestEvent) {
    // we normally avoid advancing the read marker into thread-root events when
    // auto-marking; the user may not have actually read the room timeline itself.
    // however, when the user explicitly requests a mark-as-read we should honour
    // their intent and still advance the marker.  `getLatestValidEvent` already
    // ignores relations and sending events, so the only thing which could make it
    // return null is if we hit the existing read marker, or if the only events
    // after the read marker are thread roots.  the latter case is what was causing
    // some rooms to stick at “1 unread” forever: the click handler would bail out
    // without sending any marker, so the server never updated.  to fix this we
    // fall back to the last live event regardless of its `threadRootId`.
    const fallback = room.getLastLiveEvent();
    if (fallback) {
      latestEvent = fallback;
    }
  }

  // if there's still nothing useful, give up.
  if (!latestEvent) return;
  if (latestEvent.isSending()) {
    latestEvent = getLatestValidEvent() ?? latestEvent;
  }
  if (!latestEvent || latestEvent.getId() === readEventId) return;

  if (privateReceipt) {
    await mx.setRoomReadMarkers(roomId, latestEvent.getId()!, undefined, latestEvent);
  } else {
    await mx.setRoomReadMarkers(roomId, latestEvent.getId()!, latestEvent, undefined);
  }

  // immediately inform our unread tracking logic so the UI updates without
  // waiting for a receipt event from the sync.  we emit a custom event rather
  // than manipulating atoms here to avoid pulling state logic into this util.
  // the SDK typings don't include our internal event so just bypass them.
  (mx as any).emit('internal:markAsRead', roomId);
}
