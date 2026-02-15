import React from 'react';
import { Box, Text, Icon, Icons, config, IconSrc } from 'folds';
import { SequenceCard } from '../sequence-card';
import { SettingTile } from '../setting-tile';
import { CreateRoomVoice } from './types';

type CreateRoomVoiceSelectorProps = {
  value?: CreateRoomVoice;
  onSelect: (value: CreateRoomVoice) => void;
  disabled?: boolean;
  getIcon: (kind: CreateRoomVoice) => IconSrc;
};
export function CreateRoomVoiceSelector({
  value,
  onSelect,
  disabled,
  getIcon,
}: CreateRoomVoiceSelectorProps) {
  return (
    <Box shrink="No" direction="Column" gap="100">
      <SequenceCard
        style={{ padding: config.space.S300 }}
        variant={value === CreateRoomVoice.TextRoom ? 'Primary' : 'SurfaceVariant'}
        direction="Column"
        gap="100"
        as="button"
        type="button"
        aria-pressed={value === CreateRoomVoice.TextRoom}
        onClick={() => onSelect(CreateRoomVoice.TextRoom)}
        disabled={disabled}
      >
        <SettingTile
          before={<Icon size="400" src={getIcon(CreateRoomVoice.TextRoom)} />}
          after={value === CreateRoomVoice.TextRoom && <Icon src={Icons.Check} />}
        >
          <Text size="H6">Text</Text>
          <Text size="T300" priority="300">
            Send text messages, videos and GIFs.
          </Text>
        </SettingTile>
      </SequenceCard>
      <SequenceCard
        style={{ padding: config.space.S300 }}
        variant={value === CreateRoomVoice.VoiceRoom ? 'Primary' : 'SurfaceVariant'}
        direction="Column"
        gap="100"
        as="button"
        type="button"
        aria-pressed={value === CreateRoomVoice.VoiceRoom}
        onClick={() => onSelect(CreateRoomVoice.VoiceRoom)}
        disabled={disabled}
      >
        <SettingTile
          before={<Icon size="400" src={getIcon(CreateRoomVoice.VoiceRoom)} />}
          after={value === CreateRoomVoice.VoiceRoom && <Icon src={Icons.Check} />}
        >
          <Text size="H6">Voice</Text>
          <Text size="T300" priority="300">
            A room optimized for voice calls.
          </Text>
        </SettingTile>
      </SequenceCard>
    </Box>
  );
}
