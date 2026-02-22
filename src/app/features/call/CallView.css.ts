import { style } from '@vanilla-extract/css';
import { DefaultReset, config } from 'folds';
import { ContainerColor } from '../../styles/ContainerColor.css';

export const CallViewUserGrid = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  alignItems: 'center',
  marginInline: '20px',
  gap: config.space.S400,
});

export const CallViewUser = style([
  DefaultReset,
  ContainerColor({ variant: 'SurfaceVariant' }),
  {
    height: '90px',
    width: '150px',
    borderRadius: config.radii.R500,
  },
]);

export const UserLink = style({
  color: 'inherit',
  minWidth: 0,
  cursor: 'pointer',
  flexGrow: 0,
  transition: 'all ease-out 200ms',
  ':hover': {
    transform: 'translateY(-3px)',
    textDecoration: 'unset',
  },
  ':focus': {
    outline: 'none',
  },
});
