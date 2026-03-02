import { RunStateManager } from '../state/run-state-manager';
import { createInitialRunState } from '../types/run-state';
import { TRAIT_REGISTRY } from '../data/traits.data';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManager(seed = 12345) {
  const state = createInitialRunState(
    'test-run-id',
    { kind: 'standard', seed },
    'biome_neon_alley',
    [null, null, null],
    [null],
    5,
    2,
  );
  return new RunStateManager(state, TRAIT_REGISTRY);
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

describe('Phase transitions', () => {
  it('starts in loading phase', () => {
    const mgr = makeManager();
    expect(mgr.state.phase).toBe('loading');
  });

  it('transitions loading → warmup', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    expect(mgr.state.phase).toBe('warmup');
  });

  it('does not allow invalid transition loading → climax', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'climax' });
    expect(mgr.state.phase).toBe('loading'); // unchanged
  });

  it('auto-advances warmup → mid at 30s via TICK', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'TICK', dt: 30.1, distanceDelta: 100 });
    expect(mgr.state.phase).toBe('mid');
  });

  it('auto-advances mid → climax at 90s via TICK', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'TICK', dt: 90.1, distanceDelta: 300 });
    expect(mgr.state.phase).toBe('climax');
  });

  it('encounter saves prior phase and can return', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'encounter' });
    expect(mgr.state.phase).toBe('encounter');
    expect(mgr.state.priorPhase).toBe('warmup');
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    expect(mgr.state.phase).toBe('warmup');
  });

  it('no mutations after terminal phase (dead)', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'dead' });
    const scoreBefore = mgr.state.score.baseScore;
    mgr.dispatch({ type: 'ADD_SCORE', points: 9999 });
    expect(mgr.state.score.baseScore).toBe(scoreBefore);
  });
});

// ---------------------------------------------------------------------------
// Damage & vitals
// ---------------------------------------------------------------------------

describe('Damage & vitals', () => {
  it('takes damage from full HP', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    expect(mgr.state.vitals.hp).toBe(2);
  });

  it('shields absorb damage first', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'ADD_SHIELD', amount: 2 });
    mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    expect(mgr.state.vitals.shields).toBe(1);
    expect(mgr.state.vitals.hp).toBe(3); // no HP lost
  });

  it('invulnerability window prevents damage', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false }); // triggers invuln
    const hpAfterFirst = mgr.state.vitals.hp;
    mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false }); // should be ignored
    expect(mgr.state.vitals.hp).toBe(hpAfterFirst);
  });

  it('death transitions to dead phase', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    // Drain all HP through invuln windows
    for (let i = 0; i < 10; i++) {
      mgr.dispatch({ type: 'INVULN_TICK', dt: 1 });
      mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    }
    expect(mgr.state.phase).toBe('dead');
    expect(mgr.state.vitals.hp).toBe(0);
  });

  it('heal restores HP up to maxHp', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'INVULN_TICK', dt: 1 });
    mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    mgr.dispatch({ type: 'HEAL', amount: 5 }); // try to over-heal
    expect(mgr.state.vitals.hp).toBe(mgr.state.vitals.maxHp);
  });

  it('overheat damages player and resets heat', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'APPLY_HEAT', delta: 1.0 }); // exactly threshold
    expect(mgr.state.vitals.heat).toBe(0); // reset after overheat
    expect(mgr.state.vitals.hp).toBe(2); // took 1 damage
  });

  it('damage breaks combo', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'RECORD_PERFECT_DODGE' });
    mgr.dispatch({ type: 'RECORD_PERFECT_DODGE' });
    expect(mgr.state.score.currentCombo).toBe(2);
    mgr.dispatch({ type: 'INVULN_TICK', dt: 1 });
    mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    expect(mgr.state.score.currentCombo).toBe(0);
    expect(mgr.state.score.bestCombo).toBe(2); // best preserved
  });
});

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

describe('Resources', () => {
  it('adds resources', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'ADD_RESOURCE', delta: { scrap: 50 } });
    expect(mgr.state.wallet.scrap).toBe(50);
  });

  it('spends resources', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'ADD_RESOURCE', delta: { energy: 5 } });
    mgr.dispatch({ type: 'SPEND_RESOURCE', delta: { energy: 3 } });
    expect(mgr.state.wallet.energy).toBe(2);
  });

  it('spend is no-op when cannot afford', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'SPEND_RESOURCE', delta: { cores: 1 } });
    expect(mgr.state.wallet.cores).toBe(0); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

describe('Score', () => {
  it('score applies multiplier', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'SET_MULTIPLIER', multiplier: 2.0 });
    mgr.dispatch({ type: 'ADD_SCORE', points: 100 });
    expect(mgr.state.score.baseScore).toBe(200);
  });

  it('perfect dodge increments counter and combo', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'RECORD_PERFECT_DODGE' });
    mgr.dispatch({ type: 'RECORD_PERFECT_DODGE' });
    expect(mgr.state.score.perfectDodges).toBe(2);
    expect(mgr.state.score.currentCombo).toBe(2);
    expect(mgr.state.score.bestCombo).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Traits
// ---------------------------------------------------------------------------

