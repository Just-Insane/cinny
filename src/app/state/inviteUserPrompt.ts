import { atom } from 'jotai';

export type InviteUserPromptState = {
  roomId: string;
  searchTerm?: string;
};

export const inviteUserPromptAtom = atom<InviteUserPromptState | undefined>(undefined);
