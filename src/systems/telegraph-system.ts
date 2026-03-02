/**
 * Swipe Salvage — TelegraphSystem
 *
 * Manages the lifecycle of hazard telegraphs:
 *   IDLE → TELEGRAPHING → ACTIVE → EXPIRED
 *
 * Pure logic layer. Phaser renders based on TelegraphState emitted here.
 * Audio/visual cue keys are resolved from HazardDef — no asset coupling here.
 */

import type { HazardInstance } from '../types/hazards';
import type { HazardDef } from '../types/hazards';

// ---------------------------------------------------------------------------
// Telegraph event — emitted to audio/visual systems
// ---------------------------------------------------------------------------

export type TelegraphEventKind =
  | 'telegraph_start'    // play audio cue, show visual warning
  | 'telegraph_snap'     // visual "snap" to active state (per def.telegraph.snapAt)
  | 'hazard_activate'    // hazard becomes lethal
  | 'hazard_expire';     // hazard deactivated (no longer lethal)

export interface TelegraphEvent {
  readonly kind: TelegraphEventKind;
  readonly instanceId: string;
  readonly defId: string;
  readonly audioKey: string;
  readonly visualKey: string;
  readonly lanes: ReadonlyArray<number>;
}

export type TelegraphEventHandler = (event: TelegraphEvent) => void;

// ---------------------------------------------------------------------------
// TelegraphSystem
// ---------------------------------------------------------------------------

export class TelegraphSystem {
  private readonly _registry: ReadonlyMap<string, HazardDef>;
  private readonly _handlers: Set<TelegraphEventHandler> = new Set();

  /** Track which instances have already fired their snap event */
  private readonly _snapped: Set<string> = new Set();

  constructor(registry: ReadonlyMap<string, HazardDef>) {
    this._registry = registry;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  onEvent(handler: TelegraphEventHandler): () => void {
    this._handlers.add(handler);
    return () => this._handlers.delete(handler);
  }

  /**
   * Called when a new hazard instance is created by the spawner.
   * Fires 'telegraph_start'.
   */
  onHazardSpawned(instance: HazardInstance): void {
    const def = this._registry.get(instance.defId);
    if (!def) return;

    this._emit({
      kind: 'telegraph_start',
      instanceId: instance.id,
      defId: instance.defId,
      audioKey: def.telegraph.audioKey,
      visualKey: def.telegraph.visualKey,
      lanes: instance.occupiedLanes,
    });
  }

  /**
   * Update telegraph lifecycle for all active instances.
   * Should be called once per frame with dt.
   */
  update(instances: HazardInstance[], dt: number): void {
    for (const inst of instances) {
      const def = this._registry.get(inst.defId);
      if (!def) continue;

      if (inst.state === 'telegraphing') {
        inst.telegraphRemaining -= dt;

        // Check snap threshold
        const elapsed = def.telegraph.durationSeconds - inst.telegraphRemaining;
        const progress = elapsed / def.telegraph.durationSeconds;
        if (!this._snapped.has(inst.id) && progress >= def.telegraph.snapAt) {
          this._snapped.add(inst.id);
          this._emit({
            kind: 'telegraph_snap',
            instanceId: inst.id,
            defId: inst.defId,
            audioKey: 'sfx_hazard_snap',
            visualKey: def.telegraph.visualKey,
            lanes: inst.occupiedLanes,
          });
        }

        // Telegraph window expired → activate
        if (inst.telegraphRemaining <= 0) {
          inst.state = 'active';
          inst.activeRemaining = def.activeDurationSeconds;
          this._emit({
            kind: 'hazard_activate',
            instanceId: inst.id,
            defId: inst.defId,
            audioKey: 'sfx_hazard_activate',
            visualKey: def.telegraph.visualKey,
            lanes: inst.occupiedLanes,
          });
        }
      } else if (inst.state === 'active') {
        if (def.activeDurationSeconds > 0) {
          inst.activeRemaining -= dt;
          if (inst.activeRemaining <= 0) {
            inst.state = 'expired';
            this._snapped.delete(inst.id);
            this._emit({
              kind: 'hazard_expire',
              instanceId: inst.id,
              defId: inst.defId,
              audioKey: 'sfx_hazard_expire',
              visualKey: def.telegraph.visualKey,
              lanes: inst.occupiedLanes,
            });
          }
        }
      }
    }
  }

  /**
   * Remove tracking data for expired/removed instances.
   */
  cleanup(instanceId: string): void {
    this._snapped.delete(instanceId);
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _emit(event: TelegraphEvent): void {
    for (const handler of this._handlers) {
      handler(event);
    }
  }
}

// ---------------------------------------------------------------------------
// Telegraph progress query (for rendering)
// ---------------------------------------------------------------------------

/**
 * Returns normalized progress [0, 1] through the telegraph window.
 * Used by Phaser scene to interpolate glow/alpha/scale.
 */
export function telegraphProgress(instance: HazardInstance, def: HazardDef): number {
  if (instance.state !== 'telegraphing') return instance.state === 'active' ? 1 : 0;
  return 1 - instance.telegraphRemaining / def.telegraph.durationSeconds;
}
