import {
  ICreateRoomOpts,
  ICreateRoomStateEvent,
  JoinRule,
  MatrixClient,
  RestrictedAllowType,
  Room,
} from 'matrix-js-sdk';
import { RoomJoinRulesEventContent } from 'matrix-js-sdk/lib/types';
import { CreateRoomKind } from './CreateRoomKindSelector';
import { RoomType, StateEvent } from '../../../types/matrix/room';
import { getViaServers } from '../../plugins/via-servers';
import { getMxIdServer } from '../../utils/matrix';
import { IPowerLevels } from '../../hooks/usePowerLevels';

export const createRoomCreationContent = (
  type: RoomType | undefined,
  allowFederation: boolean,
  additionalCreators: string[] | undefined
): object => {
  const content: Record<string, any> = {};
  if (typeof type === 'string') {
    content.type = type;
  }
  if (allowFederation === false) {
    content['m.federate'] = false;
  }
  if (Array.isArray(additionalCreators)) {
    content.additional_creators = additionalCreators;
  }

  return content;
};

export const createRoomJoinRulesState = (
  kind: CreateRoomKind,
  parent: Room | undefined,
  knock: boolean
) => {
  let content: RoomJoinRulesEventContent = {
    join_rule: knock ? JoinRule.Knock : JoinRule.Invite,
  };

  if (kind === CreateRoomKind.Public) {
    content = {
      join_rule: JoinRule.Public,
    };
  }

  if (kind === CreateRoomKind.Restricted && parent) {
    content = {
      join_rule: knock ? ('knock_restricted' as JoinRule) : JoinRule.Restricted,
      allow: [
        {
          type: RestrictedAllowType.RoomMembership,
          room_id: parent.roomId,
        },
      ],
    };
  }

  return {
    type: StateEvent.RoomJoinRules,
    state_key: '',
    content,
  };
};

export const createRoomParentState = (parent: Room) => ({
  type: StateEvent.SpaceParent,
  state_key: parent.roomId,
  content: {
    canonical: true,
    via: getViaServers(parent),
  },
});

export const createRoomEncryptionState = () => ({
  type: 'm.room.encryption',
  state_key: '',
  content: {
    algorithm: 'm.megolm.v1.aes-sha2',
  },
});

export const createRoomCallState = () => ({
  type: 'org.matrix.msc3401.call',
  state_key: '',
  content: {},
});

export const createPowerLevelContentOverrides = (
  base: IPowerLevels,
  overrides: Partial<IPowerLevels>
): IPowerLevels => ({
  ...base,
  ...overrides,
  ...(base.events || overrides.events
    ? {
        events: {
          ...base.events,
          ...overrides.events,
        },
      }
    : {}),
  ...(base.users || overrides.users
    ? {
        users: {
          ...base.users,
          ...overrides.users,
        },
      }
    : {}),
  ...(base.notifications || overrides.notifications
    ? {
        notifications: {
          ...base.notifications,
          ...overrides.notifications,
        },
      }
    : {}),
});

export type CreateRoomData = {
  version: string;
  type?: RoomType;
  parent?: Room;
  kind: CreateRoomKind;
  name: string;
  topic?: string;
  aliasLocalPart?: string;
  encryption?: boolean;
  knock: boolean;
  allowFederation: boolean;
  additionalCreators?: string[];
  powerLevelContentOverrides?: IPowerLevels;
};
export const createRoom = async (mx: MatrixClient, data: CreateRoomData): Promise<string> => {
  const initialState: ICreateRoomStateEvent[] = [];

  if (data.encryption) {
    initialState.push(createRoomEncryptionState());
  }

  if (data.parent) {
    initialState.push(createRoomParentState(data.parent));
  }

  if (data.type === RoomType.Call) {
    initialState.push(createRoomCallState());
  }

  initialState.push(createRoomJoinRulesState(data.kind, data.parent, data.knock));

  const options: ICreateRoomOpts = {
    room_version: data.version,
    name: data.name,
    topic: data.topic,
    room_alias_name: data.aliasLocalPart,
    creation_content: createRoomCreationContent(
      data.type,
      data.allowFederation,
      data.additionalCreators
    ),
    initial_state: initialState,
  };

  const result = await mx.createRoom(options);

  if (data.parent) {
    await mx.sendStateEvent(
      data.parent.roomId,
      StateEvent.SpaceChild as any,
      {
        auto_join: false,
        suggested: false,
        via: [getMxIdServer(mx.getUserId() ?? '') ?? ''],
      },
      result.room_id
    );
  }

  if (data.powerLevelContentOverrides) {
    const roomPowers = await mx.getStateEvent(result.room_id, StateEvent.RoomPowerLevels, '');
    const updatedPowers = createPowerLevelContentOverrides(
      roomPowers,
      data.powerLevelContentOverrides
    );

    await mx.sendStateEvent(result.room_id, StateEvent.RoomPowerLevels as any, updatedPowers, '');
  }

  return result.room_id;
};
