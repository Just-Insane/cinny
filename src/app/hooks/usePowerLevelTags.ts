import { MatrixClient, Room } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { IPowerLevels } from './usePowerLevels';
import { useStateEvent } from './useStateEvent';
import { MemberPowerTag, MemberPowerTagIcon, StateEvent } from '../../types/matrix/room';
import { ThemeKind } from './useTheme';
import { accessibleColor } from '../plugins/color';

export type PowerLevelTagIcon = MemberPowerTagIcon;
export type PowerLevelTag = MemberPowerTag;
export type PowerLevelTags = Record<number, PowerLevelTag>;

const powerSortFn = (a: number, b: number) => b - a;
const sortPowers = (powers: number[]): number[] => powers.sort(powerSortFn);

export const getPowers = (tags: PowerLevelTags): number[] => {
  const powers: number[] = Object.keys(tags)
    .map((p) => {
      const power = parseInt(p, 10);
      if (Number.isNaN(power)) {
        return undefined;
      }
      return power;
    })
    .filter((power) => typeof power === 'number');

  return sortPowers(powers);
};

export const getUsedPowers = (powerLevels: IPowerLevels): Set<number> => {
  const powers: Set<number> = new Set();

  const findAndAddPower = (data: Record<string, unknown>) => {
    Object.keys(data).forEach((key) => {
      const powerOrAny: unknown = data[key];

      if (typeof powerOrAny === 'number') {
        powers.add(powerOrAny);
        return;
      }
      if (powerOrAny && typeof powerOrAny === 'object') {
        findAndAddPower(powerOrAny as Record<string, unknown>);
      }
    });
  };

  findAndAddPower(powerLevels);

  return powers;
};

const DEFAULT_TAGS: PowerLevelTags = {
  9001: {
    name: 'Goku',
    color: '#ff6a00',
  },
  150: {
    name: 'Manager',
    color: '#ff6a7f',
  },
  101: {
    name: 'Founder',
    color: '#0000ff',
  },
  100: {
    name: 'Admin',
    color: '#0088ff',
  },
  50: {
    name: 'Moderator',
    color: '#1fd81f',
  },
  0: {
    name: 'Member',
    color: '#91cfdf',
  },
  [-1]: {
    name: 'Muted',
    color: '#888888',
  },
};

const generateFallbackTag = (powerLevelTags: PowerLevelTags, power: number): PowerLevelTag => {
  const highToLow = sortPowers(getPowers(powerLevelTags));

  const tagPower = highToLow.find((p) => p < power);
  const tag = typeof tagPower === 'number' ? powerLevelTags[tagPower] : undefined;

  return {
    name: tag ? `${tag.name} ${power}` : `Team ${power}`,
  };
};

export const usePowerLevelTags = (room: Room, powerLevels: IPowerLevels): PowerLevelTags => {
  const tagsEvent = useStateEvent(room, StateEvent.PowerLevelTags);

  const powerLevelTags: PowerLevelTags = useMemo(() => {
    const content = tagsEvent?.getContent<PowerLevelTags>();
    const powerToTags: PowerLevelTags = { ...content };

    const powers = getUsedPowers(powerLevels);
    Array.from(powers).forEach((power) => {
      if (powerToTags[power]?.name === undefined) {
        powerToTags[power] = DEFAULT_TAGS[power] ?? generateFallbackTag(DEFAULT_TAGS, power);
      }
    });

    return powerToTags;
  }, [powerLevels, tagsEvent]);

  return powerLevelTags;
};

export const getPowerLevelTag = (
  powerLevelTags: PowerLevelTags,
  powerLevel: number
): PowerLevelTag => {
  const tag: PowerLevelTag | undefined = powerLevelTags[powerLevel];
  return tag ?? generateFallbackTag(powerLevelTags, powerLevel);
};

export type GetPowerLevelTag = (powerLevel: number) => PowerLevelTag;

export const getTagIconSrc = (
  mx: MatrixClient,
  useAuthentication: boolean,
  icon: PowerLevelTagIcon
): string | undefined =>
  icon?.key?.startsWith('mxc://')
    ? mx.mxcUrlToHttp(icon.key, 96, 96, 'scale', undefined, undefined, useAuthentication) ?? '🌻'
    : icon?.key;

export const useAccessibleTagColors = (
  themeKind: ThemeKind,
  powerLevelTags: PowerLevelTags
): Map<string, string> => {
  const accessibleColors: Map<string, string> = useMemo(() => {
    const colors: Map<string, string> = new Map();

    getPowers(powerLevelTags).forEach((power) => {
      const tag = powerLevelTags[power];
      const { color } = tag;
      if (!color) return;

      colors.set(color, accessibleColor(themeKind, color));
    });

    return colors;
  }, [powerLevelTags, themeKind]);

  return accessibleColors;
};
