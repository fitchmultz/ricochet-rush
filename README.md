# Ricochet Rush

Ricochet Rush is a fast 3D browser brick-breaker with a sharp paddle, angled rebounds, lives, score, multiball, laser and grab paddles, bomb chains, boss bricks, and a power-up atlas.

The game includes curated board packs for repeatable runs, plus a visible board designer for generated walls. The server asks Cursor SDK `composer-2` for new playable wall layouts from the selected design intent, then validates the response into a bounded brick grid. If Cursor auth is missing or the SDK fails, the local fallback generator immediately keeps the run playable.

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
- `N`: design or reroll a generated board
- Pointer movement over the arena also moves the paddle

## Product Features

- 3D arcade board rendered with Three.js
- Authored board packs with unlock progress, preview cards, and best score by pack
- Board Designer controls for style, difficulty, density, special-brick bias, and seed phrase
- Cursor SDK level generation through the local Node API only
- Public generation summary with raw composer trace kept behind a details panel
- Thumbs-up/down feedback that guides later generated boards
- Saved Designs pack for generated boards you decide to keep
- Local fallback levels for offline or unauthenticated play
- Local run checkpoints, restore, clear-save confirmation, and best score
- Settings for ball speed, particles, reduced motion, and high contrast
- Power-ups and penalties covering the classic brick-breaker loop
- Responsive desktop and mobile layout

## Verification

```sh
npm run ci
```

The CI gate builds the app, runs unit tests for level/save/pack/designer contracts, and runs a Playwright smoke against the production preview. The smoke verifies curated-pack boot, designer intent persistence, fallback generation summaries, saved generated boards, feedback capture, paddle movement, save/clear behavior, settings persistence, and layout overflow.

Set `CURSOR_API_KEY` to enable live Cursor SDK level generation. Set `RICOCHET_RUSH_FORCE_FALLBACK=1` when deterministic fallback generation is desired.
