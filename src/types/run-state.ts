/**
 * Swipe Salvage — Run State Types
 * The complete in-memory snapshot of an active run.
 */

import type { ResourceWallet } from './resources';
import type { LoadoutModule } from './modules';
import type { ActiveTrait } from './traits';
import type { EncounterRecord } from './encounters';

// ---------------------------------------------------------------------------
// Run Phases
// ---------------------------------------------------------------------------

/**
 * Run lifecycle phases.
 *
 *  LOADING ──► WARMUP ──► MID ──► CLIMAX
 *                │          │        │
 *                └──────────┴────────┴──► ENCOUNTER (returns to prior phase)
 *                                         │
 *                     DEAD ◄──────────────┤
 *                     COMPLETE ◄──────────┘
 */
export const RUN_PHASES = [
  'loading',      // assets loading, RNG seeding
  'warmup',       // 0–30s: base hazards, first loot decisions
  'mid',          // 30–90s: combo hazards + 1–2 encounters
  'climax',       // 90–150s: elite sequence + boss gate
  'encounter',    // paused for encounter modal
  'dead',         // terminal: player died
  'complete',     // terminal: run finished successfully
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

export const TERMINAL_PHASES: ReadonlySet<RunPhase> = new Set(['dead', 'complete']);

// Valid phase transitions
export const PHASE_TRANSITIONS: Readonly<Record<RunPhase, ReadonlyArray<RunPhase>>> = {
  loading:   ['warmup'],
  warmup:    ['mid', 'encounter', 'dead'],
  mid:       ['climax', 'encounter', 'dead'],
  climax:    ['encounter', 'dead', 'complete'],
  encounter: ['warmup', 'mid', 'climax'],  // returns to whichever was active
  dead:      [],
  complete:  [],
};

// ---------------------------------------------------------------------------
// Player vitals
// ---------------------------------------------------------------------------

export interface PlayerVitals {
  readonly hp: number;
  readonly maxHp: number;
  readonly shields: number;
  readonly maxShields: number;
  /** Normalized 0–1. At 1.0, overheat triggers. */
  readonly heat: number;
  /** Remaining invulnerability frames in seconds */
  readonly invulnRemaining: number;
}

// ---------------------------------------------------------------------------
// Score state
// ---------------------------------------------------------------------------

export interface ScoreState {
  readonly baseScore: number;
  readonly multiplier: number;
  readonly perfectDodges: number;
  readonly riskGatesTaken: number;
  /** Best combo (consecutive pickups without taking damage) */
  readonly bestCombo: number;
  readonly currentCombo: number;
}

// ---------------------------------------------------------------------------
// Run metadata / seed info
// ---------------------------------------------------------------------------

export type RunSeedKind = 'standard' | 'daily' | 'weekly_mutation' | 'event';

export interface RunSeedInfo {
  readonly kind: RunSeedKind;
  readonly seed: number;
  readonly mutationId?: string;    // weekly mutation identifier
  readonly eventId?: string;
}

// ---------------------------------------------------------------------------
// Run State — the full snapshot
// ---------------------------------------------------------------------------

export interface RunState {
  /** Unique run identifier (UUID, generated at run start) */
  readonly runId: string;
  readonly seedInfo: RunSeedInfo;
  readonly biomeId: string;

  /** Current phase */
  readonly phase: RunPhase;
  /**
   * Phase before entering 'encounter'. Used to return to correct phase.
   * Null when not in encounter.
   */
  readonly priorPhase: RunPhase | null;

  /** Elapsed seconds since run start (does not tick during encounters) */
  readonly elapsedSeconds: number;
  /** Distance traveled in abstract units */
  readonly distance: number;

  // ------ Vitals
  readonly vitals: PlayerVitals;

  // ------ Build
  /** Active modules with runtime state (cooldowns) */
  readonly activeModules: ReadonlyArray<LoadoutModule | null>;
  /** Passive core slots */
  readonly passiveCores: ReadonlyArray<LoadoutModule | null>;
  /** Traits acquired during this run */
  readonly traits: ReadonlyArray<ActiveTrait>;

  // ------ Economy
  /** In-run resource wallet */
  readonly wallet: ResourceWallet;

  // ------ Score
  readonly score: ScoreState;

  // ------ Current lane
  /** 0-indexed. Range: [0, LANE_COUNT - 1] */
  readonly currentLane: number;
  /** Target lane the player is snapping toward (may differ during tween) */
  readonly targetLane: number;

  // ------ Encounter tracking
  readonly encounterHistory: ReadonlyArray<EncounterRecord>;
  /** Index of the next encounter in the sequence (deterministic from seed) */
  readonly nextEncounterIndex: number;
  /** Seconds until the next encounter triggers */
  readonly nextEncounterInSeconds: number;

  // ------ Input log (for replay/anti-cheat)
  readonly inputLog: ReadonlyArray<InputEvent>;
}

// ---------------------------------------------------------------------------
// Input event (for deterministic replay)
// ---------------------------------------------------------------------------

export const INPUT_EVENT_KINDS = [
  'lane_change',
  'module_activate',
  'precision_hold_start',
  'precision_hold_end',
] as const;
export type InputEventKind = (typeof INPUT_EVENT_KINDS)[number];

export interface InputEvent {
  readonly kind: InputEventKind;
  readonly timestampMs: number;  // ms since run start (wall clock)
  readonly payload?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Initial run state factory
// ---------------------------------------------------------------------------

export function createInitialRunState(
  runId: string,
  seedInfo: RunSeedInfo,
  biomeId: string,
  activeModules: ReadonlyArray<LoadoutModule | null>,
  passiveCores: ReadonlyArray<LoadoutModule | null>,
  laneCount: number,
  startingLane: number,
): RunState {
  return {
    runId,
    seedInfo,
    biomeId,
    phase: 'loading',
    priorPhase: null,
    elapsedSeconds: 0,
    distance: 0,
    vitals: {
      hp: 3,
      maxHp: 3,
      shields: 0,
      maxShields: 0,
      heat: 0,
      invulnRemaining: 0,
    },
    activeModules,
    passiveCores,
    traits: [],
    wallet: { scrap: 0, energy: 0, cores: 0, keys: 0 },
    score: {
      baseScore: 0,
      multiplier: 1.0,
      perfectDodges: 0,
      riskGatesTaken: 0,
      bestCombo: 0,
      currentCombo: 0,
    },
    currentLane: startingLane,
    targetLane: startingLane,
    encounterHistory: [],
    nextEncounterIndex: 0,
    nextEncounterInSeconds: 30,
    inputLog: [],
  };
}
