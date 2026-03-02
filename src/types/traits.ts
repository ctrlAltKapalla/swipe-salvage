/**
 * Swipe Salvage — Trait Types
 * Traits are build synergies acquired during a run. Data-driven, no code changes for new entries.
 */

import type { EffectTag } from './modules';

// ---------------------------------------------------------------------------
// Trait archetypes (from GDD §5.3)
// ---------------------------------------------------------------------------

export const TRAIT_ARCHETYPES = [
  'magnet_loot',
  'defense',
  'speed_score',
  'heat_overcharge',
  'control',
  'utility',
] as const;
export type TraitArchetype = (typeof TRAIT_ARCHETYPES)[number];

// ---------------------------------------------------------------------------
// Trigger conditions — when a trait effect fires
// ---------------------------------------------------------------------------

export const TRIGGER_KINDS = [
  'on_lane_change',       // player changes lane
  'on_pickup',            // any pickup collected
  'on_hit',               // player takes damage
  'on_module_activate',   // any active module used
  'on_encounter_complete',// encounter resolved
  'on_perfect_dodge',     // player dodges within timing window
  'on_heat_threshold',    // heat reaches a defined level
  'passive',              // always active, no trigger
  'on_overheat',          // player overheats
  'on_scrap_pickup',      // specifically scrap (not generic pickup)
  'on_shield_break',      // shield depleted
] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export interface TriggerCondition {
  readonly kind: TriggerKind;
  /**
   * Optional filter. E.g. for 'on_module_activate', can restrict to specific effectTags.
   * For 'on_heat_threshold', specifies the threshold value (0–1 normalized).
   */
  readonly filter?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Trait effect
// ---------------------------------------------------------------------------

export interface TraitEffect {
  /** Lookup key into TraitEffectRegistry */
  readonly effectId: string;
  readonly tags: ReadonlyArray<EffectTag>;
  readonly description: string;
  readonly params: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Trait definition — static registry entry
// ---------------------------------------------------------------------------

export interface TraitDef {
  readonly id: string;
  readonly name: string;
  readonly archetype: TraitArchetype;
  readonly trigger: TriggerCondition;
  readonly effect: TraitEffect;
  /** Short UI tooltip */
  readonly tooltip: string;
  /** Asset key for icon sprite */
  readonly iconKey: string;
  /**
   * Max stacks. 1 = non-stackable.
   * Stacking compounds the effect (params multiplied by stack count unless overridden).
   */
  readonly maxStacks: number;
  /**
   * Module or tag synergy hints. Used by UI to show synergy indicators.
   * E.g. ["mod_magnet_field", "tag:loot"] means this trait benefits from those.
   */
  readonly synergyWith: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Trait instance — owned during a run
// ---------------------------------------------------------------------------

export interface ActiveTrait {
  readonly defId: string;
  stacks: number; // mutable during run
}
