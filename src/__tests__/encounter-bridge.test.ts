import { EncounterBridge, IEventEmitter } from '../state/encounter-bridge';
import { RunStateManager } from '../state/run-state-manager';
import { createInitialRunState } from '../types/run-state';
import { TRAIT_REGISTRY } from '../data/traits.data';
import type { RiskGateOption, ShopItem } from '../types/encounters';

// ---------------------------------------------------------------------------
// Minimal in-memory EventEmitter for tests
// ---------------------------------------------------------------------------

class TestEmitter implements IEventEmitter {
  private _listeners: Map<string, Array<(...args: unknown[]) => void>> = new Map();
  public emitted: Array<{ event: string; args: unknown[] }> = [];

  on(event: string, fn: (...args: unknown[]) => void): this {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event)!.push(fn);
    return this;
  }

  off(event: string, fn: (...args: unknown[]) => void): this {
    const list = this._listeners.get(event) ?? [];
    this._listeners.set(event, list.filter((f) => f !== fn));
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    this.emitted.push({ event, args });
    for (const fn of this._listeners.get(event) ?? []) {
      fn(...args);
    }
    return this;
  }

  lastEmit(event: string) {
    return [...this.emitted].reverse().find((e) => e.event === event);
  }

  countEmit(event: string) {
    return this.emitted.filter((e) => e.event === event).length;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManager(phase: 'warmup' | 'mid' | 'climax' = 'warmup') {
  const state = createInitialRunState(
    'test-run',
    { kind: 'standard', seed: 42 },
    'biome_neon_alley',
    [null, null, null],
    [null],
    5, 2,
  );
  const mgr = new RunStateManager(state, TRAIT_REGISTRY);
  // Route through valid transitions
  mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
  if (phase === 'mid' || phase === 'climax') mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'mid' });
  if (phase === 'climax') mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'climax' });
  mgr.dispatch({ type: 'ADD_RESOURCE', delta: { energy: 10, scrap: 50 } });
  return mgr;
}

const GOOD_RISK_OPTION: RiskGateOption = {
  id: 'opt_loot_hazard',
  label: '+Loot / +Hazards',
  reward: { description: '+20 scrap', delta: { scrap: 20 }, scoreMultiplierBonus: 10 },
  hazard: { description: '+Hazard rate', hazardRateMultiplier: 1.2 },
};

const PAINFUL_RISK_OPTION: RiskGateOption = {
  id: 'opt_hp_damage',
  label: '+Score / -1 HP',
  reward: { description: '+100 score bonus', scoreMultiplierBonus: 30 },
  hazard: { description: '-1 HP', hpDamage: 1 },
};

const SHOP_ITEM_HEAL: ShopItem = {
  id: 'shop_heal_1',
  label: 'Repair Kit',
  cost: { energy: 2 },
  kind: 'heal',
  value: 1,
};

const SHOP_ITEM_TRAIT: ShopItem = {
  id: 'shop_trait_momentum',
  label: 'Momentum Chip',
  cost: { energy: 3 },
  kind: 'trait',
  refId: 'trait_momentum',
};

// ---------------------------------------------------------------------------
// Risk Gate
// ---------------------------------------------------------------------------

