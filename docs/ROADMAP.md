# Roadmap

This is the canonical product roadmap for the project. The public goal is an original browser arcade game inspired by the brick-breaker genre, with adaptive board design powered by the Cursor SDK through a local server route.

Product name: `Ricochet Rush`.

## Product Goals

- Make a game that is fun on its own, not just a technology demo.
- Build an original identity with a simple, game-first name.
- Make the Cursor SDK useful to gameplay: board generation, adaptation, curation, and playtest loops.
- Keep all SDK access server-side. Browser code must not assume secrets or direct SDK auth.
- Keep the game easy to run and verify with `npm run ci`.

## Public Positioning

Use this positioning in public docs:

> An original 3D browser brick-breaker where an AI board designer creates, validates, and evolves playable arcade layouts.

Public docs should keep the game identity simple and direct. Do not lead with comparison language or AI-demo framing.

## Naming Direction

The settled product name is `Ricochet Rush`.

Use this name in public UI, README copy, demo scripts, screenshots, and repository metadata. Keep the current local directory name for now.

Public repo: `https://github.com/fitchmultz/ricochet-rush`.

## Priority Roadmap

### Done - Identity Cutover

Status: complete as of May 8, 2026.

Completed:

- Renamed the game title, package metadata, README, UI brand, local storage keys, test IDs, prompts, server logs, and docs to `Ricochet Rush`.
- Added a README with one-command setup and a short Cursor SDK level-designer explanation.
- Kept private strategy out of tracked files.
- Published the public GitHub repository as `fitchmultz/ricochet-rush`.
- Rewrote the new public repo to a single clean initial commit.

Verified:

- Public docs and UI use the new name consistently.
- Public surface scan found no tracked old-name or private-strategy references.
- `git check-ignore -v .scratchpad.md` confirms private notes stay ignored.
- `npm run ci` passes.
- `npm audit --audit-level=moderate` passes. Remaining audit items are low-severity transitive `@cursor/sdk`/`sqlite3` chain findings with no available fix.

### P1 - Game Feel And Physics

Goal: make the core loop feel sharp before adding more surface area.

Status: complete. User playtest accepted on May 8, 2026.

Deliverables:

- Add paddle spin or "English" based on paddle movement at impact.
- Strengthen edge shots and make controlled angle changes easier to feel.
- Add anti-flat-loop protection so the ball does not get trapped in boring horizontal or vertical paths.
- Tune speed ramping so difficulty rises without turning into unreadable chaos.
- Add a small debug overlay or test hook for ball speed, angle, paddle hit zone, and collision events.

Slice 1 - Paddle Rebound Control: complete

- Track paddle velocity each frame.
- Feed paddle velocity into paddle collision so moving into the ball adds controlled spin.
- Clamp launch and rebound angles to avoid boring vertical/horizontal loops.
- Add a focused unit test or smoke assertion for minimum horizontal velocity after paddle hits.
- Playtest the first board and tune constants until edge hits feel intentional.

Slice 2 - Collision Consistency: complete

- Review wall and brick collision for repeated shallow loops.
- Add rebound normalization only where the loop can actually get stuck.
- Keep piercing, fireball, mega ball, and laser behavior unchanged.

Slice 3 - Tuning And Debug: complete

- Expose debug snapshot fields for paddle velocity and last paddle hit.
- Tune min/max rebound angles, paddle spin transfer, and speed ramp constants.
- Capture a short manual playtest note in the roadmap before moving to P2.

Implementation notes:

- Paddle rebound uses hit zone plus paddle velocity to create controlled spin.
- Launch, paddle, wall, and normal brick bounces now keep enough cross-axis velocity to avoid straight-line loops.
- Wall and normal brick loop correction preserves ball speed and is skipped for piercing modes.
- Debug snapshot exposes `paddleVelocityX`, `lastPaddleHit`, and `lastLoopCorrection` for playtest inspection.
- Automated coverage includes paddle rebound, collision normalization, launch loop checks, and the full Playwright smoke path.

Playtest note:

- User reported P1 feels good enough to move on. Treat future physics changes as tuning, not a blocker for P2.

Acceptance criteria:

- A playtest can intentionally aim left, right, shallow, and steep shots.
- No common play loop traps the ball for long stretches.
- Existing smoke tests pass, with added regression coverage for angle constraints if practical.

### P2 - Curated Board Packs

Goal: add the replayable structure that makes brick-breakers sticky.

Status: complete as of May 8, 2026.

Deliverables:

- Create authored packs such as Starter, Classic, Chaos, Precision, and Boss Rush: complete.
- Add board thumbnails or preview cards: complete.
- Add pack progression, unlock state, and best score by pack: complete.
- Let generated boards be promoted into a curated local pack: complete.

Implementation notes:

- Added five built-in packs with three named boards each: Starter, Classic, Chaos, Precision, and Boss Rush.
- Boot now starts on the Starter pack instead of immediately generating the first board.
- Board pack cards show compact previews, active/locked/empty state, cleared count, and best score.
- Pack progress persists locally, unlocks the next built-in pack when the previous pack is cleared, and resumes from the next uncleared board.
- Generated boards can be kept in the local Saved Designs pack.
- Authored boards and saved generated boards both pass through the shared level validation path before play.

Verified:

- `npm run ci` passes.
- Unit coverage validates authored boards, unlock progression, saved-board shape, and current/v1/v2 save-state migration.
- Playwright smoke coverage verifies Starter boot, pack cards, Saved Designs unlock after keeping a generated board, settings persistence, save/clear flow, keyboard launch, pause, and responsive overflow checks.
- Screenshot review passed for desktop `1280x820` and mobile `390x760`.

Acceptance criteria:

- A player can pick a pack, clear multiple named boards, and return later.
- Generated boards and authored boards share one validation path.

### P3 - Cursor SDK Board Designer Mode

Goal: make Cursor SDK the core differentiator, not a hidden implementation detail. This is the next active priority.

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

Start with P2. Build a small curated-board foundation before adding broader audio, visual polish, or demo collateral.
