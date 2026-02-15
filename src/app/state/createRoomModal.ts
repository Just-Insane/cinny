import { atom } from 'jotai';
import { CreateRoomVoice } from '../components/create-room/types';

export type CreateRoomModalState = {
  spaceId?: string;
  voice?: CreateRoomVoice;
};

export const createRoomModalAtom = atom<CreateRoomModalState | undefined>(undefined);
