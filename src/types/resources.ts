/**
 * Swipe Salvage — Resource Types
 * All currency and resource types used in-run and in meta-progression.
 */

// ---------------------------------------------------------------------------
// Currency identifiers
// ---------------------------------------------------------------------------

export const RESOURCE_TYPES = ['scrap', 'energy', 'cores', 'keys'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * Immutable snapshot of a player's resource wallet.
 * In-run: scrap + energy + keys are active.
 * Meta: scrap + cores are persistent across runs.
 */
export interface ResourceWallet {
  /** Soft currency — frequent drops, used for upgrades/crafting */
  readonly scrap: number;
  /** In-run currency — spent at shop drones, risk gates */
  readonly energy: number;
  /** Hard/rare currency — high-tier upgrades, trait unlocks (meta) */
  readonly cores: number;
  /** Situational — opens lock crates / bonus rooms */
  readonly keys: number;
}

export const EMPTY_WALLET: ResourceWallet = {
  scrap: 0,
  energy: 0,
  cores: 0,
  keys: 0,
} as const;

/** Partial wallet used in delta operations — any omitted field defaults to 0 */
export type ResourceDelta = Partial<Record<ResourceType, number>>;

/**
 * Apply a delta to a wallet. Values are clamped to [0, cap].
 * Returns a new wallet (immutable update).
 */
export function applyDelta(
  wallet: ResourceWallet,
  delta: ResourceDelta,
  caps: Partial<Record<ResourceType, number>> = {}
): ResourceWallet {
  const next = { ...wallet };
  for (const key of RESOURCE_TYPES) {
    if (delta[key] !== undefined) {
      const raw = next[key] + delta[key]!;
      const cap = caps[key] ?? Infinity;
      next[key] = Math.max(0, Math.min(raw, cap)) as never;
    }
  }
  return next;
}

/**
 * Check whether a wallet can afford a given cost.
 */
export function canAfford(wallet: ResourceWallet, cost: ResourceDelta): boolean {
  for (const key of RESOURCE_TYPES) {
    if ((cost[key] ?? 0) > wallet[key]) return false;
  }
  return true;
}
