/**
 * Swipe Salvage — Baseline Trait Data
 * Prototype set: 8 Traits across all archetypes.
 * Adding new traits = data entry only, zero code changes.
 */

import type { TraitDef } from '../types/traits';

export const TRAIT_DEFS: ReadonlyArray<TraitDef> = [
  // =========================================================================
  // MAGNET / LOOT
  // =========================================================================
  {
    id: 'trait_chain_magnet',
    name: 'Chain Magnet',
    archetype: 'magnet_loot',
    trigger: { kind: 'on_pickup' },
    effect: {
      effectId: 'chain_magnet',
      tags: ['loot'],
      description: 'After collecting a pickup, attract all pickups within {radius} units for {duration}s.',
      params: { radius: 120, duration: 1.5 },
    },
    tooltip: 'Pickups pull in nearby loot briefly after collection.',
    iconKey: 'icon_trait_chain_magnet',
    maxStacks: 3,
    synergyWith: ['mod_magnet_field', 'core_salvager', 'tag:loot'],
  },

  {
    id: 'trait_scrap_converter',
    name: 'Scrap Converter',
    archetype: 'utility',
    trigger: { kind: 'on_scrap_pickup' },
    effect: {
      effectId: 'scrap_convert',
      tags: ['loot', 'utility'],
      description: 'Every {scrapThreshold} Scrap collected converts {energyGain} Energy.',
      params: { scrapThreshold: 20, energyGain: 1 },
    },
    tooltip: 'Surplus scrap generates Energy for in-run spending.',
    iconKey: 'icon_trait_scrap_converter',
    maxStacks: 2,
    synergyWith: ['core_salvager', 'tag:loot'],
  },

  // =========================================================================
  // DEFENSE
  // =========================================================================
  {
    id: 'trait_reflective_shield',
    name: 'Reflective Shield',
    archetype: 'defense',
    trigger: {
      kind: 'on_module_activate',
      filter: { moduleTags: ['shield'] },
    },
    effect: {
      effectId: 'reflect_laser',
      tags: ['shield', 'control'],
      description: 'While shield is active, reflect lasers back to their source for {damage} damage.',
      params: { damage: 1 },
    },
    tooltip: 'Shield Burst reflects lasers while it holds.',
    iconKey: 'icon_trait_reflective_shield',
    maxStacks: 1,
    synergyWith: ['mod_shield_burst', 'tag:shield'],
  },

  {
    id: 'trait_bulwark',
    name: 'Bulwark',
    archetype: 'defense',
    trigger: { kind: 'on_hit' },
    effect: {
      effectId: 'bulwark',
      tags: ['shield'],
      description: 'On taking damage, gain {shieldAmount} shield HP (once per {cooldown}s).',
      params: { shieldAmount: 1, cooldown: 8 },
    },
    tooltip: 'Damage triggers a reactive shield charge.',
    iconKey: 'icon_trait_bulwark',
    maxStacks: 2,
    synergyWith: ['mod_shield_burst'],
  },

  // =========================================================================
  // SPEED / SCORE
  // =========================================================================
  {
    id: 'trait_momentum',
    name: 'Momentum',
    archetype: 'speed_score',
    trigger: {
      kind: 'on_lane_change',
      filter: { requirePerfectTiming: true },
    },
    effect: {
      effectId: 'momentum_score',
      tags: ['score', 'movement'],
      description: 'Lane change within timing window adds +{scoreFlat} score and +{multiplierBonus}% multiplier for {duration}s.',
      params: { scoreFlat: 50, multiplierBonus: 5, duration: 3 },
    },
    tooltip: 'Perfectly timed lane swaps boost your score.',
    iconKey: 'icon_trait_momentum',
    maxStacks: 3,
    synergyWith: ['mod_boost_jet', 'tag:movement'],
  },

  // =========================================================================
  // HEAT / OVERCHARGE
  // =========================================================================
  {
    id: 'trait_heat_sink',
    name: 'Heat Sink',
    archetype: 'heat_overcharge',
    trigger: { kind: 'on_perfect_dodge' },
    effect: {
      effectId: 'heat_reduction',
      tags: ['heat', 'utility'],
      description: 'Perfect dodge reduces heat by {heatReduction} (normalized).',
      params: { heatReduction: 0.15 },
    },
    tooltip: 'Perfect dodges vent heat from your chassis.',
    iconKey: 'icon_trait_heat_sink',
    maxStacks: 3,
    synergyWith: ['core_overclock', 'tag:heat'],
  },

  // =========================================================================
  // CONTROL
  // =========================================================================
  {
    id: 'trait_aftershock',
    name: 'Aftershock',
    archetype: 'control',
    trigger: {
      kind: 'on_module_activate',
      filter: { moduleTags: ['control'] },
    },
    effect: {
      effectId: 'aftershock',
      tags: ['control', 'damage'],
      description: 'EMP Pulse also deals {damage} damage to disabled threats and extends disable duration by {durationBonus}s.',
      params: { damage: 1, durationBonus: 1 },
    },
    tooltip: 'EMP hits harder and lingers longer.',
    iconKey: 'icon_trait_aftershock',
    maxStacks: 2,
    synergyWith: ['mod_emp_pulse', 'tag:control'],
  },

  // =========================================================================
  // UTILITY
  // =========================================================================
  {
    id: 'trait_key_finder',
    name: 'Key Finder',
    archetype: 'utility',
    trigger: { kind: 'on_pickup', filter: { pickupKind: 'scrap_large' } },
    effect: {
      effectId: 'key_chance',
      tags: ['loot', 'utility'],
      description: '{chance}% chance to find a Key when collecting large Scrap.',
      params: { chance: 20 },
    },
    tooltip: 'Large scrap drops occasionally contain a hidden Key.',
    iconKey: 'icon_trait_key_finder',
    maxStacks: 2,
    synergyWith: ['core_salvager'],
  },
] as const;

/**
 * Build a registry Map for O(1) lookup by id.
 */
export function buildTraitRegistry(defs: ReadonlyArray<TraitDef>): ReadonlyMap<string, TraitDef> {
  return new Map(defs.map((d) => [d.id, d]));
}

export const TRAIT_REGISTRY: ReadonlyMap<string, TraitDef> = buildTraitRegistry(TRAIT_DEFS);
