/**
 * Swipe Salvage — Encounter Types
 * Encounters are mid-run decision events: shop drones, risk gates, elites.
 */

import type { ResourceDelta } from './resources';
import type { TraitDef } from './traits';
import type { ModuleDef } from './modules';

// ---------------------------------------------------------------------------
// Encounter kinds
// ---------------------------------------------------------------------------

export const ENCOUNTER_KINDS = ['shop_drone', 'risk_gate', 'elite'] as const;
export type EncounterKind = (typeof ENCOUNTER_KINDS)[number];

// ---------------------------------------------------------------------------
// Shop Drone
// ---------------------------------------------------------------------------

export interface ShopItem {
  readonly id: string;
  readonly label: string;
  readonly cost: ResourceDelta;
  readonly kind: 'upgrade' | 'heal' | 'module_reroll' | 'trait';
  /** Reference to what is being offered (moduleDefId or traitDefId if relevant) */
  readonly refId?: string;
  /** Numeric value of the offer (e.g. heal amount) */
  readonly value?: number;
}

export interface ShopDroneEncounter {
  readonly kind: 'shop_drone';
  readonly items: ReadonlyArray<ShopItem>;
}

// ---------------------------------------------------------------------------
// Risk Gate
// ---------------------------------------------------------------------------

export interface RiskGateOption {
  readonly id: string;
  readonly label: string;
  /** Positive effect gained on choosing this option */
  readonly reward: {
    readonly description: string;
    readonly delta?: ResourceDelta;
    readonly traitId?: string;
    readonly scoreMultiplierBonus?: number;
  };
  /** Negative trade-off */
  readonly hazard: {
    readonly description: string;
    readonly hpDamage?: number;
    readonly hazardRateMultiplier?: number;
    readonly shieldLoss?: number;
  };
}

export interface RiskGateEncounter {
  readonly kind: 'risk_gate';
  /** 2–3 options, RNG-generated per encounter */
  readonly options: ReadonlyArray<RiskGateOption>;
}

// ---------------------------------------------------------------------------
// Elite
// ---------------------------------------------------------------------------

export interface EliteEncounter {
  readonly kind: 'elite';
  readonly eliteId: string;
  readonly name: string;
  /** Guaranteed reward on completion */
  readonly reward: {
    readonly description: string;
    readonly delta?: ResourceDelta;
    readonly traitId?: string;
  };
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type Encounter = ShopDroneEncounter | RiskGateEncounter | EliteEncounter;

// ---------------------------------------------------------------------------
// Encounter history record
// ---------------------------------------------------------------------------

export interface EncounterRecord {
  readonly kind: EncounterKind;
  readonly encounterId: string;
  readonly triggeredAtSeconds: number;
  /** The choice made (shopItem id, riskGate option id, or 'completed' for elite) */
  readonly choiceId: string;
}
