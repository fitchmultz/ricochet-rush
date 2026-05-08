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

Goal: make Cursor SDK the core differentiator, not a hidden implementation detail.

Status: complete as of May 8, 2026.

Deliverables:

- Add a "Board Designer" panel with style, difficulty, density, special-brick bias, and seed-like prompt controls: complete.
- Add reroll, keep, and save-to-pack actions: complete.
- Capture thumbs-up/down and recent events to guide later generation: complete.
- Show a concise public-friendly generation summary instead of raw trace by default: complete.
- Keep raw trace available behind a dev/details panel: complete.

Implementation notes:

- Added a shared board designer intent contract used by the HUD, local fallback generator, Cursor prompt, tests, and smoke path.
- Added visible controls for style, difficulty, density, special-brick bias, and seed phrase.
- Added a Designer target readout so style, density, special mix, hard-brick pressure, and tempo translate into concrete board targets.
- Added generated-board feedback with Good board and Needs work actions. Feedback and recent events are included in later generation requests.
- Updated local fallback generation so designer intent changes the generated wall even without `CURSOR_API_KEY`.
- Updated the Cursor prompt to send exact brick, special-brick, hard-brick, speed, and style-goal targets instead of only vague percentages.
- Added public generation summaries with source, intent chips, validation brick count, and warning text. Raw request, prompt, parsed response, output, and errors remain behind Composer trace details.
- Existing Keep board behavior now acts as the save-to-pack path for generated designs.

Verified:

- `npm run ci` passes.
- Unit coverage validates designer prompt content, designer intent normalization, fallback intent behavior, public generation summaries, and forced fallback summary behavior.
- Playwright smoke coverage verifies designer control persistence, fallback generation summary visibility, generated-board feedback capture, Saved Designs unlock, settings persistence, save/clear flow, keyboard launch, pause, and responsive overflow checks.
- Screenshot review passed for generated-board desktop `1280x820` and mobile `390x760`.

Acceptance criteria:

- The player can request a board with a visible design intent and save the result.
- The generated board remains playable after validation.
- The app still falls back cleanly without `CURSOR_API_KEY`.

### P3.5 - Sidebar And Game UI Simplification

Goal: reduce sidebar clutter while keeping gameplay, board design, pack selection, and settings easy to reach.

Status: complete as of May 8, 2026.

Problem:

- The sidebar now has too many always-visible surfaces: run actions, Board Designer controls, generation summary, board packs, settings, legend, event log, and Composer trace.
- The information is useful, but it competes with itself and makes the game feel more like a control panel than an arcade game.
- Mobile makes this worse because every secondary surface becomes a long vertical stack.

Likely directions:

- Split the right rail into clear modes or tabs: Play, Designer, Packs, and Settings.
- Keep only current board name, primary action, save/keep, and one compact designer or pack summary visible by default.
- Move settings, legend, events, and Composer trace into collapsible details or a separate pause/options surface.
- Show the generated-board summary only when the active board is generated, then collapse it to a one-line chip after launch.
- Let pack selection use a dedicated picker or drawer instead of showing every pack card all the time.
- Keep raw Composer trace as a developer/details panel, never part of the default play rail.

Implementation notes:

- Replaced the overloaded sidebar with a compact Play Console that keeps the current board, hint, primary run actions, tool launchers, and latest event visible.
- Moved Board Designer, Board Select, Options, and Diagnostics into focused drawer panels opened from the Play Console.
- Kept the playfield as the first read on desktop and mobile; secondary tools now dim the board only while intentionally open.
- Moved settings, brick legend, event log, and Composer trace out of the default view.
- Added a compact generated-board summary in the Play Console while the full generation summary stays in the Board Designer panel.
- Updated the smoke path to prove players can open each focused tool surface and still complete the core run/save/settings flow.

Verified:

- `npm run ci` passes.
- Playwright smoke coverage verifies compact Play Console defaults, focused Board Select and Board Designer panels, compact generated summaries, Options settings, save/clear flow, launch/pause behavior, and responsive overflow checks.
- Screenshot review passed for desktop default, desktop Board Designer, desktop Board Select, mobile default, and mobile Options.

Design constraints:

- The first screen should read as a game, not a dashboard.
- Desktop sidebar should fit the default viewport without nested-scroll fatigue.
- Mobile should prioritize the board, current action, and one active secondary mode.
- No user-facing functionality from P2 or P3 should disappear; it should be reorganized with better disclosure.

Acceptance criteria:

- A player can start, design/reroll, keep a generated board, pick a pack, change settings, and inspect trace without hunting.
- The default desktop view has no obvious clutter or awkward nested scroll area.
- The default mobile view feels intentionally stacked rather than like the desktop sidebar dumped into one column.
- Screenshot review passes on desktop and mobile.

### P4 - Audio And Music Upgrade

Goal: replace placeholder synthesized bleeps with a real arcade sound identity.

Status: complete as of May 8, 2026.

Deliverables:

- Original SFX for paddle center, paddle edge, normal brick, hard/metal brick, glass/prize brick, bad power-up, good power-up, extra life, laser, explosion, ball lost, level clear, and game over.
- Optional original music loops for menu, board play, boss board, and score screen.
- Audio settings for sound and music separately.
- Respect reduced-motion/accessibility settings where effects become too intense.

