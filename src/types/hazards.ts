/**
 * Swipe Salvage — Hazard Types
 * Data-driven hazard definitions. Adding a new hazard = data entry only.
 *
 * GDD ref: §4.3, §13.1
 */

import type { RunPhase } from './run-state';

// ---------------------------------------------------------------------------
// Hazard kinds (prototype catalog)
// ---------------------------------------------------------------------------

export const HAZARD_KINDS = [
  'barrier',        // static lane-blocker
  'crusher',        // timed vertical drop
  'laser_sweep',    // horizontal sweep, timed
  'mine_strip',     // multi-lane mines
  'falling_debris', // multi-position falling objects
] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

// ---------------------------------------------------------------------------
// Lane targeting
// ---------------------------------------------------------------------------

/**
 * Which lanes a hazard occupies.
 * 'single' = one lane, 'multi' = several lanes, 'all' = all lanes.
 */
export type LanePattern =
  | { type: 'single' }
  | { type: 'multi'; count: number }
  | { type: 'all' }
  | { type: 'gap'; safeCount: number }; // all lanes EXCEPT safeCount safe lanes

// ---------------------------------------------------------------------------
// Telegraph specification
// ---------------------------------------------------------------------------

export interface TelegraphSpec {
  /** Total telegraph window in seconds before the hazard becomes lethal */
  readonly durationSeconds: number;
  /** Visual cue asset key (sprite/animation to show during telegraph phase) */
  readonly visualKey: string;
  /** Audio cue key to play at telegraph start */
  readonly audioKey: string;
  /**
   * Normalized time [0,1] at which the hazard visually "snaps" to active state.
   * E.g. 0.7 means the glow transitions at 70% through the telegraph window.
   */
  readonly snapAt: number;
  /** Whether to show a countdown timer on the hazard sprite */
  readonly showCountdown: boolean;
}

// ---------------------------------------------------------------------------
// Hitbox — axis-aligned bounding box, relative to hazard anchor
// ---------------------------------------------------------------------------

export interface HazardHitbox {
  /**
   * Width as fraction of a lane width (e.g. 0.8 = 80% of lane width).
   * Slightly forgiving per GDD §12.2 fairness requirement.
   */
  readonly widthFraction: number;
  /**
   * Height in world units (pixels at base resolution).
   */
  readonly heightPx: number;
  /** X offset from anchor center (0 = centered) */
  readonly offsetX: number;
  /** Y offset from anchor center (0 = centered) */
  readonly offsetY: number;
}

// ---------------------------------------------------------------------------
// Intensity level — same hazard, different difficulty tier
// ---------------------------------------------------------------------------

export interface IntensityLevel {
  readonly level: 1 | 2 | 3;
  /** Override telegraph duration (shorter = harder) */
  readonly telegraphOverride?: number;
  /** Additional lanes blocked at this intensity */
  readonly extraLanes?: number;
  /** Speed multiplier for moving hazards */
  readonly speedMultiplier: number;
  /** Score reward for surviving this hazard */
  readonly scoreReward: number;
  /** Damage dealt on collision */
  readonly damage: number;
}

// ---------------------------------------------------------------------------
// HazardDef — static registry entry
// ---------------------------------------------------------------------------

export interface HazardDef {
  readonly id: string;
  readonly kind: HazardKind;
  readonly name: string;
  readonly lanePattern: LanePattern;
  readonly telegraph: TelegraphSpec;
  readonly hitbox: HazardHitbox;
  readonly intensityLevels: ReadonlyArray<IntensityLevel>;
  /**
   * World scroll speed relative to base (1.0 = moves at same speed as world).
   * Values > 1 = hazard moves faster than world (more dangerous).
   */
  readonly scrollSpeedMultiplier: number;
  /**
   * For timed hazards: how long the lethal window stays active (seconds).
   * 0 = instant (trigger-once).
   */
  readonly activeDurationSeconds: number;
  /**
   * Minimum gap in seconds before this hazard can appear again in the same lane.
   */
  readonly cooldownSeconds: number;
  /** Visual asset key for the main hazard sprite */
  readonly spriteKey: string;
  /** Whether this hazard can coexist with other hazards in adjacent lanes */
  readonly allowAdjacentSpawn: boolean;
}

// ---------------------------------------------------------------------------
// Runtime hazard instance
// ---------------------------------------------------------------------------

export type HazardState = 'telegraphing' | 'active' | 'expired';

export interface HazardInstance {
  readonly id: string;          // unique per-run instance id
  readonly defId: string;
  readonly kind: HazardKind;
  state: HazardState;
  /** Which lanes (0-indexed) this instance occupies */
  readonly occupiedLanes: ReadonlyArray<number>;
  /** World Y position (top of hazard) */
  worldY: number;
  /** Remaining telegraph time in seconds */
  telegraphRemaining: number;
  /** Remaining active time in seconds (for timed hazards) */
  activeRemaining: number;
  readonly intensity: IntensityLevel;
  /** Whether the player has already collided with this instance (prevent multi-hit) */
  hitRegistered: boolean;
}

// ---------------------------------------------------------------------------
// Spawn event (output of spawner, consumed by scene)
// ---------------------------------------------------------------------------

export interface HazardSpawnEvent {
  readonly defId: string;
  readonly intensityLevel: 1 | 2 | 3;
  readonly lanes: ReadonlyArray<number>;
  readonly worldY: number;
}
