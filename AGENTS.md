# Ricochet Rush Agent Notes

- Project root: this repository directory.
- Keep all app files, generated assets, and package state inside this repository.
- Canonical local gate: `npm run ci`.
- The game uses `@cursor/sdk` through the local Node API route in `src/server/cursorAgent.ts`; keep browser code free of SDK secrets or auth assumptions.
- Cursor SDK generation is a core gameplay pillar, not decorative demo plumbing.
- Generated bitmap assets live in `public/assets/`.
- Canonical roadmap: `docs/ROADMAP.html`.
- Playwright smoke and UX audits mount `window.__ricochetRushGame` for debug snapshots; production builds do not mount this hook unless explicitly enabled.
- UI/layout changes must protect the playfield as the dominant surface. Do not patch visual regressions one symptom at a time; if a fix makes the UI feel worse, stop, reassess the layout from first principles, and prefer reverting the bad direction over stacking more CSS.
- Before calling UI work done, inspect screenshots at representative desktop, short-wide, tablet, and mobile viewports for human visual hierarchy, not only overlap, bounding-box, or CI/audit pass/fail checks.
