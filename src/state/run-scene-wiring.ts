/**
 * Swipe Salvage — RunScene Wiring
 *
 * Drop-in integration for RunScene.create() / RunScene.update() / RunScene.shutdown().
 * Encapsulates all RunStateManager ↔ Phaser event bus connections in one place.
 *
 * Usage in RunScene (Phaser 3):
 * ```typescript
 * import { RunSceneWiring } from '../state/run-scene-wiring';
 *
 * class RunScene extends Phaser.Scene {
 *   private wiring!: RunSceneWiring;
 *
 *   create() {
 *     const manager = new RunStateManager(initialState, traitRegistry);
 *     this.wiring = new RunSceneWiring(manager, this.game.events);
 *     this.wiring.mount();
 *   }
 *
 *   update(_time: number, _delta: number) {
 *     this.wiring.tick(_delta / 1000); // delta in seconds
 *   }
 *
 *   shutdown() {
 *     this.wiring.unmount();
 *   }
 * }
 * ```
 *
 * Emits (consumed by HUDScene):
 *   `run:state`        — every frame / every dispatch
 *   `run:phase_change` — {from, to}
 *   `run:hp_change`    — {hp, maxHp}
 *   `game:over`        — {reason, finalScore}
 *   `run:complete`     — {finalScore}
 *   `encounter:closed` — encounter modal should dismiss
 *
 * Listens (from EncounterScene):
 *   `encounter:open`   — ActiveEncounterContext
 *   `encounter:result` — EncounterResultPayload
 */

import { RunStateManager } from './run-state-manager';
import { EncounterBridge } from './encounter-bridge';
import { HUDBroadcaster } from './hud-broadcaster';
import type { IEventEmitter } from './encounter-bridge';
import type { TraitDef } from '../types/traits';
import type { RunState } from '../types/run-state';

export class RunSceneWiring {
  readonly manager: RunStateManager;
  private readonly _bridge: EncounterBridge;
  private readonly _hud: HUDBroadcaster;

  constructor(
    initialState: RunState,
    emitter: IEventEmitter,
    traitRegistry: ReadonlyMap<string, TraitDef> = new Map(),
  ) {
    this.manager = new RunStateManager(initialState, traitRegistry);
    this._bridge = new EncounterBridge(this.manager, emitter);
    this._hud = new HUDBroadcaster(this.manager, emitter);
  }

  mount(): void {
    this._bridge.mount();
    this._hud.mount();
  }

  unmount(): void {
    this._bridge.unmount();
    this._hud.unmount();
  }

  /**
   * Call from RunScene.update() each frame.
   * @param dt delta time in seconds
   */
  tick(dt: number, distanceDelta: number): void {
    this.manager.dispatch({ type: 'TICK', dt, distanceDelta });
    this.manager.dispatch({ type: 'MODULE_COOLDOWN_TICK', dt });
    this.manager.dispatch({ type: 'INVULN_TICK', dt });
  }

  get state(): RunState {
    return this.manager.state;
  }
}
