/**
 * Swipe Salvage — Hazard Data (Prototype Catalog)
 * 5 hazards: Barrier, Crusher, Laser Sweep, Mine Strip, Falling Debris.
 * Adding a new hazard = data entry only. No code changes required.
 *
 * GDD ref: §4.3, §13.1
 * AAA rules:
 *  - Audio + visual telegraph for every hazard
 *  - Clear hitbox (slightly forgiving per §12.2)
 *  - Always at least one safe lane
 *  - Variable intensity levels (1–3)
 */

import type { HazardDef } from '../types/hazards';

export const HAZARD_DEFS: ReadonlyArray<HazardDef> = [
  // =========================================================================
  // BARRIER — static single-lane blocker
  // =========================================================================
  {
    id: 'haz_barrier',
    kind: 'barrier',
    name: 'Barrier',
    lanePattern: { type: 'single' },
    telegraph: {
      durationSeconds: 1.2,
      visualKey: 'telegraph_barrier_glow',
      audioKey: 'sfx_telegraph_barrier',
      snapAt: 0.75,
      showCountdown: false,
    },
    hitbox: {
      widthFraction: 0.75,  // forgiving: only 75% of lane width
      heightPx: 80,
      offsetX: 0,
      offsetY: 0,
    },
    intensityLevels: [
      { level: 1, speedMultiplier: 1.0, scoreReward: 30,  damage: 1 },
      { level: 2, speedMultiplier: 1.0, scoreReward: 50,  damage: 1, extraLanes: 1 },
      { level: 3, speedMultiplier: 1.0, scoreReward: 80,  damage: 1, extraLanes: 2, telegraphOverride: 0.9 },
    ],
    scrollSpeedMultiplier: 1.0,
    activeDurationSeconds: 0,   // instant: lethal while in lane
    cooldownSeconds: 2.5,
    spriteKey: 'spr_barrier',
    allowAdjacentSpawn: true,
  },

  // =========================================================================
  // CRUSHER — timed vertical drop
  // =========================================================================
  {
    id: 'haz_crusher',
    kind: 'crusher',
    name: 'Crusher',
    lanePattern: { type: 'single' },
    telegraph: {
      durationSeconds: 1.6,
      visualKey: 'telegraph_crusher_shadow',
      audioKey: 'sfx_telegraph_crusher',
      snapAt: 0.85,           // shadow sharpens just before impact
      showCountdown: true,
    },
    hitbox: {
      widthFraction: 0.80,
      heightPx: 40,           // only the crush zone at bottom of travel
      offsetX: 0,
      offsetY: 30,            // offset toward bottom of sprite
    },
    intensityLevels: [
      { level: 1, speedMultiplier: 1.0, scoreReward: 40,  damage: 1 },
      { level: 2, speedMultiplier: 1.4, scoreReward: 65,  damage: 1, telegraphOverride: 1.2 },
      { level: 3, speedMultiplier: 2.0, scoreReward: 100, damage: 2, telegraphOverride: 0.9 },
    ],
    scrollSpeedMultiplier: 0,   // stationary in world space (falls in place)
    activeDurationSeconds: 0.3, // brief lethal window during impact frame
    cooldownSeconds: 3.5,
    spriteKey: 'spr_crusher',
    allowAdjacentSpawn: false,  // adjacent crushers are too dense
  },

  // =========================================================================
  // LASER SWEEP — horizontal sweep across lanes, timed
  // =========================================================================
  {
    id: 'haz_laser_sweep',
    kind: 'laser_sweep',
    name: 'Laser Sweep',
    lanePattern: { type: 'gap', safeCount: 1 }, // sweeps all but 1 safe lane
    telegraph: {
      durationSeconds: 1.8,
      visualKey: 'telegraph_laser_charge',
      audioKey: 'sfx_telegraph_laser',
      snapAt: 0.9,
      showCountdown: true,
    },
    hitbox: {
      widthFraction: 1.0,       // full lane width (laser is precise)
      heightPx: 20,             // thin beam
      offsetX: 0,
      offsetY: 0,
    },
    intensityLevels: [
      { level: 1, speedMultiplier: 1.0, scoreReward: 60,  damage: 1 },
      { level: 2, speedMultiplier: 1.5, scoreReward: 90,  damage: 1, telegraphOverride: 1.4 },
      { level: 3, speedMultiplier: 2.5, scoreReward: 140, damage: 2, telegraphOverride: 1.0 },
    ],
    scrollSpeedMultiplier: 0,   // sweeps horizontally, does not scroll with world
    activeDurationSeconds: 1.2, // beam stays active while sweeping
    cooldownSeconds: 4.0,
    spriteKey: 'spr_laser_sweep',
    allowAdjacentSpawn: false,
  },

  // =========================================================================
  // MINE STRIP — multi-lane mines, player must find gap
  // =========================================================================
  {
    id: 'haz_mine_strip',
    kind: 'mine_strip',
    name: 'Mine Strip',
    lanePattern: { type: 'gap', safeCount: 2 }, // always 2 safe lanes
    telegraph: {
      durationSeconds: 1.4,
      visualKey: 'telegraph_mine_blink',
      audioKey: 'sfx_telegraph_mine',
      snapAt: 0.6,
      showCountdown: false,
    },
    hitbox: {
      widthFraction: 0.65,    // mines are forgiving — rounded edges
      heightPx: 60,
      offsetX: 0,
      offsetY: 0,
    },
    intensityLevels: [
      { level: 1, speedMultiplier: 1.0, scoreReward: 50,  damage: 1 },
      { level: 2, speedMultiplier: 1.0, scoreReward: 80,  damage: 1, extraLanes: 1 },  // 3 safe→2 safe
      { level: 3, speedMultiplier: 1.2, scoreReward: 120, damage: 1, extraLanes: 2, telegraphOverride: 1.0 }, // 1 safe
    ],
    scrollSpeedMultiplier: 1.0,
    activeDurationSeconds: 0,
    cooldownSeconds: 3.0,
    spriteKey: 'spr_mine',
    allowAdjacentSpawn: false,
  },

  // =========================================================================
  // FALLING DEBRIS — multi-position, falling from above
  // =========================================================================
  {
    id: 'haz_falling_debris',
    kind: 'falling_debris',
    name: 'Falling Debris',
    lanePattern: { type: 'multi', count: 2 }, // 2 lanes blocked, 3 safe
    telegraph: {
      durationSeconds: 1.0,
      visualKey: 'telegraph_debris_shadow',
      audioKey: 'sfx_telegraph_debris',
      snapAt: 0.8,
      showCountdown: false,
    },
    hitbox: {
      widthFraction: 0.70,
      heightPx: 70,
      offsetX: 0,
      offsetY: 10,
    },
    intensityLevels: [
      { level: 1, speedMultiplier: 1.0, scoreReward: 35,  damage: 1 },
      { level: 2, speedMultiplier: 1.3, scoreReward: 55,  damage: 1, extraLanes: 1 },
      { level: 3, speedMultiplier: 1.8, scoreReward: 85,  damage: 1, extraLanes: 2, telegraphOverride: 0.8 },
    ],
    scrollSpeedMultiplier: 1.2,   // falls faster than world scroll
    activeDurationSeconds: 0,
    cooldownSeconds: 2.0,
    spriteKey: 'spr_debris',
    allowAdjacentSpawn: true,
  },
] as const;

export function buildHazardRegistry(defs: ReadonlyArray<HazardDef>): ReadonlyMap<string, HazardDef> {
  return new Map(defs.map((d) => [d.id, d]));
}

export const HAZARD_REGISTRY: ReadonlyMap<string, HazardDef> = buildHazardRegistry(HAZARD_DEFS);
