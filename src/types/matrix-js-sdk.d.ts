import 'matrix-js-sdk';
import type { RoomPinnedEventsEventContent } from 'matrix-js-sdk/lib/types';

declare module 'matrix-js-sdk' {
  interface AccountDataEvents {
    'in.cinny.spaces': Record<string, unknown>;
    'io.element.recent_emoji': unknown;
    'im.ponies.user_emotes': Record<string, unknown>;
    'im.ponies.emote_rooms': Record<string, unknown>;
    'm.direct': Record<string, string[]>;
    'org.cinny.draft.v1': Record<string, unknown>;
  }

  interface StateEvents {
    'im.ponies.room_emotes': Record<string, unknown>;
    'in.cinny.room.power_level_tags': Record<string, unknown>;
    'm.room.pinned_events': RoomPinnedEventsEventContent;
    'org.matrix.msc3401.call.member': Record<string, unknown>;
  }

  interface TimelineEvents {
    'm.reaction': Record<string, unknown>;
  }
}

export {};
