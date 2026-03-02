/**
 * Swipe Salvage — SeededRNG
 * Deterministic LCG-based pseudo-random number generator.
 * Must produce identical sequences given the same seed across all browsers.
 *
 * Uses Numerical Recipes LCG constants: multiplier=1664525, increment=1013904223, modulus=2^32
 */

export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    // Ensure unsigned 32-bit integer
    this.state = seed >>> 0;
  }

  /**
   * Advance state and return next value in [0, 1)
   */
  next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  /**
   * Inclusive integer in [min, max]
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Float in [min, max)
   */
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /**
   * Boolean with given probability (default 0.5)
   */
  nextBool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  /**
   * Pick one item uniformly at random from an array.
   */
  pick<T>(items: ReadonlyArray<T>): T {
    if (items.length === 0) throw new RangeError('Cannot pick from empty array');
    return items[this.nextInt(0, items.length - 1)];
  }

  /**
   * Pick one item from a weighted array.
   * Items with higher weight are proportionally more likely to be chosen.
   */
  weightedPick<T>(items: ReadonlyArray<{ item: T; weight: number }>): T {
    if (items.length === 0) throw new RangeError('Cannot pick from empty array');
    const total = items.reduce((sum, e) => sum + e.weight, 0);
    let roll = this.next() * total;
    for (const entry of items) {
      roll -= entry.weight;
      if (roll <= 0) return entry.item;
    }
    return items[items.length - 1].item;
  }

  /**
   * Shuffle array in-place using Fisher-Yates (deterministic).
   */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Current internal state (for snapshots / serialization)
   */
  getState(): number {
    return this.state;
  }

  /**
   * Restore state (e.g., from a crash recovery snapshot)
   */
  setState(state: number): void {
    this.state = state >>> 0;
  }

  /**
   * Fork: create a child RNG derived from this one's next value.
   * Safe to call between any two `next()` calls — does not corrupt parent stream.
   */
  fork(): SeededRNG {
    return new SeededRNG(this.nextInt(0, 0xffffffff));
  }
}

// ---------------------------------------------------------------------------
// SeedManager — manages isolated RNG streams per subsystem
// ---------------------------------------------------------------------------

export type RNGStreamKey = 'spawn' | 'loot' | 'encounter' | 'hazard' | 'cosmetic' | 'trait';

export class SeedManager {
  private readonly streams: Map<RNGStreamKey, SeededRNG> = new Map();

  constructor(rootSeed: number) {
    const root = new SeededRNG(rootSeed);
    // Each subsystem gets an isolated stream derived from root
    // Order is fixed and must never change (would break determinism)
    const keys: RNGStreamKey[] = ['spawn', 'loot', 'encounter', 'hazard', 'cosmetic', 'trait'];
    for (const key of keys) {
      this.streams.set(key, root.fork());
    }
  }

  get(key: RNGStreamKey): SeededRNG {
    const rng = this.streams.get(key);
    if (!rng) throw new Error(`Unknown RNG stream key: ${key}`);
    return rng;
  }

  /**
   * Snapshot all stream states for crash recovery.
   */
  snapshot(): Record<RNGStreamKey, number> {
    const out = {} as Record<RNGStreamKey, number>;
    for (const [key, rng] of this.streams) {
      out[key] = rng.getState();
    }
    return out;
  }

  /**
   * Restore from snapshot.
   */
  restore(snapshot: Record<RNGStreamKey, number>): void {
    for (const [key, state] of Object.entries(snapshot) as [RNGStreamKey, number][]) {
      this.streams.get(key)?.setState(state);
    }
  }
}

// ---------------------------------------------------------------------------
// Seed factories
// ---------------------------------------------------------------------------

/**
 * Generate a daily seed from a UTC date. Identical for all players on the same day.
 */
export function dailySeed(date: Date): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  return Math.floor(Date.UTC(y, m, d) / 86400000) >>> 0;
}

/**
 * Generate a weekly seed from a UTC date (ISO week-based).
 */
export function weeklySeed(date: Date): number {
  const dayMs = 86400000;
  const weekStart = date.getUTCDay();
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((weekStart + 6) % 7));
  return Math.floor(monday.getTime() / (dayMs * 7)) >>> 0;
}

/**
 * Generate a cryptographically random seed for standard runs.
 */
export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0];
  }
  return (Math.random() * 0xffffffff) >>> 0;
}
