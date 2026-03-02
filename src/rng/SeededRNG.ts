/**
 * SeededRNG — deterministic LCG PRNG.
 * Numerical Recipes constants. Isolated per-subsystem streams via derived seeds.
 * Never use Math.random() in game logic — use this instead.
 */
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    // Warm up — first few LCG values can be poor quality
    for (let i = 0; i < 4; i++) this.next();
  }

  /** Returns uniform float in [0, 1) */
  next(): number {
    // LCG: Numerical Recipes
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  /** Integer in [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Float in [min, max) */
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /** Pick one item from array with equal probability */
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted pick — items must have a `weight: number` property */
  weightedPick<T extends { weight: number }>(items: T[]): T {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = this.next() * total;
    for (const item of items) {
      r -= item.weight;
      if (r <= 0) return item;
    }
    return items[items.length - 1];
  }

  /** Current state snapshot (for save/resume) */
  getState(): number { return this.state; }

  /** Restore from snapshot */
  setState(s: number): void { this.state = s >>> 0; }
}

/** Create a run's RNG streams from a root seed — per-subsystem isolation */
export function createRunRNGStreams(rootSeed: number) {
  const root = new SeededRNG(rootSeed);
  return {
    spawn:     new SeededRNG(root.nextInt(0, 0xFFFFFFFF)),
    loot:      new SeededRNG(root.nextInt(0, 0xFFFFFFFF)),
    hazard:    new SeededRNG(root.nextInt(0, 0xFFFFFFFF)),
    encounter: new SeededRNG(root.nextInt(0, 0xFFFFFFFF)),
    vfx:       new SeededRNG(root.nextInt(0, 0xFFFFFFFF)),
  };
}

/** Generate a run seed from the current timestamp (for non-daily runs) */
export function generateRunSeed(): number {
  return (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
}
