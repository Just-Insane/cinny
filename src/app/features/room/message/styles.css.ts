import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const MessageBase = style({
  position: 'relative',
  '@media': {
    'screen and (max-width: 768px)': {
      userSelect: 'none',
      WebkitUserSelect: 'none',
      MozUserSelect: 'none',
      msUserSelect: 'none',
    },
  },
});

export const MessageOptionsBase = style([
  DefaultReset,
  {
    position: 'absolute',
    top: toRem(-30),
    right: 0,
    zIndex: 1,
  },
]);
export const MessageOptionsBar = style([
  DefaultReset,
  {
    padding: config.space.S100,
  },
]);

export const MessageAvatar = style({
  cursor: 'pointer',
});

export const MessageQuickReaction = style({
  minWidth: toRem(32),
});

export const MessageMenuGroup = style({
  padding: config.space.S100,
});

export const MessageMenuItemText = style({
  flexGrow: 1,
});

export const ReactionsContainer = style({
  selectors: {
    '&:empty': {
      display: 'none',
    },
  },
});

export const ReactionsTooltipText = style({
  wordBreak: 'break-word',
});

export const menuBackdrop = style({
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.35)',
  opacity: 0,
  transition: 'opacity 160ms ease',
});

export const menuBackdropOpen = style({
  opacity: 1,
});

export const menuSheet = style({
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  background: color.Surface.Container,
  borderTopLeftRadius: toRem(16),
  borderTopRightRadius: toRem(16),
  padding: config.space.S300,
  transform: 'translateY(100%)',
  transition: 'transform 200ms ease',
});

export const menuSheetOpen = style({
  transform: 'translateY(0)',
});

export const menuItem = style({
  width: '100%',
  padding: `${config.space.S200} ${config.space.S300}`,
  borderRadius: toRem(12),
  background: 'transparent',
  color: color.Surface.OnContainer,
  textAlign: 'left',
});

export const menuItemDestructive = style({
  color: color.Critical.Main,
});
