/**
 * Swipe Salvage — EncounterBridge
 *
 * Framework-agnostic event adapter. Translates `encounter:result` events
 * (emitted by EncounterScene via game.events) into typed RunStateManager dispatches.
 *
 * Design:
 * - Accepts a generic EventEmitter interface — works with Phaser.Events.EventEmitter
 *   or any Node-compatible EventEmitter in tests.
 * - Holds a reference to the active encounter so it can resolve full option data
 *   before dispatching (manager stays pure — no registry lookups inside reducer).
 * - Emits `encounter:closed` after each result dispatch.
 * - Emits `game:over` when RunState transitions to 'dead'.
 * - Emits `run:complete` when RunState transitions to 'complete'.
 *
 * Phaser wiring (in RunScene.create()):
 * ```typescript
 * const bridge = new EncounterBridge(this.runStateManager, this.game.events);
 * bridge.mount();
 * // On scene shutdown:
 * bridge.unmount();
 * ```
 */

import type { RunStateManager } from './run-state-manager';
import type { Encounter, RiskGateOption, ShopItem } from '../types/encounters';
import type { RunState } from '../types/run-state';

// ---------------------------------------------------------------------------
// Minimal EventEmitter interface (compatible with Phaser.Events.EventEmitter)
// ---------------------------------------------------------------------------

export interface IEventEmitter {
  on(event: string, fn: (...args: unknown[]) => void): this;
  off(event: string, fn: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): boolean | this;
}

// ---------------------------------------------------------------------------
// Encounter result payloads (from EncounterScene)
// ---------------------------------------------------------------------------

export interface RiskGateResultPayload {
  readonly type: 'risk_gate';
  readonly encounterId: string;
  readonly choice: RiskGateOption;
}

export interface ShopResultPayload {
  readonly type: 'shop';
  readonly encounterId: string;
  readonly choice: { readonly itemId: string };
}

export type EncounterResultPayload = RiskGateResultPayload | ShopResultPayload;

// ---------------------------------------------------------------------------
// HUD state event payload
// ---------------------------------------------------------------------------

export interface RunStatePayload {
  readonly state: RunState;
  readonly phase: RunState['phase'];
  readonly hp: number;
  readonly maxHp: number;
  readonly shields: number;
  readonly score: number;
  readonly multiplier: number;
  readonly wallet: RunState['wallet'];
  readonly heat: number;
}

function toHUDPayload(state: RunState): RunStatePayload {
  return {
    state,
    phase: state.phase,
    hp: state.vitals.hp,
    maxHp: state.vitals.maxHp,
    shields: state.vitals.shields,
    score: state.score.baseScore,
    multiplier: state.score.multiplier,
    wallet: state.wallet,
    heat: state.vitals.heat,
  };
}

// ---------------------------------------------------------------------------
// Active encounter context (set when EncounterScene opens)
// ---------------------------------------------------------------------------

export interface ActiveEncounterContext {
  readonly encounter: Encounter;
  /** Items available in shop drone (keyed by itemId) */
  readonly shopItems?: ReadonlyMap<string, ShopItem>;
}

// ---------------------------------------------------------------------------
// EncounterBridge
// ---------------------------------------------------------------------------

export class EncounterBridge {
  private readonly _manager: RunStateManager;
  private readonly _emitter: IEventEmitter;
  private _activeEncounter: ActiveEncounterContext | null = null;
  private _mounted = false;

  // Bound handlers stored for off() cleanup
  private readonly _onEncounterOpen: (...args: unknown[]) => void;
  private readonly _onEncounterResult: (...args: unknown[]) => void;

