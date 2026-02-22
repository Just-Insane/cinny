import { style } from '@vanilla-extract/css';
import { config } from 'folds';

export const Actions = style({
  padding: config.space.S200,
});

export const RoomButtonWrap = style({
  minWidth: 0,
});

export const RoomButton = style({
  width: '100%',
  minWidth: 0,
  padding: `0 ${config.space.S200}`,
});

export const RoomName = style({
  flexGrow: 1,
  minWidth: 0,
});
