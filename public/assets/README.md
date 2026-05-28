# Asset Manifest

## `powerups.png`

- Type: generated bitmap atlas.
- Current dimensions: 1692 x 929 pixels.
- Runtime layout: `src/client/game/gameVisualConfig.ts` defines atlas order; `src/client/game/gameSceneView.ts` loads the sprite sheet.
- Cell order, left to right and top to bottom:
  1. expandPaddle
  2. shrinkPaddle
  3. superShrink
  4. splitBall
  5. eightBall
  6. megaBall
  7. slowBall
  8. fastBall
  9. fireball
  10. thruBrick
  11. shootingPaddle
  12. grabPaddle
  13. extraLife
  14. levelWarp
  15. zapBricks
  16. fallingBricks
  17. setOffExploding
  18. expandExploding
  19. killPaddle
  20. shrinkBall

No generator is checked in for this baked atlas. If it is replaced, keep the 5x4 order above or update `POWERUP_ORDER` and the atlas constants in `src/client/game/gameVisualConfig.ts` in the same change.
