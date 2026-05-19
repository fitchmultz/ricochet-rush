# Playtest Checklist

Use this before sharing a build or recording a demo. Run from a clean browser profile or after clearing local storage unless the check is about save/restore.

## Required Gate

```sh
npm run ci
```

The gate must pass before calling the build ready.

For a focused automated visual/playability pass, run:

```sh
npm run ux
```

Optional live Cursor SDK probe, only when credentials are available:

```sh
npm run sdk:probe
npm run sdk:reliability
```

The probe skips cleanly without `CURSOR_API_KEY`. With a key, it runs up to five server-side SDK generations, verifies trace evidence, validates the compact grid using the same pad/trim rules as production, and confirms the materialized board is playable.

The reliability script simulates five continue-after-clear generations. It fails on any fallback board and reports unique names/layouts. It also runs one icon-mode smiley prompt and checks creative fidelity. Server-side generation retries up to three composer-2.5 attempts before falling back. Client timeout matches the full server retry budget (240s).

The UX audit captures desktop and mobile screenshots in `dist/playtest-report/screenshots/` and writes `dist/playtest-report/report.md` plus `report.json`. Treat failures as blockers. Treat warnings as the next polish queue for Codex before asking for manual visual review.

## Desktop

- Boot at `1280x820`.
- Confirm the first screen reads as a game: board visible, Play Console compact, Launch focused.
- Launch with keyboard, move left and right, and verify the ball leaves at a readable angle.
- Open Boards, choose Starter, and confirm the drawer closes on selection.
- Open Designer, type a short board prompt with spaces, generate a board, and keep it.
- Confirm Saved Designs unlocks after keeping a generated board.
- Open Share, export board JSON, reject malformed import JSON, and render a local score-card PNG.
- Open Today's Board and confirm it uses local-only daily language.
- Open Options, toggle high contrast, reduced motion, and particles, then adjust SFX and music volume.
- Confirm autosave restores after reload, then clear the save from Options and confirm cancellation preserves it.
- Inspect Log and confirm raw generation trace is behind that panel, not in the default play view.

## Mobile Width

- Boot at `390x760`.
- Confirm no horizontal scroll.
- Confirm the board, Play Console, and tool drawer stack without overlapping text or controls.
- Open Designer, Boards, Options, and Log once each.
- Drag over the arena to aim without page scroll, then launch, steer left/right, and pause with the on-screen touch controls.

## Visual Checks

- Canvas is nonblank and shows bricks, ball, paddle, walls, and stage border.
- Reward, hazard, and volatile power-ups read as different categories.
- Floating pickup labels do not cover the paddle or the lower-middle playfield for long.
- Active power timers are readable and use tone colors.
- Pack/source theme tint changes are visible without making bricks hard to read.

## Cursor SDK Path

- Without `CURSOR_API_KEY`, generation must fall back quickly and show a public fallback summary.
- With `CURSOR_API_KEY`, generated boards must still pass validation and remain playable.
- Freeform briefs such as `heart shape, only bomb bricks` must visibly steer both Cursor SDK generation and local fallback.
- In Log, successful live SDK generations should show a compact `grid` draft before local validation materializes the board.
- Stalled generation must recover to a local fallback instead of leaving the game on the Generating overlay.
- Browser code must not expose Cursor SDK secrets or expect direct SDK auth.
