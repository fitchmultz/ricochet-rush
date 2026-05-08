# Ricochet Rush

Ricochet Rush is a fast 3D browser brick-breaker with a sharp paddle, angled rebounds, lives, score, multiball, laser and grab paddles, bomb chains, boss bricks, and a power-up atlas.

The enhancement layer is level design. The server asks Cursor SDK `composer-2` for new playable wall layouts, then validates the response into a bounded brick grid. If Cursor auth is missing or the SDK fails, the local fallback generator immediately keeps the run playable.

## Run

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4177`.

## Controls

- `A/D` or arrow keys: move paddle
- `Space` or `Enter`: launch, continue, or restart
- `P`: pause or resume
- `N`: request a fresh composer-2 board
- Pointer movement over the arena also moves the paddle

## Product Features

- 3D arcade board rendered with Three.js
- Cursor SDK level generation through the local Node API only
- Local fallback levels for offline or unauthenticated play
- Local run checkpoints, restore, clear-save confirmation, and best score
- Settings for ball speed, particles, reduced motion, and high contrast
- Power-ups and penalties covering the classic brick-breaker loop
- Responsive desktop and mobile layout

## Verification

```sh
npm run ci
```

The CI gate builds the app, runs unit tests for level/save contracts, and runs a Playwright smoke against the production preview. The smoke launches the ball, verifies paddle movement, saves a run, changes settings, confirms clear-save behavior, and checks layout overflow.

Set `CURSOR_API_KEY` to enable live Cursor SDK level generation. Set `RICOCHET_RUSH_FORCE_FALLBACK=1` when deterministic fallback generation is desired.
