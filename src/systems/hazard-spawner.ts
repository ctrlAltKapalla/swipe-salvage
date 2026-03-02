/**
 * Swipe Salvage — HazardSpawner
 *
 * Responsibilities:
 * - Phase-aware spawn table selection
 * - Deterministic spawn scheduling (uses RNG stream 'hazard')
 * - Safe-lane guarantee: always at least one escape lane per spawn
 * - Encounter injection stubs (shop drone / risk gate / elite triggers)
 * - No Phaser dependency — pure logic, testable in Node
 */

import type { HazardDef, HazardSpawnEvent, IntensityLevel } from '../types/hazards';
import type { RunPhase } from '../types/run-state';
import type { SeededRNG } from '../rng/seeded-rng';

// ---------------------------------------------------------------------------
// Spawn table entry
// ---------------------------------------------------------------------------

export interface SpawnTableEntry {
  readonly defId: string;
  /** Relative weight for this hazard in this phase */
  readonly weight: number;
  /** Intensity distribution: [level1Weight, level2Weight, level3Weight] */
  readonly intensityWeights: [number, number, number];
}

// ---------------------------------------------------------------------------
// Phase spawn tables — configurable, no code changes needed for tuning
// ---------------------------------------------------------------------------

export interface PhaseSpawnConfig {
  readonly phase: RunPhase;
  /** Min seconds between spawns in this phase */
  readonly minSpawnIntervalSeconds: number;
  /** Max seconds between spawns */
  readonly maxSpawnIntervalSeconds: number;
  /** Max hazards simultaneously on screen */
  readonly maxConcurrentHazards: number;
  /** Entries must sum to ≥ 1 weight total */
  readonly table: ReadonlyArray<SpawnTableEntry>;
}

export interface SpawnerConfig {
  readonly laneCount: number;
  readonly worldHeight: number;       // spawn Y position (off-screen top)
  readonly phaseConfigs: ReadonlyArray<PhaseSpawnConfig>;
  /** Multiplier applied to all spawn intervals (global difficulty knob) */
  readonly difficultyMultiplier: number;
}

