import { atom } from 'jotai';
import { CreateRoomVoice } from '../components/create-room/CreateRoomVoiceSelector';

export type CreateRoomModalState = {
  spaceId?: string;
  voice?: CreateRoomVoice;
};

export const createRoomModalAtom = atom<CreateRoomModalState | undefined>(undefined);
