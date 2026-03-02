/**
 * Swipe Salvage — Baseline Module Data
 * Prototype set: 4 Active Modules + 2 Passive Cores.
 * Adding new modules = data entry only, zero code changes.
 */

import type { ModuleDef } from '../types/modules';

export const MODULE_DEFS: ReadonlyArray<ModuleDef> = [
  // =========================================================================
  // ACTIVE MODULES
  // =========================================================================
  {
    id: 'mod_shield_burst',
    name: 'Shield Burst',
    type: 'active',
    baseCooldown: 14,
    visualKey: 'vfx_shield_burst',
    shortDesc: 'Project a short-lived shield that absorbs damage and pushes back nearby threats.',
    effect: {
      effectId: 'shield_burst',
      tags: ['shield', 'control'],
      description: 'Grant {shieldAmount} shield HP for {duration}s. Push back threats within {radius} units.',
      params: { shieldAmount: 2, duration: 3.5, radius: 80 },
    },
    maxUpgradeLevel: 3,
    upgradeLevels: [
      { shieldAmount: 3, duration: 4 },         // level 1
      { shieldAmount: 4, duration: 4.5, radius: 100 }, // level 2
      { shieldAmount: 5, duration: 5, radius: 120 },   // level 3
    ],
    unlockCost: { scrap: 0 },   // starter module
    upgradeCost: { scrap: 80, cores: 1 },
  },

  {
    id: 'mod_boost_jet',
    name: 'Boost Jet',
    type: 'active',
    baseCooldown: 18,
    visualKey: 'vfx_boost_jet',
    shortDesc: 'Rocket forward 2 lanes instantly, scoring bonus points for distance cleared.',
    effect: {
      effectId: 'boost_jet',
      tags: ['movement', 'score'],
      description: 'Instantly move {lanes} lanes forward. +{scoreBonus}% score multiplier for {duration}s.',
      params: { lanes: 2, scoreBonus: 25, duration: 4 },
    },
    maxUpgradeLevel: 3,
    upgradeLevels: [
      { scoreBonus: 35, duration: 5 },
      { lanes: 3, scoreBonus: 45, duration: 5 },
      { lanes: 3, scoreBonus: 60, duration: 6 },
    ],
    unlockCost: { scrap: 60 },
    upgradeCost: { scrap: 100, cores: 1 },
  },

  {
    id: 'mod_emp_pulse',
    name: 'EMP Pulse',
    type: 'active',
    baseCooldown: 22,
    visualKey: 'vfx_emp_pulse',
    shortDesc: 'Emit an electromagnetic pulse that disables hazards and threats in radius.',
    effect: {
      effectId: 'emp_pulse',
      tags: ['control', 'utility'],
      description: 'Disable all hazards/threats within {radius} units for {duration}s.',
      params: { radius: 150, duration: 2.5 },
    },
    maxUpgradeLevel: 3,
    upgradeLevels: [
      { radius: 180, duration: 3 },
      { radius: 220, duration: 3.5 },
      { radius: 280, duration: 4, damageDealt: 1 },
    ],
    unlockCost: { scrap: 80 },
    upgradeCost: { scrap: 120, cores: 2 },
  },

  {
    id: 'mod_magnet_field',
    name: 'Magnet Field',
    type: 'active',
    baseCooldown: 12,
    visualKey: 'vfx_magnet_field',
    shortDesc: 'Activate a powerful loot magnet that draws all nearby pickups to you.',
    effect: {
      effectId: 'magnet_field',
      tags: ['loot', 'utility'],
      description: 'Attract all pickups within {radius} units for {duration}s. Loot pickup radius ×{radiusMultiplier}.',
      params: { radius: 300, duration: 5, radiusMultiplier: 3 },
    },
    maxUpgradeLevel: 3,
    upgradeLevels: [
      { radius: 400, duration: 6 },
      { radius: 500, duration: 7, radiusMultiplier: 4 },
      { radius: 600, duration: 8, radiusMultiplier: 5 },
    ],
    unlockCost: { scrap: 50 },
    upgradeCost: { scrap: 70, cores: 1 },
  },

  // =========================================================================
  // PASSIVE CORES
  // =========================================================================
  {
    id: 'core_overclock',
    name: 'Overclock Core',
    type: 'passive_core',
    baseCooldown: 0,
    visualKey: 'vfx_core_overclock',
    shortDesc: 'Overclock your chassis for higher score and speed — but heat builds faster.',
    effect: {
      effectId: 'overclock_passive',
      tags: ['score', 'heat'],
      description:
        'Score multiplier +{scoreBonus}%. Speed +{speedBonus}%. Heat rate ×{heatMultiplier}.',
      params: { scoreBonus: 30, speedBonus: 15, heatMultiplier: 1.5 },
    },
    maxUpgradeLevel: 2,
    upgradeLevels: [
      { scoreBonus: 45, speedBonus: 20, heatMultiplier: 1.7 },
      { scoreBonus: 60, speedBonus: 28, heatMultiplier: 2.0 },
    ],
    unlockCost: { scrap: 150, cores: 2 },
    upgradeCost: { scrap: 200, cores: 3 },
  },

  {
    id: 'core_salvager',
    name: 'Salvager Core',
    type: 'passive_core',
    baseCooldown: 0,
    visualKey: 'vfx_core_salvager',
    shortDesc: 'Optimized for loot extraction — more pickups, less armor.',
    effect: {
      effectId: 'salvager_passive',
      tags: ['loot', 'shield'],
      description:
        'Loot pickup radius ×{lootRadiusMultiplier}. Scrap value +{scrapBonus}%. Max HP -{hpPenalty}.',
      params: { lootRadiusMultiplier: 1.5, scrapBonus: 40, hpPenalty: 1 },
    },
    maxUpgradeLevel: 2,
    upgradeLevels: [
      { lootRadiusMultiplier: 2.0, scrapBonus: 60 },
      { lootRadiusMultiplier: 2.5, scrapBonus: 80, hpPenalty: 0 },
    ],
    unlockCost: { scrap: 120, cores: 2 },
    upgradeCost: { scrap: 180, cores: 3 },
  },
] as const;

/**
 * Build a registry Map for O(1) lookup by id.
 */
export function buildModuleRegistry(defs: ReadonlyArray<ModuleDef>): ReadonlyMap<string, ModuleDef> {
  return new Map(defs.map((d) => [d.id, d]));
}

export const MODULE_REGISTRY: ReadonlyMap<string, ModuleDef> = buildModuleRegistry(MODULE_DEFS);
