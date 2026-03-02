/**
 * SpawnerSystem — hazard spawning with object pooling.
 *
 * Rules:
 * - Pool pre-allocated (HAZARD_POOL_SIZE) — no `new` in hot path
 * - Each hazard: 1–3 contiguous lanes blocked, always ≥1 safe lane
 * - Spawn timer driven by current phase speed (faster phase = less interval)
 * - Hazards scroll down at current speed, recycled to pool when off-screen
 */
import Phaser from 'phaser';
import { GameConfig, computeLanePositions } from '../config/GameConfig.ts';
import type { SeededRNG } from '../rng/SeededRNG.ts';

/** Hazard data attached to each pooled GameObject */
export interface HazardData {
  laneStart: number;
  laneCount: number;
  active: boolean;
}

export class SpawnerSystem {
  private scene: Phaser.Scene;
  private rng: SeededRNG;
  private pool!: Phaser.GameObjects.Group;
  private spawnTimerMs = 0;
  private lanePositions: number[];
  private laneWidth: number;

  constructor(scene: Phaser.Scene, rng: SeededRNG, canvasWidth: number) {
    this.scene = scene;
    this.rng   = rng;
    this.lanePositions = computeLanePositions(canvasWidth, GameConfig.LANE_COUNT);
    this.laneWidth = canvasWidth / GameConfig.LANE_COUNT;
    this.createPool();
  }

  private createPool() {
    // Pre-create HAZARD_POOL_SIZE rectangles — never new'd in hot path
    this.pool = this.scene.add.group({
      classType: Phaser.GameObjects.Rectangle,
      maxSize: GameConfig.HAZARD_POOL_SIZE,
      runChildUpdate: false,
    });

    for (let i = 0; i < GameConfig.HAZARD_POOL_SIZE; i++) {
      const rect = this.scene.add.rectangle(0, -200, 100, GameConfig.HAZARD_HEIGHT, 0xff2200);
      rect.setDepth(10);
      (rect as Phaser.GameObjects.Rectangle).setVisible(false);
      (rect as Phaser.GameObjects.Rectangle).setActive(false);
      (rect as Phaser.GameObjects.Rectangle & { hazardData?: HazardData }).hazardData = {
        laneStart: 0,
        laneCount: 1,
        active: false,
      };
      this.pool.add(rect, true);
    }
  }

  reset() {
    this.spawnTimerMs = 0;
    this.pool.getChildren().forEach(go => {
      const r = go as Phaser.GameObjects.Rectangle;
      r.setActive(false).setVisible(false);
      r.y = -200;
    });
  }

  /** Call each frame. delta in seconds. speed in px/s. canvasHeight for culling. */
  update(delta: number, speed: number, canvasHeight: number) {
    const deltaMs = delta * 1000;

    // Reduce spawn interval at higher speed (capped minimum)
    const interval = Math.max(700, GameConfig.HAZARD_SPAWN_INTERVAL_MS / (speed / GameConfig.BASE_SCROLL_SPEED));
    this.spawnTimerMs += deltaMs;

    if (this.spawnTimerMs >= interval) {
      this.spawnTimerMs -= interval;
      this.trySpawn();
    }

    // Scroll active hazards; recycle off-screen
    this.pool.getChildren().forEach(go => {
      if (!go.active) return;
      const rect = go as Phaser.GameObjects.Rectangle & { hazardData?: HazardData };
      rect.y += speed * delta;
      if (rect.y > canvasHeight + GameConfig.HAZARD_HEIGHT) {
        rect.setActive(false).setVisible(false);
        if (rect.hazardData) rect.hazardData.active = false;
      }
    });
  }

  private trySpawn() {
    // Find an available pool slot — no new allocation
    const rect = this.pool.getFirstDead(false) as (Phaser.GameObjects.Rectangle & { hazardData?: HazardData }) | null;
    if (!rect) return; // pool exhausted — skip spawn this cycle (telemetry would flag this)

    // Choose 1–3 contiguous lanes (always leave ≥1 safe lane)
    const maxBlock = Math.min(GameConfig.LANE_COUNT - 1, 3);
    const count    = this.rng.nextInt(1, maxBlock);
    const maxStart = GameConfig.LANE_COUNT - count;
    const start    = this.rng.nextInt(0, maxStart);

    const x = this.lanePositions[start] - this.laneWidth / 2;
    const w = count * this.laneWidth;

    rect.setPosition(x + w / 2, -GameConfig.HAZARD_HEIGHT);
    rect.setSize(w - 4, GameConfig.HAZARD_HEIGHT);
    rect.setFillStyle(0xff2200);
    rect.setActive(true).setVisible(true);
    rect.hazardData = { laneStart: start, laneCount: count, active: true };
  }

  /** AABB check: does point (px, py) with half-extents (pw/2, ph/2) overlap any hazard? */
  checkCollision(px: number, py: number, pw: number, ph: number): boolean {
    const children = this.pool.getChildren();
    for (let i = 0; i < children.length; i++) {
      const go = children[i];
      if (!go.active) continue;
      const rect = go as Phaser.GameObjects.Rectangle;
      const hw = rect.width / 2;
      const hh = rect.height / 2;
      if (
        px - pw / 2 < rect.x + hw &&
        px + pw / 2 > rect.x - hw &&
        py - ph / 2 < rect.y + hh &&
        py + ph / 2 > rect.y - hh
      ) return true;
    }
    return false;
  }

  getActiveCount(): number {
    return this.pool.countActive(true);
  }

  destroy() {
    this.pool.destroy(true);
  }
}
