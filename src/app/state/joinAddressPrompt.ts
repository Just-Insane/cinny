import { atom } from 'jotai';

export type JoinAddressPromptState = {
  term?: string;
};

export const joinAddressPromptAtom = atom<JoinAddressPromptState | undefined>(undefined);
