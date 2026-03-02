import { SeededRNG, SeedManager, dailySeed, weeklySeed } from '../rng/seeded-rng';

describe('SeededRNG', () => {
  it('produces values in [0, 1)', () => {
    const rng = new SeededRNG(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic — same seed produces same sequence', () => {
    const a = new SeededRNG(1234);
    const b = new SeededRNG(1234);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different sequences', () => {
    const a = new SeededRNG(1);
    const b = new SeededRNG(2);
    const results = Array.from({ length: 10 }, () => [a.next(), b.next()]);
    // At least one value should differ
    expect(results.some(([x, y]) => x !== y)).toBe(true);
  });

  it('nextInt stays within range', () => {
    const rng = new SeededRNG(99);
    for (let i = 0; i < 500; i++) {
      const v = rng.nextInt(0, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(4);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('nextFloat stays within range', () => {
    const rng = new SeededRNG(7);
    for (let i = 0; i < 200; i++) {
      const v = rng.nextFloat(10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  it('pick throws on empty array', () => {
    const rng = new SeededRNG(1);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('weightedPick respects weights (statistical)', () => {
    const rng = new SeededRNG(555);
    const items = [
      { item: 'rare', weight: 5 },
      { item: 'common', weight: 95 },
    ];
    const counts: Record<string, number> = { rare: 0, common: 0 };
    for (let i = 0; i < 1000; i++) {
      counts[rng.weightedPick(items)]++;
    }
    // common should appear ~950 times — allow ±10%
    expect(counts.common).toBeGreaterThan(850);
    expect(counts.rare).toBeLessThan(150);
  });

  it('state snapshot & restore produces identical continuation', () => {
    const rng = new SeededRNG(12345);
    // Advance a bit
    for (let i = 0; i < 50; i++) rng.next();
    const snap = rng.getState();
    const seq1 = Array.from({ length: 20 }, () => rng.next());

    rng.setState(snap);
    const seq2 = Array.from({ length: 20 }, () => rng.next());

    expect(seq1).toEqual(seq2);
  });

  it('fork does not corrupt parent stream', () => {
    const parent = new SeededRNG(777);
    // Advance parent to known position
    const before = Array.from({ length: 5 }, () => parent.next());
    const snapBefore = parent.getState();

    // Fork and consume from child
    const child = parent.fork(); // consumes one value from parent
    for (let i = 0; i < 20; i++) child.next();

    // Parent continues from after the fork
    const afterFork = Array.from({ length: 5 }, () => parent.next());

    // Sanity: parent produced different values before and after fork call
    // (values after fork should be different from before since state advanced)
    expect(afterFork).not.toEqual(before);

    // Determinism: doing the same thing again produces the same parent-after values
    const parent2 = new SeededRNG(777);
    Array.from({ length: 5 }, () => parent2.next()); // same "before"
    parent2.fork(); // consume same value
    const afterFork2 = Array.from({ length: 5 }, () => parent2.next());
    expect(afterFork).toEqual(afterFork2);
  });
});

// ---------------------------------------------------------------------------
// SeedManager
// ---------------------------------------------------------------------------

describe('SeedManager', () => {
  it('provides isolated streams per key', () => {
    const mgr = new SeedManager(42);
    const spawnVal = mgr.get('spawn').next();
    const lootVal = mgr.get('loot').next();
    // Streams are independent and should differ (extremely unlikely to collide)
    expect(spawnVal).not.toBe(lootVal);
  });

  it('same root seed → same per-stream sequences (deterministic)', () => {
    const mgr1 = new SeedManager(99);
    const mgr2 = new SeedManager(99);
    for (let i = 0; i < 50; i++) {
      expect(mgr1.get('spawn').next()).toBe(mgr2.get('spawn').next());
      expect(mgr1.get('hazard').next()).toBe(mgr2.get('hazard').next());
    }
  });

  it('snapshot and restore preserves stream state', () => {
    const mgr = new SeedManager(7);
    // Advance all streams
    for (let i = 0; i < 20; i++) {
      mgr.get('spawn').next();
      mgr.get('loot').next();
    }
    const snap = mgr.snapshot();

    // Record next values before restore
    const spawnNext = mgr.get('spawn').next();

    // Restore and check
    mgr.restore(snap);
    expect(mgr.get('spawn').next()).toBe(spawnNext);
  });
});

// ---------------------------------------------------------------------------
// Seed factories
// ---------------------------------------------------------------------------

describe('dailySeed', () => {
  it('is stable within the same day', () => {
    const d1 = new Date('2026-03-02T08:00:00Z');
    const d2 = new Date('2026-03-02T23:59:59Z');
    expect(dailySeed(d1)).toBe(dailySeed(d2));
  });

  it('differs on different days', () => {
    const d1 = new Date('2026-03-02T12:00:00Z');
    const d2 = new Date('2026-03-03T12:00:00Z');
    expect(dailySeed(d1)).not.toBe(dailySeed(d2));
  });
});

describe('weeklySeed', () => {
  it('is stable within the same week', () => {
    const mon = new Date('2026-03-02T00:00:00Z');
    const sun = new Date('2026-03-08T23:59:59Z');
    expect(weeklySeed(mon)).toBe(weeklySeed(sun));
  });

  it('differs on different weeks', () => {
    const w1 = new Date('2026-03-02T12:00:00Z');
    const w2 = new Date('2026-03-09T12:00:00Z');
    expect(weeklySeed(w1)).not.toBe(weeklySeed(w2));
  });
});
