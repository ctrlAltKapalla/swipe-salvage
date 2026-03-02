/**
 * Swipe Salvage — CollisionSystem
 *
 * AABB-based collision detection between player and active hazards.
 * No Phaser physics engine — pure arithmetic, testable in Node.
 *
 * Design:
 * - Player occupies a lane (discrete position) with a fixed hitbox
 * - Hazards occupy one or more lanes with configurable hitbox fractions
 * - Collision = player lane is in hazard's lane set + Y ranges overlap
 * - Invuln window prevents rapid re-hit (0.8s default)
 * - Hit events dispatched as callbacks (consumed by RunStateManager.dispatch)
 *
 * Fairness (GDD §12.2):
 * - Hitbox widthFraction < 1.0 on all hazards
 * - Lane-snap grace period: if player is mid-tween, use TARGET lane for safety check
 */

import type { HazardInstance } from '../types/hazards';
import type { HazardDef } from '../types/hazards';

// ---------------------------------------------------------------------------
// Player rectangle (world space)
// ---------------------------------------------------------------------------

export interface PlayerRect {
  /** Current lane (0-indexed) — used for lane overlap check */
  readonly lane: number;
  /** Target lane (used for tween grace: treated as safe if also safe) */
  readonly targetLane: number;
  /** Player world Y center */
  readonly worldY: number;
  /** Player hitbox half-height */
  readonly halfHeight: number;
  /** Whether player is currently invulnerable */
  readonly invulnRemaining: number;
}

// ---------------------------------------------------------------------------
// Hazard rectangle (world space)
// ---------------------------------------------------------------------------

export interface HazardRect {
  readonly instanceId: string;
  readonly defId: string;
  readonly occupiedLanes: ReadonlyArray<number>;
  /** Hazard world Y center */
  readonly worldY: number;
  /** Hazard hitbox half-height (derived from def.hitbox.heightPx / 2) */
  readonly halfHeight: number;
  /** Damage this hit deals */
  readonly damage: number;
}

// ---------------------------------------------------------------------------
// Collision result
// ---------------------------------------------------------------------------

export interface CollisionHit {
  readonly instanceId: string;
  readonly defId: string;
  readonly damage: number;
}

// ---------------------------------------------------------------------------
// Lane geometry helper
// ---------------------------------------------------------------------------

export interface LaneGeometry {
  readonly laneCount: number;
  readonly canvasWidth: number;
  readonly laneWidth: number;
  readonly laneCenter: (lane: number) => number;
}

export function buildLaneGeometry(laneCount: number, canvasWidth: number): LaneGeometry {
  const laneWidth = canvasWidth / laneCount;
  return {
    laneCount,
    canvasWidth,
    laneWidth,
    laneCenter: (lane: number) => laneWidth * lane + laneWidth / 2,
  };
}

// ---------------------------------------------------------------------------
// AABB overlap helpers
// ---------------------------------------------------------------------------

/**
 * Check if two Y ranges overlap.
 * @param y1 center of first object
 * @param h1 half-height of first
 * @param y2 center of second
 * @param h2 half-height of second
 */
export function yOverlap(y1: number, h1: number, y2: number, h2: number): boolean {
  return Math.abs(y1 - y2) < h1 + h2;
}

/**
 * Check lane overlap between player and hazard, with forgiveness factor.
 * @param playerLane current player lane
 * @param hazardLanes lanes the hazard occupies
 * @param hazardWidthFraction hitbox width as fraction of lane width (e.g. 0.75)
 * @param playerXNorm normalized X position within lane [0, 1] (0.5 = center)
 */
export function laneOverlap(
  playerLane: number,
  hazardLanes: ReadonlyArray<number>,
  hazardWidthFraction: number,
  playerXNorm: number = 0.5,
): boolean {
  if (!hazardLanes.includes(playerLane)) return false;

  // Additional sub-lane check: if hazard hitbox fraction < 1.0,
  // player can be in the "edge" of a lane and dodge safely.
  // playerXNorm: 0 = left edge of lane, 1 = right edge.
  const halfHazard = hazardWidthFraction / 2;
  const playerEdgeLeft = playerXNorm - 0.1;   // player half-width ≈ 10% of lane
  const playerEdgeRight = playerXNorm + 0.1;
  const hazardLeft = 0.5 - halfHazard;
  const hazardRight = 0.5 + halfHazard;

  return playerEdgeRight > hazardLeft && playerEdgeLeft < hazardRight;
}

// ---------------------------------------------------------------------------
// CollisionSystem
// ---------------------------------------------------------------------------

export class CollisionSystem {
  private readonly _registry: ReadonlyMap<string, HazardDef>;

  constructor(registry: ReadonlyMap<string, HazardDef>) {
    this._registry = registry;
  }

  /**
   * Check player against all active hazard instances.
   * Returns all collisions this frame (normally 0 or 1).
   *
   * @param player Current player state
   * @param hazards All active (non-expired, non-telegraphing) hazard instances
   * @param hazardRects Map from instanceId to world rect
   */
  checkCollisions(
    player: PlayerRect,
    hazards: ReadonlyArray<HazardInstance>,
    hazardRects: ReadonlyMap<string, HazardRect>,
  ): ReadonlyArray<CollisionHit> {
    // Invuln window — no hits registered
    if (player.invulnRemaining > 0) return [];

    const hits: CollisionHit[] = [];

    for (const inst of hazards) {
      // Only check active hazards
      if (inst.state !== 'active') continue;
      // Already hit this instance
      if (inst.hitRegistered) continue;

      const def = this._registry.get(inst.defId);
      if (!def) continue;

      const rect = hazardRects.get(inst.id);
      if (!rect) continue;

      // Y overlap check
      if (!yOverlap(player.worldY, player.halfHeight, rect.worldY, rect.halfHeight)) {
        continue;
      }

      // Lane overlap with forgiveness
      // Grace: if player's TARGET lane is safe, treat as near-miss (fairness)
      const currentInHazard = laneOverlap(player.lane, inst.occupiedLanes, def.hitbox.widthFraction);
      const targetInHazard = laneOverlap(player.targetLane, inst.occupiedLanes, def.hitbox.widthFraction);

      // If player has already snapped to a safe lane (target is safe), skip
      if (!currentInHazard || (!currentInHazard && !targetInHazard)) continue;

      // Grace: if target lane is safe and player is mid-tween, forgive the hit
      if (currentInHazard && !targetInHazard) continue;

      hits.push({
        instanceId: inst.id,
        defId: inst.defId,
        damage: rect.damage,
      });

      // Mark to prevent multi-hit from same instance
      inst.hitRegistered = true;
    }

    return hits;
  }

  /**
   * Validate fairness: all hazards must have at least one safe lane.
   * Call this in tests and at spawn time.
   */
  validateFairness(
    inst: HazardInstance,
    laneCount: number,
  ): { fair: boolean; safeCount: number } {
    const allLanes = Array.from({ length: laneCount }, (_, i) => i);
    const safeLanes = allLanes.filter((l) => !inst.occupiedLanes.includes(l));
    return { fair: safeLanes.length >= 1, safeCount: safeLanes.length };
  }
}
