# Known Limitations

This list is public and should stay practical. It is not a private strategy document.

## Current Limits

- Live Cursor SDK generation requires `CURSOR_API_KEY`; unauthenticated runs use deterministic local fallback generation.
- Progress, saved boards, settings, and best score are local to the current browser storage.
- Mobile works as a responsive browser game with on-screen touch controls, while desktop keyboard play remains the crispest input path.
- Music is procedural and intentionally lightweight; there are no recorded audio assets yet.
- First game load still includes the Three.js vendor chunk; the local game runtime is split from it.
