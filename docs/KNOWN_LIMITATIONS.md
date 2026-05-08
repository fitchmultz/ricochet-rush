# Known Limitations

This list is public and should stay practical. It is not a private strategy document.

## Current Limits

- Live Cursor SDK generation requires `CURSOR_API_KEY`; unauthenticated runs use deterministic local fallback generation.
- Progress, saved boards, settings, and best score are local to the current browser storage.
- Mobile works as a responsive browser game, but desktop keyboard play is the best current input path.
- Music is procedural and intentionally lightweight; there are no recorded audio assets yet.
- Bundle size is above Vite's default chunk warning because Three.js and the local game runtime ship together.

## Next Bets

- Add a small onboarding prompt for first-time power-up categories after playtesting confirms the right wording.
- Add optional touch controls if mobile play becomes a primary demo path.
- Split the Three.js runtime into a separate lazy chunk if load time becomes a real issue.
- Add a short capture clip to the README once the final public demo flow is recorded.
