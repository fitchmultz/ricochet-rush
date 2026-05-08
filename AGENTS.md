# Ricochet Rush Agent Notes

- Project root: this repository directory.
- Keep all app files, generated assets, and package state inside this repository.
- Canonical local gate: `npm run ci`.
- The game uses `@cursor/sdk` through the local Node API route in `src/server/cursorAgent.ts`; keep browser code free of SDK secrets or auth assumptions.
- Cursor SDK generation is a core gameplay pillar, not decorative demo plumbing.
- Generated bitmap assets live in `public/assets/`.
- Canonical roadmap: `docs/ROADMAP.md`.
