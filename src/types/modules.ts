/**
 * Swipe Salvage — Module & Passive Core Types
 * Defines the buildcraft system's active modules and passive cores.
 */

import type { ResourceDelta } from './resources';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const MODULE_TYPES = ['active', 'passive_core'] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

export const EFFECT_TAGS = [
  'shield',
  'movement',
  'damage',
  'loot',
  'score',
  'heat',
  'utility',
  'control',
] as const;
export type EffectTag = (typeof EFFECT_TAGS)[number];

// ---------------------------------------------------------------------------
// Effect descriptor — data-driven, no game logic here
// ---------------------------------------------------------------------------

/**
 * Describes what an effect does in plain terms.
 * Actual implementation is in the effect registry (systems layer).
 */
export interface EffectDescriptor {
  /** Unique key used to look up the handler in EffectRegistry */
  readonly effectId: string;
  /** Tags for synergy detection (e.g. a Trait that buffs 'shield' effects) */
  readonly tags: ReadonlyArray<EffectTag>;
  /** Human-readable description template. Use {value} tokens. */
  readonly description: string;
  /** Numeric params passed to the handler. All tunable via remote config. */
  readonly params: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Module definition — the static registry entry
// ---------------------------------------------------------------------------

export interface ModuleDef {
  readonly id: string;
  readonly name: string;
  readonly type: ModuleType;
  /** Only for active modules. In seconds. 0 for passives. */
  readonly baseCooldown: number;
  /** Visual signature used by asset system to load correct sprite/VFX */
  readonly visualKey: string;
  /** Short display description for UI */
  readonly shortDesc: string;
  readonly effect: EffectDescriptor;
  /** Max upgrade level (0 = not upgradeable) */
  readonly maxUpgradeLevel: number;
  /** Per-level parameter overrides. Index 0 = level 1 upgrades, etc. */
  readonly upgradeLevels: ReadonlyArray<Partial<EffectDescriptor['params']>>;
  /** Cost to unlock in workshop */
  readonly unlockCost: ResourceDelta;
  /** Cost to upgrade per level */
  readonly upgradeCost: ResourceDelta;
}

// ---------------------------------------------------------------------------
// Module instance — owned by RunState / MetaState
// ---------------------------------------------------------------------------

/** A module as it exists in a player's collection (meta layer) */
export interface OwnedModule {
  readonly defId: string;
  readonly upgradeLevel: number; // 0 = base
}

/** A module as it exists in an active loadout slot */
export interface LoadoutModule extends OwnedModule {
  /** Remaining cooldown in seconds. 0 = ready. Only meaningful for actives. */
  cooldownRemaining: number;
}

// ---------------------------------------------------------------------------
// Loadout
// ---------------------------------------------------------------------------

export const ACTIVE_SLOT_COUNT = 3;
export const PASSIVE_SLOT_COUNT = 1;

export interface Loadout {
  /** Exactly ACTIVE_SLOT_COUNT entries. Slot may be null if empty. */
  readonly activeSlots: ReadonlyArray<OwnedModule | null>;
  /** Exactly PASSIVE_SLOT_COUNT entries. */
  readonly passiveSlots: ReadonlyArray<OwnedModule | null>;
}

export const EMPTY_LOADOUT: Loadout = {
  activeSlots: Array(ACTIVE_SLOT_COUNT).fill(null),
  passiveSlots: Array(PASSIVE_SLOT_COUNT).fill(null),
} as const;

// ---------------------------------------------------------------------------
// Loadout validation
// ---------------------------------------------------------------------------

export type LoadoutValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

export function validateLoadout(
  loadout: Loadout,
  registry: ReadonlyMap<string, ModuleDef>
): LoadoutValidationResult {
  const errors: string[] = [];

  if (loadout.activeSlots.length !== ACTIVE_SLOT_COUNT) {
    errors.push(
      `activeSlots must have exactly ${ACTIVE_SLOT_COUNT} entries, got ${loadout.activeSlots.length}`
    );
  }
  if (loadout.passiveSlots.length !== PASSIVE_SLOT_COUNT) {
    errors.push(
      `passiveSlots must have exactly ${PASSIVE_SLOT_COUNT} entries, got ${loadout.passiveSlots.length}`
    );
  }

  const seenIds = new Set<string>();

  for (const slot of loadout.activeSlots) {
    if (slot === null) continue;
    const def = registry.get(slot.defId);
    if (!def) {
      errors.push(`Unknown module id: ${slot.defId}`);
      continue;
    }
    if (def.type !== 'active') {
      errors.push(`Module ${slot.defId} is not an active module`);
    }
    if (seenIds.has(slot.defId)) {
      errors.push(`Duplicate module in loadout: ${slot.defId}`);
    }
    seenIds.add(slot.defId);
    if (slot.upgradeLevel < 0 || slot.upgradeLevel > def.maxUpgradeLevel) {
      errors.push(
        `Module ${slot.defId} upgrade level ${slot.upgradeLevel} out of range [0, ${def.maxUpgradeLevel}]`
      );
    }
  }

  for (const slot of loadout.passiveSlots) {
    if (slot === null) continue;
    const def = registry.get(slot.defId);
    if (!def) {
      errors.push(`Unknown passive core id: ${slot.defId}`);
      continue;
    }
    if (def.type !== 'passive_core') {
      errors.push(`Module ${slot.defId} is not a passive core`);
    }
    if (seenIds.has(slot.defId)) {
      errors.push(`Duplicate module in loadout: ${slot.defId}`);
    }
    seenIds.add(slot.defId);
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
