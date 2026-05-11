# Playtest Checklist

Use this before sharing a build or recording a demo. Run from a clean browser profile or after clearing local storage unless the check is about save/restore.

## Required Gate

```sh
npm run ci
```

The gate must pass before calling the build ready.

## Desktop

- Boot at `1280x820`.
- Confirm the first screen reads as a game: board visible, Play Console compact, Launch focused.
- Launch with keyboard, move left and right, and verify the ball leaves at a readable angle.
- Open Boards, choose Starter, and confirm the drawer closes on selection.
- Open Designer, change style and seed, generate a board, rate it, and keep it.
- Confirm Saved Designs unlocks after keeping a generated board.
- Open Options and toggle high contrast, reduced motion, SFX, music, particles, and ball speed.
- Save the run, reload, confirm it restores, then clear the save and confirm cancellation preserves it.
- Inspect Details and confirm raw composer trace is behind that panel, not in the default play view.

## Mobile Width

- Boot at `390x760`.
- Confirm no horizontal scroll.
- Confirm the board, Play Console, and tool drawer stack without overlapping text or controls.
- Open Designer, Boards, Options, and Details once each.
- Launch, steer left/right, and pause with the on-screen touch controls.

## Visual Checks

- Canvas is nonblank and shows bricks, ball, paddle, walls, and stage border.
- Reward, hazard, and volatile power-ups read as different categories.
- Floating pickup labels do not cover the paddle or the lower-middle playfield for long.
- Active power timers are readable and use tone colors.
- Pack/source theme tint changes are visible without making bricks hard to read.

## Cursor SDK Path

- Without `CURSOR_API_KEY`, generation must fall back quickly and show a public fallback summary.
- With `CURSOR_API_KEY`, generated boards must still pass validation and remain playable.
- Browser code must not expose Cursor SDK secrets or expect direct SDK auth.
