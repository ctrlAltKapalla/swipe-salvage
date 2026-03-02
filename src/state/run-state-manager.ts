/**
 * Swipe Salvage — RunStateManager
 * The single source of truth for all in-run state mutations.
 *
 * Principles:
 * - Pure reducer: dispatch(action) → new RunState (no side effects here)
 * - No external dependencies: game systems read state and dispatch actions
 * - Fully deterministic: given the same seed + action sequence = identical state
 * - Listeners notified after each dispatch (for Phaser scene reactivity)
 */

import {
  RunState,
  RunPhase,
  TERMINAL_PHASES,
  PHASE_TRANSITIONS,
  PlayerVitals,
} from '../types/run-state';
import { applyDelta, canAfford } from '../types/resources';
import { RunAction } from './actions';
import { ACTIVE_SLOT_COUNT } from '../types/modules';
import type { TraitDef } from '../types/traits';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANE_COUNT = 5;
const INVULN_AFTER_HIT_SECONDS = 0.8;
const HEAT_OVERHEAT_THRESHOLD = 1.0;
const DEFAULT_MAX_TRAIT_STACKS = 3; // fallback if TraitDef not in registry

// ---------------------------------------------------------------------------
// Listener type
// ---------------------------------------------------------------------------

export type StateListener = (state: RunState, action: RunAction) => void;

// ---------------------------------------------------------------------------
// RunStateManager
// ---------------------------------------------------------------------------

export class RunStateManager {
  private _state: RunState;
  private readonly _listeners: Set<StateListener> = new Set();
  private readonly _traitRegistry: ReadonlyMap<string, TraitDef>;

