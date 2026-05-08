# Roadmap

This is the canonical product roadmap for the project. The public goal is an original browser arcade game inspired by the brick-breaker genre, with adaptive board design powered by the Cursor SDK through a local server route.

Working title: `Ricochet Rush`.

## Product Goals

- Make a game that is fun on its own, not just a technology demo.
- Build an original identity with a simple, game-first name.
- Make the Cursor SDK useful to gameplay: board generation, adaptation, curation, and playtest loops.
- Keep all SDK access server-side. Browser code must not assume secrets or direct SDK auth.
- Keep the game easy to run and verify with `npm run ci`.

## Public Positioning

Use this positioning in public docs until the project is renamed:

> An original 3D browser brick-breaker where an AI board designer creates, validates, and evolves playable arcade layouts.

Public docs should keep the game identity simple and direct. Do not lead with clone language or AI-demo framing.

## Naming Direction

The settled product name is `Ricochet Rush`.

Use this name in public UI, README copy, demo scripts, screenshots, and future repository metadata. Keep the current local directory name for now.

Future repo name: `ricochet-rush`.

## Priority Roadmap

### P0 - Identity Cutover

Goal: give the game a clear original name and consistent public identity.

Deliverables:

- Rename the game title, package metadata, README, UI brand, local storage keys, and docs to `Ricochet Rush`.
- Add a README with one-command setup and a short "AI board designer" explanation.
- Keep private strategy out of tracked files.

Acceptance criteria:

- Public docs and UI use the new name consistently.
- `npm run ci` passes.

### P0.5 - Public Repository Readiness

Goal: create the public GitHub repository only after the working tree is ready to represent the project.

Deliverables:

- Complete the `Ricochet Rush` identity cutover.
- Remove or rewrite old working-name references in README, UI, package metadata, prompts, server logs, and tests.
- Keep `.scratchpad.md` and any private strategy out of tracked files.
- Run a public-surface scan before creating the remote.
- Create a new public GitHub repo named `ricochet-rush` only after the scan and `npm run ci` pass.

Acceptance criteria:

- The repo can be opened by a reviewer or player without private context.
- `git check-ignore -v .scratchpad.md` confirms private notes stay ignored.
- `npm run ci` passes.

### P1 - Game Feel And Physics

Goal: make the core loop feel sharp before adding more surface area.

Deliverables:

- Add paddle spin or "English" based on paddle movement at impact.
- Strengthen edge shots and make controlled angle changes easier to feel.
- Add anti-flat-loop protection so the ball does not get trapped in boring horizontal or vertical paths.
- Tune speed ramping so difficulty rises without turning into unreadable chaos.
- Add a small debug overlay or test hook for ball speed, angle, paddle hit zone, and collision events.

Acceptance criteria:

- A playtest can intentionally aim left, right, shallow, and steep shots.
- No common play loop traps the ball for long stretches.
- Existing smoke tests pass, with added regression coverage for angle constraints if practical.

### P2 - Curated Board Packs

Goal: add the replayable structure that made classic brick-breakers sticky.

Deliverables:

- Create authored packs such as Starter, Classic, Chaos, Precision, and Boss Rush.
- Add board thumbnails or preview cards.
- Add pack progression, unlock state, and best score by pack.
- Let generated boards be promoted into a curated local pack.

Acceptance criteria:

- A player can pick a pack, clear multiple named boards, and return later.
- Generated boards and authored boards share one validation path.

### P3 - Cursor SDK Board Designer Mode

Goal: make Cursor SDK the core differentiator, not a hidden implementation detail.

Deliverables:

- Add a "Board Designer" panel with style, difficulty, density, special-brick bias, and seed-like prompt controls.
- Add reroll, keep, and save-to-pack actions.
- Capture thumbs-up/down and recent events to guide later generation.
- Show a concise public-friendly generation summary instead of raw trace by default.
- Keep raw trace available behind a dev/details panel.

Acceptance criteria:

- The player can request a board with a visible design intent and save the result.
- The generated board remains playable after validation.
- The app still falls back cleanly without `CURSOR_API_KEY`.

### P4 - Audio And Music Upgrade

Goal: replace placeholder synthesized bleeps with a real arcade sound identity.

Deliverables:

- Original SFX for paddle center, paddle edge, normal brick, hard/metal brick, glass/prize brick, bad power-up, good power-up, extra life, laser, explosion, ball lost, level clear, and game over.
- Optional original music loops for menu, board play, boss board, and score screen.
- Audio settings for sound and music separately.
- Respect reduced-motion/accessibility settings where effects become too intense.

Acceptance criteria:

- Audio communicates game state without looking at the HUD.
- No third-party or extracted commercial game audio is committed without a clear license.

### P5 - Power-Up Clarity And Balance

Goal: turn a big power-up list into legible strategy.

Deliverables:

- Strong visual distinction between positive, negative, and high-risk power-ups.
- Floating pickup labels for short-lived clarity.
- Level-aware drop rates.
- Combo or streak rewards that bias toward skillful play.
- Clearer timers and stacking rules for active powers.

Acceptance criteria:

- A first-time player can tell which falling items are dangerous.
- A returning player can plan around power-up risk and reward.

### P6 - Visual Polish And Original Asset Pass

Goal: make the game look like its own thing.

Deliverables:

- Original logo, title treatment, and icon.
- Board themes that are not copies of any source game.
- Improved brick materials and hit states.
- Better ball trails, laser effects, level clear effects, and boss feedback.
- Screenshots or short capture clips for README.

Acceptance criteria:

- The first screen reads as a polished game, not a dev canvas.
- Screenshots are clearly original and polished.

### P7 - Playtest, QA, And Demo Readiness

Goal: make it robust enough to share confidently.

Deliverables:

- Browser playtest checklist for desktop and mobile widths.
- Visual smoke test for canvas rendering and no layout overlap.
- Demo script that shows gameplay first, then the Cursor SDK value.
- Public issue list with known limitations and next bets.

Acceptance criteria:

- `npm run ci` is green.
- A fresh checkout can install, run, play, save, generate/fallback, and clear progress.
- The first 20 seconds show real gameplay and the AI board-designer value.

## Begin Here

Start with P0, then immediately do the smallest P1 game-feel pass. After the rename, tune paddle/ball feel before expanding board packs or demo collateral.