Implementation notes:

- Replaced one-note bleeps with a small procedural arcade sound palette built from Web Audio oscillators and noise bursts.
- Added distinct cues for paddle center, paddle edge, grab catch, hard brick chip, normal brick break, special brick break, boss brick break, good power-up, bad power-up, extra life, level warp, laser, explosion, ball lost, level clear, game over, pause, and resume.
- Added lightweight sound cooldowns so rapid brick chains stay readable instead of turning into a harsh wall of noise.
- Added separate SFX and Music toggles in Options, with backward migration from the previous single Sound setting.
- Added a quiet original procedural music pulse that can be enabled separately from SFX.
- Kept audio asset-free: no third-party or extracted audio files are committed.

Verified:

- `npm run ci` passes.
- Unit coverage verifies new settings normalization and legacy Sound-to-SFX migration.
- Playwright smoke coverage verifies SFX and Music settings apply and persist.

Acceptance criteria:

- Audio communicates game state without looking at the HUD.
- No third-party or extracted commercial game audio is committed without a clear license.

### P5 - Power-Up Clarity And Balance

Goal: turn a big power-up list into legible strategy.

Status: complete as of May 8, 2026.

Deliverables:

- Strong visual distinction between positive, negative, and high-risk power-ups: implemented.
- Floating pickup labels for short-lived clarity: implemented.
- Level-aware drop rates: implemented.
- Combo or streak rewards that bias toward skillful play: implemented.
- Clearer timers and stacking rules for active powers: implemented.

Implementation notes:

- Added reward, hazard, and volatile power-up tones. Falling items now use distinct tint, pulse, scale, and motion treatment by tone.
- Added short pickup labels such as `+Expand paddle`, `-Shrink paddle`, and `! Eight ball` so catches explain themselves without opening a panel.
- Prize and penalty pools now change with board progression. Early boards avoid volatile rewards and hard hazards; later boards introduce more risk.
- High-combo play adds stronger reward options before volatile options enter the early-game pool.
- Timed powers refresh to at least their full duration on repeat pickup and active timer chips now inherit tone colors.

Verified:

- Unit coverage validates early/late prize and penalty pools, high-combo reward bias, and tone classification.
- Build and smoke coverage remain part of the project `npm run ci` gate.
- Screenshot review passed for reward, hazard, and volatile falling items plus pickup labels and active timer chips.
- Playwright smoke coverage verifies reward, hazard, and volatile power-up tone state, pickup labels, and active timer tone styling.

Acceptance criteria:

- A first-time player can tell which falling items are dangerous.
- A returning player can plan around power-up risk and reward.

### P6 - Visual Polish And Original Asset Pass

Goal: make the game look like its own thing.

Status: complete as of May 8, 2026.

Deliverables:

- Original logo, title treatment, and icon: complete.
- Board themes that are not copies of any source game: complete.
- Improved brick materials and hit states: complete.
- Better ball trails, laser effects, level clear effects, and boss feedback: complete.
- Screenshots or short capture clips for README: complete.

Implementation notes:

- Added original Ricochet Rush SVG logo and icon assets under `public/assets/`.
- Added favicon, theme color, and public meta description.
- Added the icon mark to the Play Console so the first viewport carries the product identity.
- Added pack/source theme tinting for the scene background, floor, walls, rim light, and stage border.
- Added a README desktop gameplay screenshot generated from the production preview.

Verified:

- `npm run ci` passes.
- Playwright smoke coverage verifies favicon, loaded brand mark, board theme changes, nonblank WebGL canvas pixels, and no desktop/mobile horizontal overflow.
- Screenshot review passed for the README desktop gameplay image.

Acceptance criteria:

- The first screen reads as a polished game, not a dev canvas.
- Screenshots are clearly original and polished.

### P7 - Playtest, QA, And Demo Readiness

Goal: make it robust enough to share confidently.

Status: complete as of May 8, 2026.

Deliverables:

- Browser playtest checklist for desktop and mobile widths: complete.
- Visual smoke test for canvas rendering and no layout overlap: complete.
- Demo script that shows gameplay first, then the Cursor SDK value: complete.
- Public issue list with known limitations and next bets: complete.

Implementation notes:

- Added `docs/PLAYTEST_CHECKLIST.md` with desktop, mobile, visual, and Cursor SDK checks.
- Added `docs/DEMO_SCRIPT.md` with a gameplay-first recording flow and Cursor SDK proof points.
- Added `docs/KNOWN_LIMITATIONS.md` with public-safe limits and next bets.
- Linked demo and QA docs from the README.
- Strengthened Playwright smoke coverage to include brand asset loading, canvas pixel rendering, desktop panel overlap, mobile rendering, pack-to-generated board theme changes, and power-up tone/label/timer UI.

Verified:

- `npm run ci` passes.
- README, roadmap, checklist, demo script, known limitations, and generated screenshot are aligned.

Acceptance criteria:

- `npm run ci` is green.
- A fresh checkout can install, run, play, save, generate/fallback, and clear progress.
- The first 20 seconds show real gameplay and the AI board-designer value.

## Begin Here

The planned P1-P7 roadmap is implemented. Begin future work with playtest feedback, then promote any confirmed issues or next bets into a new priority section before changing scope.