describe('EncounterBridge — Risk Gate', () => {
  it('applies reward delta to wallet', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const bridge = new EncounterBridge(mgr, emitter);
    const scrapBefore = mgr.state.wallet.scrap;

    bridge.dispatchRiskGateChoice('enc-1', GOOD_RISK_OPTION, 15);

    expect(mgr.state.wallet.scrap).toBe(scrapBefore + 20);
  });

  it('applies score multiplier bonus', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const bridge = new EncounterBridge(mgr, emitter);
    const multBefore = mgr.state.score.multiplier;

    bridge.dispatchRiskGateChoice('enc-1', GOOD_RISK_OPTION, 15);

    expect(mgr.state.score.multiplier).toBeCloseTo(multBefore + 0.1, 5);
  });

  it('applies hp damage trade-off', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const bridge = new EncounterBridge(mgr, emitter);
    const hpBefore = mgr.state.vitals.hp;

    bridge.dispatchRiskGateChoice('enc-1', PAINFUL_RISK_OPTION, 20);

    expect(mgr.state.vitals.hp).toBe(hpBefore - 1);
  });

  it('records encounter in history', () => {
    const mgr = makeManager();
    const bridge = new EncounterBridge(mgr, new TestEmitter());

    bridge.dispatchRiskGateChoice('enc-42', GOOD_RISK_OPTION, 30);

    const record = mgr.state.encounterHistory.find((r) => r.encounterId === 'enc-42');
    expect(record).toBeDefined();
    expect(record?.kind).toBe('risk_gate');
    expect(record?.choiceId).toBe(GOOD_RISK_OPTION.id);
  });

  it('emits encounter:closed after risk gate choice', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const bridge = new EncounterBridge(mgr, emitter);

    bridge.dispatchRiskGateChoice('enc-1', GOOD_RISK_OPTION, 10);

    expect(emitter.countEmit('encounter:closed')).toBe(1);
  });

  it('emits run:state after risk gate choice', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const bridge = new EncounterBridge(mgr, emitter);

    bridge.dispatchRiskGateChoice('enc-1', GOOD_RISK_OPTION, 10);

    expect(emitter.countEmit('run:state')).toBeGreaterThan(0);
  });

  it('returns from encounter phase after choice', () => {
    const mgr = makeManager('mid');
    // Manually enter encounter phase
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'encounter' });
    expect(mgr.state.phase).toBe('encounter');

    const bridge = new EncounterBridge(mgr, new TestEmitter());
    bridge.dispatchRiskGateChoice('enc-1', GOOD_RISK_OPTION, 40);

    expect(mgr.state.phase).toBe('mid');
  });

  it('triggers game:over if risk gate hp damage kills player', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const bridge = new EncounterBridge(mgr, emitter);

    // Drain HP to 1
    mgr.dispatch({ type: 'INVULN_TICK', dt: 1 });
    mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    mgr.dispatch({ type: 'INVULN_TICK', dt: 1 });
    mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    // HP now 1

    bridge.dispatchRiskGateChoice('enc-lethal', PAINFUL_RISK_OPTION, 25);

    expect(mgr.state.vitals.hp).toBe(0);
    expect(mgr.state.phase).toBe('dead');
    expect(emitter.countEmit('game:over')).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Shop Purchase
// ---------------------------------------------------------------------------

describe('EncounterBridge — Shop Purchase', () => {
  it('deducts cost from wallet', () => {
    const mgr = makeManager();
    const bridge = new EncounterBridge(mgr, new TestEmitter());
    const energyBefore = mgr.state.wallet.energy;

    bridge.dispatchShopPurchase('enc-shop', SHOP_ITEM_HEAL, 30);

    expect(mgr.state.wallet.energy).toBe(energyBefore - SHOP_ITEM_HEAL.cost.energy!);
  });

  it('applies heal effect', () => {
    const mgr = makeManager();
    // Damage player first
    mgr.dispatch({ type: 'INVULN_TICK', dt: 1 });
    mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    const hpAfterDamage = mgr.state.vitals.hp;

    const bridge = new EncounterBridge(mgr, new TestEmitter());
    bridge.dispatchShopPurchase('enc-shop', SHOP_ITEM_HEAL, 30);

    expect(mgr.state.vitals.hp).toBe(Math.min(hpAfterDamage + 1, mgr.state.vitals.maxHp));
  });

  it('adds trait from shop', () => {
    const mgr = makeManager();
    const bridge = new EncounterBridge(mgr, new TestEmitter());
    const traitsBefore = mgr.state.traits.length;

    bridge.dispatchShopPurchase('enc-shop', SHOP_ITEM_TRAIT, 30);

    expect(mgr.state.traits.length).toBe(traitsBefore + 1);
    expect(mgr.state.traits[0].defId).toBe('trait_momentum');
  });

  it('rejects purchase if cannot afford', () => {
    const mgr = makeManager();
    // Drain all energy
    mgr.dispatch({ type: 'SPEND_RESOURCE', delta: { energy: 10 } });
    const bridge = new EncounterBridge(mgr, new TestEmitter());
    const hpBefore = mgr.state.vitals.hp;

    bridge.dispatchShopPurchase('enc-shop', SHOP_ITEM_HEAL, 30);

    expect(mgr.state.vitals.hp).toBe(hpBefore); // no heal
    expect(mgr.state.wallet.energy).toBe(0);    // no spend
  });

  it('does not emit encounter:closed on purchase (player may buy more)', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const bridge = new EncounterBridge(mgr, emitter);

    bridge.dispatchShopPurchase('enc-shop', SHOP_ITEM_HEAL, 30);

    expect(emitter.countEmit('encounter:closed')).toBe(0);
  });

  it('emits encounter:closed on dispatchShopClose', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const bridge = new EncounterBridge(mgr, emitter);

    bridge.dispatchShopClose('enc-shop', 30);

    expect(emitter.countEmit('encounter:closed')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Event routing via encounter:result events
// ---------------------------------------------------------------------------

describe('EncounterBridge — event routing', () => {
  it('routes encounter:result risk_gate to risk gate handler', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const bridge = new EncounterBridge(mgr, emitter);
    bridge.mount();

    const scrapBefore = mgr.state.wallet.scrap;
    emitter.emit('encounter:result', {
      type: 'risk_gate',
      encounterId: 'enc-evt',
      choice: GOOD_RISK_OPTION,
    });

    expect(mgr.state.wallet.scrap).toBe(scrapBefore + 20);
    expect(emitter.countEmit('encounter:closed')).toBe(1);
  });

  it('routes encounter:result shop to shop handler with known item', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const bridge = new EncounterBridge(mgr, emitter);
    bridge.setActiveEncounter({
      encounter: { kind: 'shop_drone', items: [SHOP_ITEM_HEAL] },
      shopItems: new Map([['shop_heal_1', SHOP_ITEM_HEAL]]),
    });
    bridge.mount();

    const energyBefore = mgr.state.wallet.energy;
    emitter.emit('encounter:result', {
      type: 'shop',
      encounterId: 'enc-shop-evt',
      choice: { itemId: 'shop_heal_1' },
    });

    expect(mgr.state.wallet.energy).toBe(energyBefore - 2);
  });

  it('emits encounter:closed for unknown shop item (graceful)', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const bridge = new EncounterBridge(mgr, emitter);
    bridge.mount();

    emitter.emit('encounter:result', {
      type: 'shop',
      encounterId: 'enc-bad',
      choice: { itemId: 'nonexistent_item' },
    });

    expect(emitter.countEmit('encounter:closed')).toBe(1);
  });

  it('stops routing after unmount', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const bridge = new EncounterBridge(mgr, emitter);
    bridge.mount();
    bridge.unmount();

    const scrapBefore = mgr.state.wallet.scrap;
    emitter.emit('encounter:result', {
      type: 'risk_gate',
      encounterId: 'enc-after-unmount',
      choice: GOOD_RISK_OPTION,
    });

    expect(mgr.state.wallet.scrap).toBe(scrapBefore); // no change
  });
});