  constructor(manager: RunStateManager, emitter: IEventEmitter) {
    this._manager = manager;
    this._emitter = emitter;

    this._onEncounterOpen = (...args: unknown[]) => {
      const ctx = args[0] as ActiveEncounterContext;
      this._activeEncounter = ctx;
    };

    this._onEncounterResult = (...args: unknown[]) => {
      const payload = args[0] as EncounterResultPayload;
      this._handleEncounterResult(payload);
    };
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  mount(): void {
    if (this._mounted) return;
    this._emitter.on('encounter:open', this._onEncounterOpen);
    this._emitter.on('encounter:result', this._onEncounterResult);
    this._mounted = true;
  }

  unmount(): void {
    this._emitter.off('encounter:open', this._onEncounterOpen);
    this._emitter.off('encounter:result', this._onEncounterResult);
    this._mounted = false;
    this._activeEncounter = null;
  }

  get isMounted(): boolean {
    return this._mounted;
  }

  // ------------------------------------------------------------------
  // Set active encounter (called by RunScene when encounter triggers)
  // ------------------------------------------------------------------

  setActiveEncounter(ctx: ActiveEncounterContext): void {
    this._activeEncounter = ctx;
  }

  // ------------------------------------------------------------------
  // Dispatch helpers (also callable directly for testing)
  // ------------------------------------------------------------------

  dispatchRiskGateChoice(
    encounterId: string,
    choice: RiskGateOption,
    triggeredAtSeconds: number,
  ): void {
    this._manager.dispatch({
      type: 'CHOOSE_RISK_GATE',
      encounterId,
      choiceId: choice.id,
      triggeredAtSeconds,
      reward: choice.reward,
      hazard: choice.hazard,
    });

    const nextState = this._manager.state;
    this._broadcastState(nextState);
    this._emitter.emit('encounter:closed');
    this._checkTerminal(nextState);
    this._activeEncounter = null;
  }

  dispatchShopPurchase(
    encounterId: string,
    item: ShopItem,
    triggeredAtSeconds: number,
  ): void {
    this._manager.dispatch({
      type: 'SHOP_PURCHASE',
      encounterId,
      item,
      triggeredAtSeconds,
    });

    const nextState = this._manager.state;
    this._broadcastState(nextState);
    // Don't close encounter on purchase — player may buy more items
    this._checkTerminal(nextState);
  }

  dispatchShopClose(encounterId: string, triggeredAtSeconds: number): void {
    // If no purchase was made, still record and close
    const state = this._manager.state;
    if (!state.encounterHistory.find((r) => r.encounterId === encounterId)) {
      this._manager.dispatch({
        type: 'RECORD_ENCOUNTER',
        record: {
          kind: 'shop_drone',
          encounterId,
          triggeredAtSeconds,
          choiceId: 'closed_no_purchase',
        },
        nextEncounterInSeconds: 30,
      });
    }
    this._emitter.emit('encounter:closed');
    this._activeEncounter = null;
  }

  // ------------------------------------------------------------------
  // HUD broadcast — call once per frame from RunScene.update()
  // ------------------------------------------------------------------

  broadcastFrame(): void {
    this._broadcastState(this._manager.state);
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _handleEncounterResult(payload: EncounterResultPayload): void {
    const state = this._manager.state;
    const triggeredAtSeconds = state.elapsedSeconds;

    if (payload.type === 'risk_gate') {
      this.dispatchRiskGateChoice(payload.encounterId, payload.choice, triggeredAtSeconds);
      return;
    }

    if (payload.type === 'shop') {
      // Resolve item from active encounter context
      const shopItem = this._activeEncounter?.shopItems?.get(payload.choice.itemId);
      if (!shopItem) {
        console.warn(`[EncounterBridge] Unknown shop item: ${payload.choice.itemId}`);
        this._emitter.emit('encounter:closed');
        return;
      }
      this.dispatchShopPurchase(payload.encounterId, shopItem, triggeredAtSeconds);
      return;
    }

    const _exhaustive: never = payload; throw new Error(`Unhandled encounter result type: ${JSON.stringify(_exhaustive)}`);
  }

  private _broadcastState(state: RunState): void {
    this._emitter.emit('run:state', toHUDPayload(state));
  }

  private _checkTerminal(state: RunState): void {
    if (state.phase === 'dead') {
      this._emitter.emit('game:over', { reason: 'hp_zero', finalScore: state.score.baseScore });
    }
    if (state.phase === 'complete') {
      this._emitter.emit('run:complete', { finalScore: state.score.baseScore });
    }
  }
}