export const DEFAULT_SPAWNER_CONFIG: SpawnerConfig = {
  laneCount: 5,
  worldHeight: -200,   // spawn above visible area
  difficultyMultiplier: 1.0,
  phaseConfigs: [
    {
      phase: 'warmup',
      minSpawnIntervalSeconds: 3.0,
      maxSpawnIntervalSeconds: 5.0,
      maxConcurrentHazards: 2,
      table: [
        { defId: 'haz_barrier',       weight: 50, intensityWeights: [100, 0,  0 ] },
        { defId: 'haz_falling_debris', weight: 30, intensityWeights: [100, 0,  0 ] },
        { defId: 'haz_mine_strip',    weight: 20, intensityWeights: [100, 0,  0 ] },
      ],
    },
    {
      phase: 'mid',
      minSpawnIntervalSeconds: 2.0,
      maxSpawnIntervalSeconds: 3.5,
      maxConcurrentHazards: 3,
      table: [
        { defId: 'haz_barrier',       weight: 25, intensityWeights: [60,  40, 0 ] },
        { defId: 'haz_crusher',       weight: 25, intensityWeights: [70,  30, 0 ] },
        { defId: 'haz_laser_sweep',   weight: 20, intensityWeights: [80,  20, 0 ] },
        { defId: 'haz_mine_strip',    weight: 20, intensityWeights: [60,  40, 0 ] },
        { defId: 'haz_falling_debris', weight: 10, intensityWeights: [50,  50, 0 ] },
      ],
    },
    {
      phase: 'climax',
      minSpawnIntervalSeconds: 1.2,
      maxSpawnIntervalSeconds: 2.2,
      maxConcurrentHazards: 4,
      table: [
        { defId: 'haz_barrier',       weight: 15, intensityWeights: [20,  60, 20] },
        { defId: 'haz_crusher',       weight: 20, intensityWeights: [20,  50, 30] },
        { defId: 'haz_laser_sweep',   weight: 25, intensityWeights: [10,  50, 40] },
        { defId: 'haz_mine_strip',    weight: 20, intensityWeights: [10,  40, 50] },
        { defId: 'haz_falling_debris', weight: 20, intensityWeights: [10,  40, 50] },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Encounter injection — stubs for shop drone / risk gate / elite
// ---------------------------------------------------------------------------

export type EncounterKind = 'shop_drone' | 'risk_gate' | 'elite';

export interface EncounterInjectionPoint {
  readonly kind: EncounterKind;
  readonly triggerAtSeconds: number;
}

// ---------------------------------------------------------------------------
// Spawn decision output
// ---------------------------------------------------------------------------

export interface SpawnDecision {
  readonly events: ReadonlyArray<HazardSpawnEvent>;
  /** Seconds until the next spawn attempt */
  readonly nextSpawnInSeconds: number;
}

// ---------------------------------------------------------------------------
// HazardSpawner
// ---------------------------------------------------------------------------

export class HazardSpawner {
  private readonly _config: SpawnerConfig;
  private readonly _registry: ReadonlyMap<string, HazardDef>;
  private readonly _rng: SeededRNG;

  /** Per-lane cooldown tracking (seconds remaining before this lane can spawn again) */
  private readonly _laneCooldowns: number[];

  /** Per-hazard-kind cooldown tracking */
  private readonly _hazardCooldowns: Map<string, number> = new Map();

  constructor(
    config: SpawnerConfig,
    registry: ReadonlyMap<string, HazardDef>,
    rng: SeededRNG,
  ) {
    this._config = config;
    this._registry = registry;
    this._rng = rng;
    this._laneCooldowns = Array(config.laneCount).fill(0);
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Called every frame. Decrements cooldowns.
   */
  tick(dt: number): void {
    for (let i = 0; i < this._laneCooldowns.length; i++) {
      this._laneCooldowns[i] = Math.max(0, this._laneCooldowns[i] - dt);
    }
    for (const [key, val] of this._hazardCooldowns) {
      const next = val - dt;
      if (next <= 0) this._hazardCooldowns.delete(key);
      else this._hazardCooldowns.set(key, next);
    }
  }

  /**
   * Decide what to spawn next for the given phase and active hazard count.
   * Returns null if spawn is suppressed (too many concurrent, cooldowns, encounter active).
   */
  decide(
    phase: RunPhase,
    activeHazardCount: number,
    encounterActive: boolean,
  ): SpawnDecision {
    const phaseConfig = this._getPhaseConfig(phase);

    // Next interval regardless of whether we spawn
    const interval = this._rng.nextFloat(
      phaseConfig.minSpawnIntervalSeconds * this._config.difficultyMultiplier,
      phaseConfig.maxSpawnIntervalSeconds * this._config.difficultyMultiplier,
    );

    // Suppress spawning during encounters or at max concurrency
    if (encounterActive || activeHazardCount >= phaseConfig.maxConcurrentHazards) {
      return { events: [], nextSpawnInSeconds: interval };
    }

    // Pick a hazard from the weighted table
    const entry = this._pickFromTable(phaseConfig.table);
    if (!entry) return { events: [], nextSpawnInSeconds: interval };

    const def = this._registry.get(entry.defId);
    if (!def) return { events: [], nextSpawnInSeconds: interval };

    // Check hazard-level cooldown
    if ((this._hazardCooldowns.get(def.id) ?? 0) > 0) {
      return { events: [], nextSpawnInSeconds: Math.min(interval, 0.5) };
    }

    // Pick intensity
    const intensityLevel = this._pickIntensity(entry.intensityWeights);
    const intensity = def.intensityLevels.find((l) => l.level === intensityLevel);
    if (!intensity) return { events: [], nextSpawnInSeconds: interval };

    // Determine lanes
    const lanes = this._assignLanes(def, intensity, phase);
    if (lanes === null) return { events: [], nextSpawnInSeconds: 0.5 }; // retry soon

    // Apply cooldowns
    this._hazardCooldowns.set(def.id, def.cooldownSeconds);
    for (const lane of lanes) {
      this._laneCooldowns[lane] = def.cooldownSeconds;
    }

    return {
      events: [{
        defId: def.id,
        intensityLevel,
        lanes,
        worldY: this._config.worldHeight,
      }],
      nextSpawnInSeconds: interval,
    };
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private _getPhaseConfig(phase: RunPhase): PhaseSpawnConfig {
    return (
      this._config.phaseConfigs.find((c) => c.phase === phase) ??
      this._config.phaseConfigs[0]
    );
  }

  private _pickFromTable(
    table: ReadonlyArray<SpawnTableEntry>,
  ): SpawnTableEntry | null {
    if (table.length === 0) return null;
    const total = table.reduce((s, e) => s + e.weight, 0);
    let roll = this._rng.next() * total;
    for (const entry of table) {
      roll -= entry.weight;
      if (roll <= 0) return entry;
    }
    return table[table.length - 1];
  }

  private _pickIntensity(weights: [number, number, number]): 1 | 2 | 3 {
    const total = weights[0] + weights[1] + weights[2];
    let roll = this._rng.next() * total;
    if ((roll -= weights[0]) <= 0) return 1;
    if ((roll -= weights[1]) <= 0) return 2;
    return 3;
  }

  /**
   * Assign specific lane indices to a hazard.
   * Guarantees at least one safe lane.
   * Returns null if no valid placement exists (retry later).
   */
  private _assignLanes(
    def: HazardDef,
    intensity: IntensityLevel,
    _phase: RunPhase,
  ): ReadonlyArray<number> | null {
    const laneCount = this._config.laneCount;
    const pattern = def.lanePattern;

    switch (pattern.type) {
      case 'single': {
        const blockedCount = 1 + (intensity.extraLanes ?? 0);
        return this._placeLanesWithGap(blockedCount, laneCount, def);
      }

      case 'multi': {
        const blockedCount = pattern.count + (intensity.extraLanes ?? 0);
        return this._placeLanesWithGap(blockedCount, laneCount, def);
      }

      case 'gap': {
        // safeCount safe lanes minus intensity reduction
        const safeCount = Math.max(1, pattern.safeCount - (intensity.extraLanes ?? 0));
        const blocked = laneCount - safeCount;
        // Pick the safe lanes, everything else is blocked
        const safeLanes = this._pickSafeLanes(safeCount, laneCount);
        const blockedLanes = Array.from({ length: laneCount }, (_, i) => i)
          .filter((l) => !safeLanes.includes(l));
        return blockedLanes;
      }

      case 'all': {
        // All lanes blocked — only valid if intensity.extraLanes leaves at least 1 safe
        // For now, treat as gap with 1 safe lane
        const safeLanes = this._pickSafeLanes(1, laneCount);
        return Array.from({ length: laneCount }, (_, i) => i)
          .filter((l) => !safeLanes.includes(l));
      }
    }
  }

  /**
   * Place `count` contiguous blocked lanes while ensuring at least 1 lane is safe.
   * Returns null if it cannot find a valid placement.
   */
  private _placeLanesWithGap(
    count: number,
    laneCount: number,
    def: HazardDef,
  ): ReadonlyArray<number> | null {
    if (count >= laneCount) return null; // would block all lanes — refuse

    // Build candidate start positions (contiguous block)
    const candidates: number[] = [];
    for (let start = 0; start <= laneCount - count; start++) {
      // Check lane cooldowns
      const lanes = Array.from({ length: count }, (_, i) => start + i);
      const anyCooling = lanes.some((l) => this._laneCooldowns[l] > 0);
      const noAdjacentConflict =
        def.allowAdjacentSpawn || !lanes.some((l) => this._laneCooldowns[l] > 0);
      if (!anyCooling) candidates.push(start);
    }

    if (candidates.length === 0) return null;

    const start = candidates[this._rng.nextInt(0, candidates.length - 1)];
    return Array.from({ length: count }, (_, i) => start + i);
  }

  /**
   * Pick `count` random safe lanes from [0, laneCount).
   */
  private _pickSafeLanes(count: number, laneCount: number): number[] {
    const allLanes = Array.from({ length: laneCount }, (_, i) => i);
    // Shuffle and take first `count`
    for (let i = allLanes.length - 1; i > 0; i--) {
      const j = this._rng.nextInt(0, i);
      [allLanes[i], allLanes[j]] = [allLanes[j], allLanes[i]];
    }
    return allLanes.slice(0, count);
  }
}
