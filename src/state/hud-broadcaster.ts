/**
 * Swipe Salvage — HUDBroadcaster
 *
 * Subscribes to RunStateManager and emits HUD-relevant events on every state change.
 * Decouples HUDScene from RunScene — HUD only needs to listen to game.events.
 *
 * Events emitted:
 *   `run:state`        — full HUD payload every dispatch (HUDScene calls updateAll)
 *   `run:phase_change` — {from, to} when phase transitions
 *   `run:hp_change`    — {hp, maxHp} when vitals change
 *   `game:over`        — when phase → dead
 *   `run:complete`     — when phase → complete
 *
 * Phaser wiring (in RunScene.create(), after RunStateManager is ready):
 * ```typescript
 * const hud = new HUDBroadcaster(this.runStateManager, this.game.events);
 * hud.mount();
 * // On scene shutdown:
 * hud.unmount();
 * ```
 */

import type { RunStateManager, StateListener } from './run-state-manager';
import type { RunState, RunPhase } from '../types/run-state';
import type { IEventEmitter } from './encounter-bridge';
import type { RunAction } from './actions';

// ---------------------------------------------------------------------------
// HUDBroadcaster
// ---------------------------------------------------------------------------

export class HUDBroadcaster {
  private readonly _manager: RunStateManager;
  private readonly _emitter: IEventEmitter;
  private _unsub: (() => void) | null = null;
  private _lastPhase: RunPhase | null = null;
  private _lastHp: number | null = null;

  constructor(manager: RunStateManager, emitter: IEventEmitter) {
    this._manager = manager;
    this._emitter = emitter;
  }

  mount(): void {
    if (this._unsub) return;
    const listener: StateListener = (state: RunState, action: RunAction) => {
      this._onStateChange(state, action);
    };
    this._unsub = this._manager.subscribe(listener);

    // Emit initial state immediately so HUD populates on scene start
    this._broadcast(this._manager.state);
    this._lastPhase = this._manager.state.phase;
    this._lastHp = this._manager.state.vitals.hp;
  }

  unmount(): void {
    this._unsub?.();
    this._unsub = null;
    this._lastPhase = null;
    this._lastHp = null;
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _onStateChange(state: RunState, _action: RunAction): void {
    this._broadcast(state);

    // Phase change event
    if (state.phase !== this._lastPhase) {
      this._emitter.emit('run:phase_change', {
        from: this._lastPhase,
        to: state.phase,
      });
      this._lastPhase = state.phase;

      if (state.phase === 'dead') {
        this._emitter.emit('game:over', {
          reason: 'hp_zero',
          finalScore: state.score.baseScore,
        });
      }
      if (state.phase === 'complete') {
        this._emitter.emit('run:complete', {
          finalScore: state.score.baseScore,
        });
      }
    }

    // HP change event (drives heart UI update)
    if (state.vitals.hp !== this._lastHp) {
      this._emitter.emit('run:hp_change', {
        hp: state.vitals.hp,
        maxHp: state.vitals.maxHp,
      });
      this._lastHp = state.vitals.hp;
    }
  }

  private _broadcast(state: RunState): void {
    this._emitter.emit('run:state', {
      state,
      phase: state.phase,
      hp: state.vitals.hp,
      maxHp: state.vitals.maxHp,
      shields: state.vitals.shields,
      score: state.score.baseScore,
      multiplier: state.score.multiplier,
      wallet: state.wallet,
      heat: state.vitals.heat,
    });
  }
}
