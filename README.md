# Ricochet Rush

<p>
  <img src="public/assets/ricochet-rush-logo.svg" alt="Ricochet Rush logo" width="520" />
</p>

Ricochet Rush is a fast 3D browser brick-breaker with a sharp paddle, angled rebounds, lives, score, multiball, laser and grab paddles, bomb chains, boss bricks, and a power-up atlas.

The game includes curated board packs for repeatable runs, plus a visible board designer for generated walls. The server asks Cursor SDK `composer-2` for new playable wall layouts from the selected design intent, then validates the response into a bounded brick grid. If Cursor auth is missing or the SDK fails, the local fallback generator immediately keeps the run playable.

![Ricochet Rush desktop gameplay](docs/media/ricochet-rush-desktop.png)

<video src="docs/media/ricochet-rush-demo.webm" controls muted playsinline width="960" aria-label="Ricochet Rush gameplay and board designer demo"></video>

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
- Reward, hazard, and volatile power-up categories with readable pickup labels
- Pack/source board theme tints and original Ricochet Rush logo/icon assets
- Responsive desktop and mobile layout

## Verification

```sh
npm run ci
```

The CI gate builds the app, runs unit tests for level/save/pack/designer/power-up contracts, and runs a Playwright smoke against the production preview. The smoke verifies curated-pack boot, designer intent persistence, fallback generation summaries, saved generated boards, feedback capture, board selection, paddle movement, save/clear behavior, settings persistence, canvas rendering, and layout overflow.

Set `CURSOR_API_KEY` to enable live Cursor SDK level generation. Set `RICOCHET_RUSH_FORCE_FALLBACK=1` when deterministic fallback generation is desired.

To refresh the README demo clip after visual changes, run:

```sh
npm run capture:demo
```

## Demo And QA

- [Playtest checklist](docs/PLAYTEST_CHECKLIST.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
