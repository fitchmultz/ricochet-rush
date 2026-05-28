import * as THREE from "three";
import type { BrickKind } from "../../shared/evolution";
import type { GameCosmetics, GameSettings } from "../../shared/saveState";
import { clamp } from "../../shared/util";
import { HEIGHT, PADDLE_Y, WALL, WIDTH, BRICK_HEIGHT, BRICK_WIDTH, MAX_BALL_SPEED, toWorld } from "./gameArena";
import type { Ball, BallVisual, Brick, FloatingText, LaserBeam, Powerup, Spark } from "./gameEntityTypes";
import { BALL_TRAIL_MIN_SPEED, BRICK_VISUALS, COLORS, POWERUP_ATLAS_COLUMNS, POWERUP_ATLAS_ROWS, POWERUP_NAMES, POWERUP_ORDER, POWERUP_VISUALS } from "./gameVisualConfig";
import { ballCosmeticColor, boardBackplateCosmetic, boardThemeFor, paddleCosmetic, powerupVisualFor, pseudoRandom } from "./gameRuntimeHelpers";
import type { BoardContext } from "./gameEntityTypes";
import type { PowerupKind, PowerupTone } from "./powerups";
import { powerupToneFor } from "./powerups";

export interface SceneFrame {
  bricks: Brick[];
  balls: Ball[];
  powerups: Powerup[];
  laserBeams: LaserBeam[];
  sparks: Spark[];
  floatingTexts: FloatingText[];
  paddleX: number;
  paddleWidth: number;
  paddleFlashTimer: number;
  lifeFlashTimer: number;
  laserTimer: number;
  boardContext: BoardContext;
  cosmetics: GameCosmetics;
  settings: GameSettings;
  brickImpactTimers: Map<Brick, number>;
  boardShakeTimer: number;
  boardShakeStrength: number;
  levelClearFlashTimer: number;
  phaseLabel: string;
  level: number;
  lives: number;
}

export class GameSceneView {
  private static readonly MAX_SPARKS = 180;

  readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-WIDTH / 2, WIDTH / 2, HEIGHT / 2, -HEIGHT / 2, 1, 1800);
  readonly board = new THREE.Group();
  readonly backgroundGroup = new THREE.Group();
  readonly bricksGroup = new THREE.Group();
  readonly ballsGroup = new THREE.Group();
  readonly powerupsGroup = new THREE.Group();
  readonly lasersGroup = new THREE.Group();
  readonly sparksGroup = new THREE.Group();
  private readonly brickMeshes = new Map<Brick, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();
  private readonly brickRims = new Map<Brick, THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>>();
  private readonly brickShadows = new Map<Brick, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>();
  private readonly ballMeshes = new Map<Ball, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>();
  private readonly ballVisuals = new Map<Ball, BallVisual>();
  private readonly powerupObjects = new Map<Powerup, THREE.Object3D>();
  private readonly laserObjects = new Map<LaserBeam, THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>>();
  private readonly brickGeometry = new THREE.BoxGeometry(BRICK_WIDTH, BRICK_HEIGHT, 22, 2, 2, 1);
  private readonly brickRimGeometry = new THREE.EdgesGeometry(this.brickGeometry, 28);
  private readonly brickShadowGeometry = new THREE.PlaneGeometry(BRICK_WIDTH * 1.16, BRICK_HEIGHT * 1.42);
  private readonly paddleGeometry = new THREE.BoxGeometry(1, 1, 1, 3, 1, 1);
  private readonly paddleGlowGeometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  private readonly paddleSpecularGeometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  private readonly ballGeometry = new THREE.SphereGeometry(1, 28, 18);
  private readonly ballGlowGeometry = new THREE.SphereGeometry(1, 24, 12);
  private readonly fallbackPowerupGeometry = new THREE.BoxGeometry(38, 24, 10, 2, 1, 1);
  private readonly backdropMaterial = new THREE.MeshBasicMaterial({ color: "#07111d", transparent: true, opacity: 0.74, depthWrite: false });
  private readonly backdropFogMaterial = new THREE.MeshBasicMaterial({ color: "#4ecdc4", transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly backdropGridMaterial = new THREE.LineBasicMaterial({ color: "#7ef1ff", transparent: true, opacity: 0.24, depthWrite: false });
  private readonly backdropStarMaterial = new THREE.PointsMaterial({ color: "#8aefff", size: 2.4, transparent: true, opacity: 0.66, sizeAttenuation: false, depthWrite: false });
  private readonly floorMaterial = new THREE.MeshStandardMaterial({ color: "#07111d", metalness: 0.35, roughness: 0.58 });
  private readonly wallMaterial = new THREE.MeshStandardMaterial({ color: "#18263a", emissive: "#4ecdc4", emissiveIntensity: 0.22, metalness: 0.74, roughness: 0.2 });
  private readonly brickMaterials = new Map<BrickKind, THREE.MeshStandardMaterial>();
  private readonly powerupMaterials = new Map<PowerupKind, THREE.SpriteMaterial>();
  private readonly fallbackPowerupMaterials = new Map<PowerupTone, THREE.MeshStandardMaterial>();
  private readonly paddleGlowMaterial = new THREE.MeshBasicMaterial({ color: "#7ef1ff", transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly paddleSpecularMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly rimLight = new THREE.PointLight("#ff4d8d", 1.8, 940);
  private readonly paddleMesh = new THREE.Mesh(
    this.paddleGeometry,
    new THREE.MeshStandardMaterial({ color: "#e9ffff", emissive: "#35f3ff", emissiveIntensity: 0.48, metalness: 0.92, roughness: 0.12 })
  );
  private readonly paddleGlowMesh = new THREE.Mesh(this.paddleGlowGeometry, this.paddleGlowMaterial);
  private readonly paddleSpecularMesh = new THREE.Mesh(this.paddleSpecularGeometry, this.paddleSpecularMaterial);
  private sparksPoints: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  private sparksPositionBuffer: Float32Array | null = null;
  private sparksColorBuffer: Float32Array | null = null;

  constructor(private readonly mount: HTMLDivElement) {}

  installPowerupAtlas(onReady: () => void, onFallback: () => void) {
    this.loadPowerupAtlas(onReady, onFallback);
  }

  private readonly floatingTextNodes = new Map<number, HTMLDivElement>();

  setupRenderer() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(WIDTH, HEIGHT, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color("#050910");
    this.camera.position.set(0, -48, 980);
    this.camera.lookAt(0, 0, 0);
  }

  setupScene() {
    this.board.rotation.x = -0.08;
    this.scene.add(this.board);
    this.board.add(
      this.backgroundGroup,
      this.bricksGroup,
      this.ballsGroup,
      this.powerupsGroup,
      this.lasersGroup,
      this.sparksGroup,
      this.paddleGlowMesh,
      this.paddleMesh,
      this.paddleSpecularMesh
    );

    const ambient = new THREE.AmbientLight("#bfd8ff", 1.38);
    const key = new THREE.DirectionalLight("#ffffff", 2.75);
    key.position.set(-290, 330, 820);
    key.castShadow = true;
    key.shadow.mapSize.width = 1536;
    key.shadow.mapSize.height = 1536;
    key.shadow.camera.near = 120;
    key.shadow.camera.far = 1200;
    this.rimLight.position.set(470, 125, 340);
    this.scene.add(ambient, key, this.rimLight);
    this.setupBackdrop();

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH - WALL * 2, HEIGHT - WALL * 2), this.floorMaterial);
    floor.position.set(0, 0, -20);
    floor.receiveShadow = true;
    this.board.add(floor);

    const topWall = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, 18, 34), this.wallMaterial);
    topWall.position.copy(toWorld(WIDTH / 2, WALL / 2, 4));
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(18, HEIGHT - WALL, 34), this.wallMaterial);
    leftWall.position.copy(toWorld(WALL / 2, HEIGHT / 2, 4));
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(18, HEIGHT - WALL, 34), this.wallMaterial);
    rightWall.position.copy(toWorld(WIDTH - WALL / 2, HEIGHT / 2, 4));
    const bottomWall = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, 18, 18), this.wallMaterial);
    bottomWall.position.copy(toWorld(WIDTH / 2, HEIGHT - WALL / 2, -2));
    this.board.add(topWall, leftWall, rightWall, bottomWall);

    for (const kind of Object.keys(COLORS) as BrickKind[]) {
      const color = COLORS[kind];
      const visual = BRICK_VISUALS[kind];
      this.brickMaterials.set(
        kind,
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: visual.emissiveIntensity,
          metalness: visual.metalness,
          roughness: visual.roughness
        })
      );
    }
    this.paddleMesh.castShadow = true;
    this.paddleMesh.receiveShadow = true;
    this.paddleGlowMesh.renderOrder = 2;
    this.paddleSpecularMesh.renderOrder = 4;
  }

  setupBackdrop() {
    const field = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH * 1.08, HEIGHT * 1.1), this.backdropMaterial);
    field.position.set(0, 0, -72);
    const fog = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH * 0.96, HEIGHT * 0.54), this.backdropFogMaterial);
    fog.position.set(0, 74, -16);
    fog.scale.set(1, 1.18, 1);
    this.backgroundGroup.add(field, fog, this.createBackdropGrid(), this.createStarfield());
  }

  createBackdropGrid() {
    const points: number[] = [];
    const left = -WIDTH / 2 + WALL;
    const right = WIDTH / 2 - WALL;
    const top = HEIGHT / 2 - WALL;
    const bottom = -HEIGHT / 2 + WALL;
    for (let x = left; x <= right; x += 64) points.push(x, bottom, -15, x, top, -15);
    for (let y = bottom; y <= top; y += 48) points.push(left, y, -15, right, y, -15);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return new THREE.LineSegments(geometry, this.backdropGridMaterial);
  }

  createStarfield() {
    const count = 260;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = pseudoRandom(index, 17) * WIDTH - WIDTH / 2;
      positions[index * 3 + 1] = pseudoRandom(index, 41) * HEIGHT - HEIGHT / 2;
      positions[index * 3 + 2] = -13 - pseudoRandom(index, 73) * 6;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(geometry, this.backdropStarMaterial);
  }

  loadPowerupAtlas(onReady: () => void, onFallback: () => void) {
    new THREE.TextureLoader().load(
      "/assets/powerups.png",
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        for (const [index, kind] of POWERUP_ORDER.entries()) {
          const map = texture.clone();
          const visual = powerupVisualFor(kind);
          map.colorSpace = THREE.SRGBColorSpace;
          map.repeat.set(1 / POWERUP_ATLAS_COLUMNS, 1 / POWERUP_ATLAS_ROWS);
          map.offset.set((index % POWERUP_ATLAS_COLUMNS) / POWERUP_ATLAS_COLUMNS, 1 - (Math.floor(index / POWERUP_ATLAS_COLUMNS) + 1) / POWERUP_ATLAS_ROWS);
          map.needsUpdate = true;
          this.powerupMaterials.set(kind, new THREE.SpriteMaterial({ map, color: visual.tint, transparent: true }));
        }
        onReady();
      },
      undefined,
      onFallback
    );
  }

  updateCanvasLabel(frame: SceneFrame) {
    this.renderer.domElement.setAttribute(
      "aria-label",
      `Ricochet Rush. ${frame.phaseLabel}. Level ${frame.level}. ${frame.lives} lives. ${frame.bricks.length} bricks remain.`
    );
    this.renderer.domElement.setAttribute(
      "aria-keyshortcuts",
      "ArrowLeft move left, ArrowRight move right, Space launch or continue, P pause, N design board, Escape close panels"
    );
  }

  applyBoardTheme(frame: SceneFrame) {
    const theme = boardThemeFor(frame.boardContext);
    const backplate = boardBackplateCosmetic(frame.cosmetics.boardBackplate, theme, frame.settings.highContrast);
    this.scene.background = new THREE.Color(backplate.scene);
    this.floorMaterial.color.set(backplate.floor);
    this.wallMaterial.color.set(theme.wall);
    this.wallMaterial.emissive.set(backplate.wallGlow);
    this.backdropMaterial.color.set(backplate.floor);
    this.backdropFogMaterial.color.set(backplate.wallGlow);
    this.backdropGridMaterial.color.set(backplate.rim);
    this.backdropStarMaterial.color.set(backplate.rim);
    this.rimLight.color.set(backplate.rim);
    const stage = this.mount.closest<HTMLElement>(".stage");
    stage?.style.setProperty("--stage-border-color", `${theme.wallGlow}66`);
    stage?.style.setProperty("--stage-glow-color", `${theme.wallGlow}2f`);
  }

  render(frame: SceneFrame, effectsLayer: HTMLDivElement) {
    this.syncBricks(frame);
    this.syncPaddle(frame);
    this.syncBalls(frame);
    this.syncPowerups(frame);
    this.syncLasers(frame);
    this.syncSparks(frame);
    this.syncFloatingTexts(frame, effectsLayer);
    const now = performance.now();
    const shake = frame.boardShakeTimer > 0 && !frame.settings.reducedMotion ? (Math.random() - 0.5) * frame.boardShakeStrength : 0;
    this.board.rotation.z = frame.settings.reducedMotion ? 0 : Math.sin(now / 3600) * 0.006 + shake * 0.002;
    this.board.position.x = shake;
    this.board.position.y = frame.levelClearFlashTimer > 0 && !frame.settings.reducedMotion ? Math.sin(now / 38) * 1.2 : 0;
    this.backgroundGroup.rotation.z = frame.settings.reducedMotion ? 0 : Math.sin(now / 12000) * 0.004;
    this.backgroundGroup.position.x = frame.settings.reducedMotion ? 0 : Math.sin(now / 9000) * 3.2;
    this.backgroundGroup.position.y = frame.settings.reducedMotion ? 0 : Math.cos(now / 11000) * 2.2;
    this.renderer.render(this.scene, this.camera);
  }

  private syncBricks(frame: SceneFrame) {
    for (const [brick, mesh] of this.brickMeshes) {
      if (!frame.bricks.includes(brick)) {
        this.bricksGroup.remove(mesh);
        mesh.material.dispose();
        this.brickMeshes.delete(brick);
        this.removeBrickAccents(brick);
      }
    }
    const now = performance.now();
    for (const brick of frame.bricks) {
      const visual = BRICK_VISUALS[brick.kind];
      let mesh = this.brickMeshes.get(brick);
      let rim = this.brickRims.get(brick);
      let shadow = this.brickShadows.get(brick);
      if (!mesh) {
        const template = this.brickMaterials.get(brick.kind) ?? this.brickMaterials.get("basic");
        if (!template) continue;
        const material = template.clone();
        mesh = new THREE.Mesh(this.brickGeometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.renderOrder = 2;
        rim = new THREE.LineSegments(
          this.brickRimGeometry,
          new THREE.LineBasicMaterial({ color: visual.rim, transparent: true, opacity: visual.rimOpacity, depthWrite: false })
        );
        rim.renderOrder = 3;
        shadow = new THREE.Mesh(
          this.brickShadowGeometry,
          new THREE.MeshBasicMaterial({ color: visual.shadow, transparent: true, opacity: 0.22, depthWrite: false })
        );
        shadow.renderOrder = 1;
        this.brickMeshes.set(brick, mesh);
        this.brickRims.set(brick, rim);
        this.brickShadows.set(brick, shadow);
        this.bricksGroup.add(shadow, mesh, rim);
      }
      if (!rim || !shadow) continue;
      const material = mesh.material;
      const hpRatio = brick.maxHp > 0 ? brick.hp / brick.maxHp : 1;
      const damageRatio = 1 - hpRatio;
      const impact = clamp((frame.brickImpactTimers.get(brick) ?? 0) / 0.16, 0, 1);
      material.emissiveIntensity = visual.emissiveIntensity * (0.42 + 0.58 * hpRatio) + impact * visual.impactGlow;
      material.metalness = visual.metalness;
      material.roughness = visual.roughness + damageRatio * 0.08;
      const centerX = brick.x + brick.width / 2;
      const centerY = brick.y + brick.height / 2;
      const z = 12 + visual.depthScale * 6 + hpRatio * visual.hpDepthBoost * 12;
      mesh.position.copy(toWorld(centerX, centerY, z));
      const punch = frame.settings.reducedMotion ? 0 : impact * 0.07;
      const wobble = frame.settings.reducedMotion ? 0 : Math.sin(now / 170 + centerX * 0.03) * visual.wobble;
      const zScale = visual.depthScale + hpRatio * visual.hpDepthBoost + punch;
      const widthScale = brick.width / BRICK_WIDTH;
      const heightScale = brick.height / BRICK_HEIGHT;
      mesh.scale.set((1 + punch) * widthScale, (1 + punch * 0.7) * heightScale, zScale);
      mesh.rotation.z = brick.kind === "bomb" && !frame.settings.reducedMotion ? Math.sin(now / 180) * 0.04 : wobble;

      rim.position.copy(mesh.position);
      rim.scale.copy(mesh.scale);
      rim.rotation.copy(mesh.rotation);
      rim.material.color.set(visual.rim);
      rim.material.opacity = clamp(visual.rimOpacity + impact * 0.22 + (brick.kind === "boss" ? 0.08 : 0), 0, 1);

      shadow.position.copy(toWorld(centerX + 5, centerY + 7, -5));
      shadow.scale.set(1 + damageRatio * 0.06 + impact * 0.04, 1.06 + visual.depthScale * 0.05, 1);
      shadow.rotation.z = mesh.rotation.z;
      shadow.material.color.set(visual.shadow);
      shadow.material.opacity = clamp(0.16 + visual.depthScale * 0.05 + impact * 0.06, 0, 0.4);
    }
  }

  removeBrickAccents(brick: Brick) {
    const rim = this.brickRims.get(brick);
    if (rim) {
      this.bricksGroup.remove(rim);
      rim.material.dispose();
      this.brickRims.delete(brick);
    }
    const shadow = this.brickShadows.get(brick);
    if (shadow) {
      this.bricksGroup.remove(shadow);
      shadow.material.dispose();
      this.brickShadows.delete(brick);
    }
  }

  private syncPaddle(frame: SceneFrame) {
    const flash = clamp(frame.paddleFlashTimer / 0.2, 0, 1);
    const now = performance.now();
    const width = frame.paddleWidth + flash * 24;
    const height = Math.max(11, 15 - flash * 3);
    const depth = frame.laserTimer > 0 ? 32 : 21 + flash * 16;
    const cosmetic = paddleCosmetic(frame.cosmetics.paddleSkin, frame.settings.highContrast);
    this.paddleMesh.scale.set(width, height, depth);
    this.paddleMesh.position.copy(toWorld(frame.paddleX, PADDLE_Y + 7 + flash * 0.8, 37));
    this.paddleMesh.material.color.set(cosmetic.color);
    this.paddleMesh.material.emissive.set(cosmetic.emissive);
    this.paddleMesh.material.emissiveIntensity = cosmetic.emissiveIntensity + flash * 1.05 + (frame.lifeFlashTimer > 0 ? 0.35 : 0);

    this.paddleGlowMaterial.color.set(cosmetic.glow);
    this.paddleSpecularMaterial.color.set(cosmetic.specular);
    this.paddleGlowMesh.position.copy(toWorld(frame.paddleX, PADDLE_Y + 9, 30));
    this.paddleGlowMesh.scale.set(width * 1.16, 27 + flash * 12, 1);
    this.paddleGlowMaterial.opacity = frame.settings.reducedMotion ? 0.22 + flash * 0.08 : 0.3 + flash * 0.18;

    const sweep = frame.settings.reducedMotion ? 0 : Math.sin(now / 520) * frame.paddleWidth * 0.34;
    this.paddleSpecularMesh.position.copy(toWorld(frame.paddleX + sweep, PADDLE_Y + 1, 56));
    this.paddleSpecularMesh.scale.set(Math.max(38, frame.paddleWidth * 0.24), 3 + flash * 2.4, 1);
    this.paddleSpecularMaterial.opacity = frame.settings.reducedMotion ? 0.16 + flash * 0.1 : 0.26 + flash * 0.24;
  }

  private syncBalls(frame: SceneFrame) {
    for (const [ball, mesh] of this.ballMeshes) {
      if (!frame.balls.includes(ball)) {
        this.ballsGroup.remove(mesh);
        mesh.material.dispose();
        this.ballMeshes.delete(ball);
        this.removeBallVisual(ball);
      }
    }
    for (const ball of frame.balls) {
      let mesh = this.ballMeshes.get(ball);
      if (!mesh) {
        const material = new THREE.MeshStandardMaterial({
          color: "#fff7cc",
          emissive: ball.fireTimer > 0 ? "#ff5c5c" : "#ffe066",
          emissiveIntensity: 0.55,
          metalness: 0.92,
          roughness: 0.12
        });
        mesh = new THREE.Mesh(this.ballGeometry, material);
        mesh.castShadow = true;
        mesh.renderOrder = 5;
        this.ballMeshes.set(ball, mesh);
        this.ballsGroup.add(mesh);
      }
      const visual = this.ballVisuals.get(ball) ?? this.createBallVisual(ball);
      const head = toWorld(ball.x, ball.y, 56);
      mesh.position.copy(head);
      mesh.scale.setScalar(ball.radius);
      if (!frame.settings.reducedMotion) {
        mesh.rotation.x += 0.08;
        mesh.rotation.y += 0.055;
      }
      const material = mesh.material;
      const ballColor = ball.fireTimer > 0 ? "#ff5c5c" : ball.thruTimer > 0 ? "#d6ff4d" : ballCosmeticColor(frame.cosmetics.ballTrail, frame.settings.highContrast);
      material.color.set(ballColor);
      material.emissive.set(ballColor);
      material.emissiveIntensity = ball.megaTimer > 0 ? 0.92 : 0.62;
      this.syncBallVisual(frame, ball, visual, ballColor, head);
    }
  }

  createBallVisual(ball: Ball): BallVisual {
    const glow = new THREE.Mesh(
      this.ballGlowGeometry,
      new THREE.MeshBasicMaterial({ color: "#ffe066", transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    glow.renderOrder = 4;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const trail = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: "#ffe066", transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    trail.renderOrder = 3;
    const visual = { glow, trail };
    this.ballVisuals.set(ball, visual);
    this.ballsGroup.add(trail, glow);
    return visual;
  }

  syncBallVisual(frame: SceneFrame, ball: Ball, visual: BallVisual, color: string, head: THREE.Vector3) {
    const speed = Math.hypot(ball.vx, ball.vy);
    const trailMaterial = visual.trail.material;
    const glowMaterial = visual.glow.material;
    visual.glow.position.copy(head);
    visual.glow.scale.setScalar(ball.radius * (frame.settings.reducedMotion ? 1.65 : 2.2));
    glowMaterial.color.set(color);
    glowMaterial.opacity = frame.settings.reducedMotion ? 0.18 : ball.megaTimer > 0 ? 0.36 : 0.28;

    const trailPositions = visual.trail.geometry.getAttribute("position");
    const hasTrail = speed > BALL_TRAIL_MIN_SPEED && !ball.stuck;
    const trailLength = hasTrail ? (frame.settings.reducedMotion ? 18 : clamp(speed * 0.08, 34, 86)) : 0;
    const normalizedX = speed > 0 ? ball.vx / speed : 0;
    const normalizedY = speed > 0 ? ball.vy / speed : 0;
    const tail = toWorld(ball.x - normalizedX * trailLength, ball.y - normalizedY * trailLength, 49);
    trailPositions.setXYZ(0, tail.x, tail.y, tail.z);
    trailPositions.setXYZ(1, head.x, head.y, head.z);
    trailPositions.needsUpdate = true;
    visual.trail.geometry.computeBoundingSphere();
    trailMaterial.color.set(color);
    trailMaterial.opacity = hasTrail ? (frame.settings.reducedMotion ? 0.18 : clamp(speed / MAX_BALL_SPEED, 0.28, 0.68)) : 0;
  }

  removeBallVisual(ball: Ball) {
    const visual = this.ballVisuals.get(ball);
    if (!visual) return;
    this.ballsGroup.remove(visual.trail, visual.glow);
    visual.trail.geometry.dispose();
    visual.trail.material.dispose();
    visual.glow.material.dispose();
    this.ballVisuals.delete(ball);
  }

  private syncPowerups(frame: SceneFrame) {
    for (const [powerup, object] of this.powerupObjects) {
      if (!frame.powerups.includes(powerup)) {
        this.powerupsGroup.remove(object);
        this.powerupObjects.delete(powerup);
      }
    }
    for (const powerup of frame.powerups) {
      let object = this.powerupObjects.get(powerup);
      if (!object) {
        const material = this.powerupMaterials.get(powerup.kind);
        object = material ? new THREE.Sprite(material) : new THREE.Mesh(this.fallbackPowerupGeometry, this.fallbackMaterialForPowerup(powerup.kind));
        object.userData.label = POWERUP_NAMES[powerup.kind];
        this.powerupObjects.set(powerup, object);
        this.powerupsGroup.add(object);
      }
      const tone = powerupToneFor(powerup.kind);
      const pulse = frame.settings.reducedMotion ? 0 : Math.sin(performance.now() / 150 + powerup.x) * 0.07;
      object.position.copy(toWorld(powerup.x, powerup.y, 62));
      const spriteWidth = tone === "volatile" ? 50 : 44;
      const spriteHeight = tone === "hazard" ? 36 : 30;
      object.scale.set(object instanceof THREE.Sprite ? spriteWidth * (1 + pulse) : 1, object instanceof THREE.Sprite ? spriteHeight * (1 + pulse) : 1, 1);
      object.rotation.z = frame.settings.reducedMotion
        ? 0
        : Math.sin(performance.now() / (tone === "hazard" ? 130 : 200) + powerup.x) * (tone === "hazard" ? 0.18 : 0.08);
    }
  }

  fallbackMaterialForPowerup(kind: PowerupKind): THREE.MeshStandardMaterial {
    const tone = powerupToneFor(kind);
    const existing = this.fallbackPowerupMaterials.get(tone);
    if (existing) return existing;
    const visual = POWERUP_VISUALS[tone];
    const material = new THREE.MeshStandardMaterial({
      color: visual.tint,
      emissive: visual.emissive,
      emissiveIntensity: tone === "hazard" ? 0.72 : 0.52,
      metalness: 0.5,
      roughness: 0.25
    });
    this.fallbackPowerupMaterials.set(tone, material);
    return material;
  }

  private syncLasers(frame: SceneFrame) {
    for (const [beam, line] of this.laserObjects) {
      if (!frame.laserBeams.includes(beam)) {
        line.geometry.dispose();
        this.lasersGroup.remove(line);
        this.laserObjects.delete(beam);
      }
    }
    for (const beam of frame.laserBeams) {
      let line = this.laserObjects.get(beam);
      if (!line) {
        const start = toWorld(beam.x, PADDLE_Y, 72);
        const end = toWorld(beam.x, WALL + 6, 72);
        const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#ff5c5c", transparent: true, opacity: 0.9 }));
        this.laserObjects.set(beam, line);
        this.lasersGroup.add(line);
      }
      line.material.opacity = clamp(beam.life * 10, 0, 1);
    }
  }

  private syncSparks(frame: SceneFrame) {
    if (frame.sparks.length === 0) {
      this.sparksPoints?.geometry.setDrawRange(0, 0);
      return;
    }
    const count = Math.min(frame.sparks.length, GameSceneView.MAX_SPARKS);
    if (!this.sparksPoints || !this.sparksPositionBuffer || !this.sparksColorBuffer) {
      this.sparksPositionBuffer = new Float32Array(GameSceneView.MAX_SPARKS * 3);
      this.sparksColorBuffer = new Float32Array(GameSceneView.MAX_SPARKS * 3);
      const geometry = new THREE.BufferGeometry();
      const positionAttr = new THREE.BufferAttribute(this.sparksPositionBuffer, 3);
      positionAttr.setUsage(THREE.DynamicDrawUsage);
      const colorAttr = new THREE.BufferAttribute(this.sparksColorBuffer, 3);
      colorAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("position", positionAttr);
      geometry.setAttribute("color", colorAttr);
      this.sparksPoints = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({ size: 4, vertexColors: true, transparent: true, opacity: 0.92 })
      );
      this.sparksGroup.add(this.sparksPoints);
    }
    const positions = this.sparksPositionBuffer;
    const colors = this.sparksColorBuffer;
    for (let index = 0; index < count; index += 1) {
      const spark = frame.sparks[index];
      const position = toWorld(spark.x, spark.y, 78);
      positions[index * 3] = position.x;
      positions[index * 3 + 1] = position.y;
      positions[index * 3 + 2] = position.z;
      const color = new THREE.Color(spark.color);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    const geometry = this.sparksPoints.geometry;
    geometry.setDrawRange(0, count);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    const size = frame.sparks.slice(0, count).reduce((largest, spark) => Math.max(largest, spark.size), 4);
    this.sparksPoints.material.size = size;
  }

  private syncFloatingTexts(frame: SceneFrame, effectsLayer: HTMLDivElement) {
    for (const [id, node] of this.floatingTextNodes) {
      if (!frame.floatingTexts.some((text) => text.id === id)) {
        node.remove();
        this.floatingTextNodes.delete(id);
      }
    }
    for (const text of frame.floatingTexts) {
      let node = this.floatingTextNodes.get(text.id);
      if (!node) {
        node = document.createElement("div");
        node.className = `floating-text is-${text.kind}`;
        node.textContent = text.text;
        this.floatingTextNodes.set(text.id, node);
        effectsLayer.append(node);
      }
      const progress = 1 - text.life / text.duration;
      const lift = frame.settings.reducedMotion ? 0 : progress * 34;
      node.style.left = `${(text.x / WIDTH) * 100}%`;
      node.style.top = `${((text.y - lift) / HEIGHT) * 100}%`;
      node.style.opacity = String(clamp(text.life / text.duration, 0, 1));
      const baseScale = text.kind === "combo" ? 1.16 : text.kind.startsWith("powerup") ? 1.08 : 1;
      node.style.transform = `translate(-50%, -50%) scale(${frame.settings.reducedMotion ? baseScale : baseScale + (1 - progress) * 0.12})`;
    }
  }

}
