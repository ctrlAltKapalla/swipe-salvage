import { applyDelta, canAfford, EMPTY_WALLET, ResourceWallet } from '../types/resources';

describe('applyDelta', () => {
  const base: ResourceWallet = { scrap: 100, energy: 5, cores: 2, keys: 1 };

  it('adds positive deltas', () => {
    const result = applyDelta(base, { scrap: 50, energy: 3 });
    expect(result.scrap).toBe(150);
    expect(result.energy).toBe(8);
    expect(result.cores).toBe(2); // unchanged
  });

  it('subtracts negative deltas', () => {
    const result = applyDelta(base, { scrap: -30 });
    expect(result.scrap).toBe(70);
  });

  it('clamps to 0 (no negative resources)', () => {
    const result = applyDelta(base, { scrap: -999 });
    expect(result.scrap).toBe(0);
  });

  it('respects caps', () => {
    const result = applyDelta(base, { energy: 100 }, { energy: 10 });
    expect(result.energy).toBe(10);
  });

  it('returns new object (immutable)', () => {
    const result = applyDelta(base, { scrap: 1 });
    expect(result).not.toBe(base);
    expect(base.scrap).toBe(100); // original unchanged
  });

  it('empty wallet + delta', () => {
    const result = applyDelta(EMPTY_WALLET, { scrap: 10, keys: 1 });
    expect(result.scrap).toBe(10);
    expect(result.keys).toBe(1);
  });
});

describe('canAfford', () => {
  const wallet: ResourceWallet = { scrap: 100, energy: 3, cores: 1, keys: 0 };

  it('returns true when affordable', () => {
    expect(canAfford(wallet, { scrap: 80, energy: 2 })).toBe(true);
  });

  it('returns false when over budget', () => {
    expect(canAfford(wallet, { scrap: 101 })).toBe(false);
  });

  it('returns false when key not available', () => {
    expect(canAfford(wallet, { keys: 1 })).toBe(false);
  });

  it('exact amount is affordable', () => {
    expect(canAfford(wallet, { scrap: 100 })).toBe(true);
  });

  it('empty cost is always affordable', () => {
    expect(canAfford(EMPTY_WALLET, {})).toBe(true);
  });
});
