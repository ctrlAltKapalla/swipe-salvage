/**
 * Swipe Salvage — Run State Actions
 * All state mutations go through typed actions dispatched to RunStateManager.
 * State is always immutable — actions return new RunState snapshots.
 */

import type { ResourceDelta } from '../types/resources';
import type { RunPhase, InputEvent } from '../types/run-state';
import type { EncounterRecord, ShopItem } from '../types/encounters';

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

interface TickAction {
  readonly type: 'TICK';
  /** Delta time in seconds since last tick */
  readonly dt: number;
  /** Distance traveled this tick */
  readonly distanceDelta: number;
}

interface PhaseTransitionAction {
  readonly type: 'PHASE_TRANSITION';
  readonly to: RunPhase;
}

interface TakeDamageAction {
  readonly type: 'TAKE_DAMAGE';
  readonly damage: number;
  /** Whether the damage source is a projectile (vs collision) */
  readonly isProjectile: boolean;
}

interface HealAction {
  readonly type: 'HEAL';
  readonly amount: number;
}

interface AddShieldAction {
  readonly type: 'ADD_SHIELD';
  readonly amount: number;
}

interface ApplyHeatAction {
  readonly type: 'APPLY_HEAT';
  /** Normalized delta. Positive = heat up, negative = cool down */
  readonly delta: number;
}

interface LaneChangeAction {
  readonly type: 'LANE_CHANGE';
  readonly targetLane: number;
}

interface LaneSyncAction {
  readonly type: 'LANE_SYNC';
  /** Called when the tween completes and currentLane catches up to targetLane */
  readonly lane: number;
}

interface ModuleActivateAction {
  readonly type: 'MODULE_ACTIVATE';
  /** Index in activeModules array */
  readonly slotIndex: number;
}

interface ModuleCooldownTickAction {
  readonly type: 'MODULE_COOLDOWN_TICK';
  readonly dt: number;
}

interface AddResourceAction {
  readonly type: 'ADD_RESOURCE';
  readonly delta: ResourceDelta;
}

interface SpendResourceAction {
  readonly type: 'SPEND_RESOURCE';
  readonly delta: ResourceDelta;
}

interface AddTraitAction {
  readonly type: 'ADD_TRAIT';
  readonly defId: string;
}

interface AddScoreAction {
  readonly type: 'ADD_SCORE';
  readonly points: number;
}

interface SetMultiplierAction {
  readonly type: 'SET_MULTIPLIER';
  readonly multiplier: number;
}

interface RecordPerfectDodgeAction {
  readonly type: 'RECORD_PERFECT_DODGE';
}

interface RecordEncounterAction {
  readonly type: 'RECORD_ENCOUNTER';
  readonly record: EncounterRecord;
  readonly nextEncounterInSeconds: number;
}

interface RecordInputAction {
  readonly type: 'RECORD_INPUT';
  readonly event: InputEvent;
}

interface InvulnTickAction {
  readonly type: 'INVULN_TICK';
  readonly dt: number;
}

/**
 * Player selects a Risk Gate option.
 * Caller (EncounterBridge) resolves the full option data from the active encounter
 * and passes it here — manager stays pure (no encounter registry lookup).
 */
interface ChooseRiskGateAction {
  readonly type: 'CHOOSE_RISK_GATE';
  readonly encounterId: string;
  readonly choiceId: string;
  readonly triggeredAtSeconds: number;
  /** Positive effects from this option */
  readonly reward: {
    readonly delta?: ResourceDelta;
    readonly traitId?: string;
    readonly scoreMultiplierBonus?: number;
  };
  /** Trade-off: applied immediately on choice */
  readonly hazard: {
    readonly hpDamage?: number;
    readonly hazardRateMultiplier?: number;
    readonly shieldLoss?: number;
  };
}

/**
 * Player purchases an item from a Shop Drone.
 * Full ShopItem data carried in action — no registry needed in manager.
 * Manager validates affordability before applying.
 */
interface ShopPurchaseAction {
  readonly type: 'SHOP_PURCHASE';
  readonly encounterId: string;
  readonly item: ShopItem;
  readonly triggeredAtSeconds: number;
}

/**
 * Explicit game-over trigger (e.g. run timer expired, story event).
 * HP=0 via TAKE_DAMAGE auto-transitions to 'dead'; this handles other terminal cases.
 */
interface TriggerGameOverAction {
  readonly type: 'TRIGGER_GAME_OVER';
  readonly reason: 'hp_zero' | 'time_expired' | 'story';
}

/**
 * Mark run as successfully completed.
 */
interface TriggerRunCompleteAction {
  readonly type: 'TRIGGER_RUN_COMPLETE';
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type RunAction =
  | TickAction
  | PhaseTransitionAction
  | TakeDamageAction
  | HealAction
  | AddShieldAction
  | ApplyHeatAction
  | LaneChangeAction
  | LaneSyncAction
  | ModuleActivateAction
  | ModuleCooldownTickAction
  | AddResourceAction
  | SpendResourceAction
  | AddTraitAction
  | AddScoreAction
  | SetMultiplierAction
  | RecordPerfectDodgeAction
  | RecordEncounterAction
  | RecordInputAction
  | InvulnTickAction
  | ChooseRiskGateAction
  | ShopPurchaseAction
  | TriggerGameOverAction
  | TriggerRunCompleteAction;

export type RunActionType = RunAction['type'];