  constructor(initialState: RunState, traitRegistry: ReadonlyMap<string, TraitDef> = new Map()) {
    this._state = initialState;
    this._traitRegistry = traitRegistry;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  get state(): RunState {
    return this._state;
  }

  dispatch(action: RunAction): RunState {
    if (TERMINAL_PHASES.has(this._state.phase) && action.type !== 'RECORD_INPUT') {
      // No mutations after terminal phase
      return this._state;
    }

    const next = this._reduce(this._state, action);
    this._state = next;
    for (const listener of this._listeners) {
      listener(next, action);
    }
    return next;
  }

  subscribe(listener: StateListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Returns a deterministic checksum of the current state for anti-cheat validation.
   * Uses a simple djb2-like hash over JSON serialization.
   */
  stateChecksum(): number {
    const s = JSON.stringify(this._state);
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  // ------------------------------------------------------------------
  // Reducer
  // ------------------------------------------------------------------

  private _reduce(state: RunState, action: RunAction): RunState {
    switch (action.type) {
      case 'TICK':
        return this._handleTick(state, action.dt, action.distanceDelta);

      case 'PHASE_TRANSITION':
        return this._handlePhaseTransition(state, action.to);

      case 'TAKE_DAMAGE':
        return this._handleTakeDamage(state, action.damage);

      case 'HEAL':
        return this._handleHeal(state, action.amount);

      case 'ADD_SHIELD':
        return {
          ...state,
          vitals: {
            ...state.vitals,
            shields: Math.min(state.vitals.shields + action.amount, state.vitals.maxShields || action.amount),
            maxShields: Math.max(state.vitals.maxShields, action.amount),
          },
        };

      case 'APPLY_HEAT':
        return this._handleHeat(state, action.delta);

      case 'LANE_CHANGE':
        return this._handleLaneChange(state, action.targetLane);

      case 'LANE_SYNC':
        return { ...state, currentLane: action.lane };

      case 'MODULE_ACTIVATE':
        return this._handleModuleActivate(state, action.slotIndex);

      case 'MODULE_COOLDOWN_TICK':
        return this._handleCooldownTick(state, action.dt);

      case 'ADD_RESOURCE':
        return { ...state, wallet: applyDelta(state.wallet, action.delta) };

      case 'SPEND_RESOURCE': {
        if (!canAfford(state.wallet, action.delta)) return state; // silent no-op; caller should pre-check
        const neg: typeof action.delta = {};
        for (const [k, v] of Object.entries(action.delta)) {
          neg[k as keyof typeof neg] = -(v ?? 0);
        }
        return { ...state, wallet: applyDelta(state.wallet, neg) };
      }

      case 'ADD_TRAIT':
        return this._handleAddTrait(state, action.defId);

      case 'ADD_SCORE':
        return this._handleAddScore(state, action.points);

      case 'SET_MULTIPLIER':
        return {
          ...state,
          score: { ...state.score, multiplier: Math.max(0, action.multiplier) },
        };

      case 'RECORD_PERFECT_DODGE':
        return {
          ...state,
          score: {
            ...state.score,
            perfectDodges: state.score.perfectDodges + 1,
            currentCombo: state.score.currentCombo + 1,
            bestCombo: Math.max(state.score.bestCombo, state.score.currentCombo + 1),
          },
        };

      case 'RECORD_ENCOUNTER':
        return {
          ...state,
          encounterHistory: [...state.encounterHistory, action.record],
          nextEncounterIndex: state.nextEncounterIndex + 1,
          nextEncounterInSeconds: action.nextEncounterInSeconds,
        };

      case 'RECORD_INPUT':
        return { ...state, inputLog: [...state.inputLog, action.event] };

      case 'INVULN_TICK': {
        const remaining = Math.max(0, state.vitals.invulnRemaining - action.dt);
        return { ...state, vitals: { ...state.vitals, invulnRemaining: remaining } };
      }

      case 'CHOOSE_RISK_GATE':
        return this._handleChooseRiskGate(state, action);

      case 'SHOP_PURCHASE':
        return this._handleShopPurchase(state, action);

      case 'TRIGGER_GAME_OVER':
        return { ...state, phase: 'dead' };

      case 'TRIGGER_RUN_COMPLETE':
        return { ...state, phase: 'complete' };

      default: {
        const _exhaustive: never = action; throw new Error(`Unhandled action: ${JSON.stringify(_exhaustive)}`);
        return state;
      }
    }
  }

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  private _handleTick(state: RunState, dt: number, distanceDelta: number): RunState {
    // Auto-advance phase based on elapsed time
    const nextElapsed = state.elapsedSeconds + dt;
    let nextPhase = state.phase;

    // Allow multiple phase advances in a single large tick (e.g. test fast-forwards)
    if (nextElapsed >= 90 && ['warmup', 'mid'].includes(nextPhase)) nextPhase = 'climax';
    else if (nextElapsed >= 30 && nextPhase === 'warmup') nextPhase = 'mid';

    const nextEncounterInSeconds = Math.max(0, state.nextEncounterInSeconds - dt);

    return {
      ...state,
      elapsedSeconds: nextElapsed,
      distance: state.distance + distanceDelta,
      phase: nextPhase,
      priorPhase: nextPhase !== state.phase ? state.phase : state.priorPhase,
      nextEncounterInSeconds,
    };
  }

  private _handlePhaseTransition(state: RunState, to: RunPhase): RunState {
    const valid = PHASE_TRANSITIONS[state.phase];
    if (!valid.includes(to)) {
      // Invalid transition — log but don't crash
      console.warn(`[RunStateManager] Invalid phase transition: ${state.phase} → ${to}`);
      return state;
    }
    return {
      ...state,
      phase: to,
      priorPhase: to === 'encounter' ? state.phase : state.priorPhase,
    };
  }

  private _handleTakeDamage(state: RunState, damage: number): RunState {
    // Ignore damage during invuln window
    if (state.vitals.invulnRemaining > 0) return state;

    let { hp, shields, maxHp, maxShields, heat, invulnRemaining } = state.vitals;
    let remaining = damage;

    // Shields absorb first
    const shieldAbsorb = Math.min(shields, remaining);
    shields -= shieldAbsorb;
    remaining -= shieldAbsorb;

    if (remaining > 0) {
      hp = Math.max(0, hp - remaining);
      invulnRemaining = INVULN_AFTER_HIT_SECONDS;
    }

    const nextVitals: PlayerVitals = {
      hp,
      maxHp,
      shields,
      maxShields,
      heat,
      invulnRemaining,
    };

    const isDead = hp <= 0;
    return {
      ...state,
      vitals: nextVitals,
      phase: isDead ? 'dead' : state.phase,
      // Break combo on damage
      score: {
        ...state.score,
        currentCombo: 0,
      },
    };
  }

  private _handleHeal(state: RunState, amount: number): RunState {
    const hp = Math.min(state.vitals.hp + amount, state.vitals.maxHp);
    return { ...state, vitals: { ...state.vitals, hp } };
  }

  private _handleHeat(state: RunState, delta: number): RunState {
    const newHeat = Math.max(0, Math.min(1, state.vitals.heat + delta));
    const isOverheat = newHeat >= HEAT_OVERHEAT_THRESHOLD && state.vitals.heat < HEAT_OVERHEAT_THRESHOLD;

    // Overheat: damage player, reset heat
    if (isOverheat) {
      const afterDamage = this._handleTakeDamage(state, 1);
      return {
        ...afterDamage,
        vitals: { ...afterDamage.vitals, heat: 0 },
      };
    }

    return { ...state, vitals: { ...state.vitals, heat: newHeat } };
  }

  private _handleLaneChange(state: RunState, targetLane: number): RunState {
    const clamped = Math.max(0, Math.min(LANE_COUNT - 1, targetLane));
    if (clamped === state.targetLane) return state;
    return { ...state, targetLane: clamped };
  }

  private _handleModuleActivate(state: RunState, slotIndex: number): RunState {
    if (slotIndex < 0 || slotIndex >= ACTIVE_SLOT_COUNT) return state;
    const module = state.activeModules[slotIndex];
    if (!module || module.cooldownRemaining > 0) return state;

    const updated = state.activeModules.map((m, i) => {
      if (i !== slotIndex || !m) return m;
      // Cooldown is set by the effect system after this; we just mark as activated
      // The actual cooldown value comes from ModuleDef + upgrade overrides
      // Here we set a sentinel (effect system overrides it)
      return { ...m, cooldownRemaining: -1 }; // -1 = "just activated this frame"
    });

    return { ...state, activeModules: updated };
  }

  private _handleCooldownTick(state: RunState, dt: number): RunState {
    const updated = state.activeModules.map((m) => {
      if (!m || m.cooldownRemaining <= 0) return m;
      return { ...m, cooldownRemaining: Math.max(0, m.cooldownRemaining - dt) };
    });
    return { ...state, activeModules: updated };
  }

  private _handleAddTrait(state: RunState, defId: string): RunState {
    const traitDef = this._traitRegistry.get(defId);
    const maxStacks = traitDef?.maxStacks ?? DEFAULT_MAX_TRAIT_STACKS;
    const existing = state.traits.find((t) => t.defId === defId);
    if (existing) {
      if (existing.stacks >= maxStacks) return state; // at cap
      return {
        ...state,
        traits: state.traits.map((t) =>
          t.defId === defId ? { ...t, stacks: t.stacks + 1 } : t
        ),
      };
    }
    return {
      ...state,
      traits: [...state.traits, { defId, stacks: 1 }],
    };
  }

  private _handleAddScore(state: RunState, points: number): RunState {
    const earned = Math.round(points * state.score.multiplier);
    return {
      ...state,
      score: {
        ...state.score,
        baseScore: state.score.baseScore + earned,
      },
    };
  }

  private _handleChooseRiskGate(
    state: RunState,
    action: Extract<Parameters<RunStateManager['dispatch']>[0], { type: 'CHOOSE_RISK_GATE' }>
  ): RunState {
    let next = state;

    // Apply reward
    if (action.reward.delta) {
      next = { ...next, wallet: applyDelta(next.wallet, action.reward.delta) };
    }
    if (action.reward.traitId) {
      next = this._handleAddTrait(next, action.reward.traitId);
    }
    if (action.reward.scoreMultiplierBonus) {
      next = {
        ...next,
        score: {
          ...next.score,
          multiplier: next.score.multiplier + action.reward.scoreMultiplierBonus / 100,
        },
      };
    }

    // Apply hazard trade-off
    if (action.hazard.hpDamage) {
      // Bypass invuln for risk gate self-chosen damage
      next = {
        ...next,
        vitals: {
          ...next.vitals,
          hp: Math.max(0, next.vitals.hp - action.hazard.hpDamage),
        },
      };
      if (next.vitals.hp <= 0) next = { ...next, phase: 'dead' };
    }
    if (action.hazard.shieldLoss) {
      next = {
        ...next,
        vitals: {
          ...next.vitals,
          shields: Math.max(0, next.vitals.shields - action.hazard.shieldLoss),
        },
      };
    }
    // hazardRateMultiplier is stored in encounter record for spawner to read
    // (spawner reads encounter history to adjust rate — no direct state field needed)

    // Record encounter
    const record = {
      kind: 'risk_gate' as const,
      encounterId: action.encounterId,
      triggeredAtSeconds: action.triggeredAtSeconds,
      choiceId: action.choiceId,
    };
    // Only restore prior phase if not already in a terminal state
    const returnPhase = TERMINAL_PHASES.has(next.phase)
      ? next.phase
      : (next.priorPhase ?? 'warmup');
    next = {
      ...next,
      encounterHistory: [...next.encounterHistory, record],
      nextEncounterIndex: next.nextEncounterIndex + 1,
      nextEncounterInSeconds: 30,
      phase: returnPhase,
      priorPhase: null,
    };

    return next;
  }

  private _handleShopPurchase(
    state: RunState,
    action: Extract<Parameters<RunStateManager['dispatch']>[0], { type: 'SHOP_PURCHASE' }>
  ): RunState {
    const { item, encounterId, triggeredAtSeconds } = action;

    // Validate affordability
    if (!canAfford(state.wallet, item.cost)) {
      console.warn(`[RunStateManager] Cannot afford shop item: ${item.id}`);
      return state;
    }

    // Deduct cost
    const costNeg: typeof item.cost = {};
    for (const [k, v] of Object.entries(item.cost)) {
      (costNeg as Record<string, number>)[k] = -(v ?? 0);
    }
    let next: RunState = { ...state, wallet: applyDelta(state.wallet, costNeg) };

    // Apply effect by kind
    switch (item.kind) {
      case 'heal':
        next = this._handleHeal(next, item.value ?? 1);
        break;
      case 'trait':
        if (item.refId) next = this._handleAddTrait(next, item.refId);
        break;
      case 'upgrade':
        // Module upgrade is a meta-state operation; in-run effect is stat buff via trait
        // Stub: apply a small score bonus as placeholder until meta-state integration
        next = this._handleAddScore(next, item.value ?? 0);
        break;
      case 'module_reroll':
        // Reroll signal — EncounterScene handles UI; state just records the purchase
        break;
    }

    // Record encounter
    const record = {
      kind: 'shop_drone' as const,
      encounterId,
      triggeredAtSeconds,
      choiceId: item.id,
    };
    next = {
      ...next,
      encounterHistory: [...next.encounterHistory, record],
      nextEncounterIndex: next.nextEncounterIndex + 1,
      nextEncounterInSeconds: 30,
      phase: next.priorPhase ?? 'warmup',
      priorPhase: null,
    };

    return next;
  }
}