describe('Traits', () => {
  it('adds a new trait', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'ADD_TRAIT', defId: 'trait_momentum' });
    expect(mgr.state.traits).toHaveLength(1);
    expect(mgr.state.traits[0].defId).toBe('trait_momentum');
    expect(mgr.state.traits[0].stacks).toBe(1);
  });

  it('stacks existing trait', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'ADD_TRAIT', defId: 'trait_momentum' });
    mgr.dispatch({ type: 'ADD_TRAIT', defId: 'trait_momentum' });
    expect(mgr.state.traits[0].stacks).toBe(2);
  });

  it('does not exceed max stacks', () => {
    const mgr = makeManager();
    for (let i = 0; i < 10; i++) {
      mgr.dispatch({ type: 'ADD_TRAIT', defId: 'trait_reflective_shield' });
    }
    // max stacks for reflective_shield is 1
    expect(mgr.state.traits[0].stacks).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Lane changes
// ---------------------------------------------------------------------------

describe('Lane changes', () => {
  it('changes target lane', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'LANE_CHANGE', targetLane: 4 });
    expect(mgr.state.targetLane).toBe(4);
  });

  it('clamps to valid lane range', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'LANE_CHANGE', targetLane: 99 });
    expect(mgr.state.targetLane).toBe(4); // LANE_COUNT - 1
    mgr.dispatch({ type: 'LANE_CHANGE', targetLane: -5 });
    expect(mgr.state.targetLane).toBe(0);
  });

  it('syncs current lane', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'LANE_CHANGE', targetLane: 3 });
    mgr.dispatch({ type: 'LANE_SYNC', lane: 3 });
    expect(mgr.state.currentLane).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Determinism — same seed + actions = same state
// ---------------------------------------------------------------------------

describe('Determinism', () => {
  it('produces identical state from same seed and action sequence', () => {
    const SEED = 99999;
    const actions = [
      { type: 'PHASE_TRANSITION' as const, to: 'warmup' as const },
      { type: 'TICK' as const, dt: 0.016, distanceDelta: 5 },
      { type: 'ADD_RESOURCE' as const, delta: { scrap: 20 } },
      { type: 'RECORD_PERFECT_DODGE' as const },
      { type: 'ADD_SCORE' as const, points: 100 },
      { type: 'ADD_TRAIT' as const, defId: 'trait_momentum' },
    ];

    const mgr1 = makeManager(SEED);
    const mgr2 = makeManager(SEED);

    for (const action of actions) {
      mgr1.dispatch(action);
      mgr2.dispatch(action);
    }

    expect(mgr1.stateChecksum()).toBe(mgr2.stateChecksum());
  });

  it('different seeds produce different checksums', () => {
    const mgr1 = makeManager(111);
    const mgr2 = makeManager(222);
    mgr1.dispatch({ type: 'ADD_SCORE', points: 0 }); // force state diff via runId... actually runId differs
    expect(mgr1.stateChecksum()).not.toBe(mgr2.stateChecksum());
  });
});

// ---------------------------------------------------------------------------
// 120s simulated run — state stability
// ---------------------------------------------------------------------------

describe('120s simulated run', () => {
  it('survives a full 120s run without state corruption', () => {
    const mgr = makeManager(42);
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });

    const FPS = 60;
    const DT = 1 / FPS;
    const TOTAL_TICKS = 120 * FPS;

    for (let tick = 0; tick < TOTAL_TICKS; tick++) {
      if (mgr.state.phase === 'dead' || mgr.state.phase === 'complete') break;

      mgr.dispatch({ type: 'TICK', dt: DT, distanceDelta: 4 });
      mgr.dispatch({ type: 'MODULE_COOLDOWN_TICK', dt: DT });
      mgr.dispatch({ type: 'INVULN_TICK', dt: DT });

      // Simulate score accumulation
      if (tick % 30 === 0) {
        mgr.dispatch({ type: 'ADD_SCORE', points: 10 });
        mgr.dispatch({ type: 'ADD_RESOURCE', delta: { scrap: 5 } });
      }
    }

    const s = mgr.state;

    // State sanity checks
    expect(s.vitals.hp).toBeGreaterThanOrEqual(0);
    expect(s.vitals.hp).toBeLessThanOrEqual(s.vitals.maxHp);
    expect(s.vitals.heat).toBeGreaterThanOrEqual(0);
    expect(s.vitals.heat).toBeLessThanOrEqual(1);
    expect(s.wallet.scrap).toBeGreaterThanOrEqual(0);
    expect(s.score.baseScore).toBeGreaterThanOrEqual(0);
    expect(s.score.multiplier).toBeGreaterThan(0);
    expect(s.elapsedSeconds).toBeCloseTo(120, 0);
    expect(s.distance).toBeGreaterThan(0);

    // Phase should be climax at 120s (unless dead)
    expect(['climax', 'dead', 'complete']).toContain(s.phase);
  });
});

// ---------------------------------------------------------------------------
// Listener
// ---------------------------------------------------------------------------

describe('StateListener', () => {
  it('notifies listener on dispatch', () => {
    const mgr = makeManager();
    const calls: string[] = [];
    const unsub = mgr.subscribe((_, action) => calls.push(action.type));
    mgr.dispatch({ type: 'ADD_SCORE', points: 10 });
    mgr.dispatch({ type: 'ADD_SCORE', points: 10 });
    expect(calls).toEqual(['ADD_SCORE', 'ADD_SCORE']);
    unsub();
    mgr.dispatch({ type: 'ADD_SCORE', points: 10 });
    expect(calls).toHaveLength(2); // no more calls after unsubscribe
  });
});
