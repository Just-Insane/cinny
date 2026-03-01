import { atom } from 'jotai';
import { MatrixClient } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { Membership } from '../../../types/matrix/room';
import { RoomsAction, useBindRoomsWithMembershipsAtom } from './utils';

const baseRoomsAtom = atom<string[]>([]);
export const allRoomsAtom = atom<string[], [RoomsAction], undefined>(
  (get) => get(baseRoomsAtom),
  (get, set, action) => {
    if (action.type === 'INITIALIZE') {
      set(baseRoomsAtom, action.rooms);
      return;
    }
    if (action.type === 'DELETE') {
      set(baseRoomsAtom, (ids) => ids.filter((id) => id !== action.roomId));
      return;
    }
    if (action.type === 'PUT') {
      set(baseRoomsAtom, (ids) => {
        // If room already exists, don't move it. Let Sliding Sync ordering stand.
        if (ids.includes(action.roomId)) {
          return ids;
        }
        // Room is new, add it (Sliding Sync will place it in correct position on next sync)
        return [...ids, action.roomId];
      });
    }
  }
);
export const useBindAllRoomsAtom = (mx: MatrixClient, allRooms: typeof allRoomsAtom) => {
  useBindRoomsWithMembershipsAtom(
    mx,
    allRooms,
    useMemo(() => [Membership.Join], [])
  );
};
