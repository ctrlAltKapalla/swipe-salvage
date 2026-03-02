/**
 * GameConfig — single source of truth for all tunable parameters.
 * Remote-config-ready: these values can be overridden by ConfigStore at runtime.
 * No hardcoded magic numbers anywhere else in the codebase.
 */
export const GameConfig = {
  // ── Canvas ────────────────────────────────────────────────────────────────
  WIDTH: 390,        // logical width (scales to viewport)
  HEIGHT: 844,       // logical height (scales to viewport)
  TARGET_FPS: 60,

  // ── Lanes ────────────────────────────────────────────────────────────────
  LANE_COUNT: 5,
  LANE_SNAP_DURATION_MS: 120,
  LANE_SNAP_EASE: 'Quad.easeOut' as const,

  // ── Input ─────────────────────────────────────────────────────────────────
  SWIPE_THRESHOLD_PX: 30,
  SWIPE_MAX_DURATION_MS: 250,
  TAP_MAX_MOVE_PX: 10,
  INPUT_BUFFER_DEPTH: 2,

  // ── Run structure ─────────────────────────────────────────────────────────
  RUN_DURATION_S: 120,
  PHASE_TIMINGS_S: [0, 30, 90, 120] as const,
  PHASE_SPEED_MULT: [1.0, 1.4, 2.0] as const,
  PHASE_NAMES: ['WARM-UP', 'MID', 'CLIMAX'] as const,
  SPEED_RAMP_DURATION_S: 3,

  // ── Player ────────────────────────────────────────────────────────────────
  PLAYER_HP: 3,
  INVULN_DURATION_MS: 800,
  HIT_FLASH_DURATION_MS: 300,
  PLAYER_Y_FACTOR: 0.75,    // fraction of canvas height
  PLAYER_WIDTH: 38,
  PLAYER_HEIGHT: 52,

  // ── Scrolling / speed ─────────────────────────────────────────────────────
  BASE_SCROLL_SPEED: 280 as number,   // px/s at phase 0
  SCROLL_VARIANCE: 0,       // future: per-biome variance

  // ── Hazards ───────────────────────────────────────────────────────────────
  HAZARD_HEIGHT: 32,
  HAZARD_SPAWN_INTERVAL_MS: 1600,
  HAZARD_POOL_SIZE: 20,

  // ── Pickups ───────────────────────────────────────────────────────────────
  PICKUP_POOL_SIZE: 30,

  // ── VFX / particles ───────────────────────────────────────────────────────
  PARTICLE_CAP: 300,

  // ── Modules ───────────────────────────────────────────────────────────────
  MODULE_COOLDOWNS_MS: [12000, 18000, 25000] as const,

  // ── Score ─────────────────────────────────────────────────────────────────
  SCORE_PER_SECOND_BASE: 10,

  // ── Debug ─────────────────────────────────────────────────────────────────
  DEBUG_HITBOXES: false,
} as const;

/** Compute lane center X positions from canvas width */
export function computeLanePositions(canvasWidth: number, count: number): number[] {
  const laneWidth = canvasWidth / count;
  return Array.from({ length: count }, (_, i) => i * laneWidth + laneWidth / 2);
}

export type PhaseIndex = 0 | 1 | 2;
