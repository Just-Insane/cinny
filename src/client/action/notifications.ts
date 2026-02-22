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
    const fallback = room.getLastLiveEvent();
    if (fallback && !fallback.threadRootId) {
      latestEvent = fallback;
    }
  }
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
}
