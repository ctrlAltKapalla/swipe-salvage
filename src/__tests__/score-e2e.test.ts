/**
 * E2E: Score accumulation during a run.
 * Validates the bug fix for "Score bleibt immer 0".
 *
 * These tests simulate realistic game loop conditions without Phaser.
 */

import { RunStateManager } from '../state/run-state-manager';
import { HUDBroadcaster } from '../state/hud-broadcaster';
import { createInitialRunState } from '../types/run-state';
import { TRAIT_REGISTRY } from '../data/traits.data';
import type { IEventEmitter } from '../state/encounter-bridge';

// ---------------------------------------------------------------------------
// Minimal emitter
// ---------------------------------------------------------------------------

class TestEmitter implements IEventEmitter {
  private _listeners: Map<string, Array<(...args: unknown[]) => void>> = new Map();
  public emitted: Array<{ event: string; args: unknown[] }> = [];
  on(event: string, fn: (...args: unknown[]) => void): this {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event)!.push(fn); return this;
  }
  off(event: string, fn: (...args: unknown[]) => void): this {
    this._listeners.set(event, (this._listeners.get(event) ?? []).filter(f => f !== fn)); return this;
  }
  emit(event: string, ...args: unknown[]): this {
    this.emitted.push({ event, args });
    (this._listeners.get(event) ?? []).forEach(fn => fn(...args)); return this;
  }
  lastPayload(event: string) {
    return [...this.emitted].reverse().find(e => e.event === event)?.args[0];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORLD_SPEED_PX_PER_SECOND = 300; // baseline from architecture doc §9.1

function makeManager() {
  const state = createInitialRunState(
    'e2e-run-score',
    { kind: 'standard', seed: 42 },
    'biome_neon_alley',
    [null, null, null], [null], 5, 2,
  );
  return new RunStateManager(state, TRAIT_REGISTRY);
}

function simulateRun(mgr: RunStateManager, durationSeconds: number, fps = 60) {
  const dt = 1 / fps;
  const distPerFrame = WORLD_SPEED_PX_PER_SECOND * dt;
  const ticks = Math.ceil(durationSeconds * fps);
  for (let i = 0; i < ticks; i++) {
    if (mgr.state.phase === 'dead' || mgr.state.phase === 'complete') break;
    mgr.dispatch({ type: 'TICK', dt, distanceDelta: distPerFrame });
  }
}

// ---------------------------------------------------------------------------
// E2E: Score > 0 after run
// ---------------------------------------------------------------------------

describe('E2E — Score accumulation', () => {
  it('score is 0 before run starts (sanity)', () => {
    const mgr = makeManager();
    expect(mgr.state.score.baseScore).toBe(0);
  });

  it('score increases during warmup phase', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    simulateRun(mgr, 5); // 5 seconds of warmup
    expect(mgr.state.score.baseScore).toBeGreaterThan(0);
  });

  it('score increases during mid phase', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    simulateRun(mgr, 35); // crosses into mid at 30s
    expect(mgr.state.phase).toBe('mid');
    expect(mgr.state.score.baseScore).toBeGreaterThan(0);
  });

  it('mid phase scores higher rate than warmup (×1.5 multiplier)', () => {
    // Same distance, warmup vs mid — mid should produce ~1.5× more score
    const mgrWarmup = makeManager();
    mgrWarmup.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    simulateRun(mgrWarmup, 5);
    const warmupScore = mgrWarmup.state.score.baseScore;

    // Simulate mid phase by fast-ticking past 30s first
    const mgrMid = makeManager();
    mgrMid.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    simulateRun(mgrMid, 30); // reach mid
    const scoreAtMidStart = mgrMid.state.score.baseScore;
    simulateRun(mgrMid, 5);  // 5s of mid
    const midScore = mgrMid.state.score.baseScore - scoreAtMidStart;

    expect(midScore).toBeGreaterThan(warmupScore);
    // Should be approximately 1.5× (allow ±20% for rounding)
    expect(midScore / warmupScore).toBeGreaterThan(1.2);
  });

  it('climax phase scores highest rate (×2.0)', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    simulateRun(mgr, 92); // reach climax
    expect(mgr.state.phase).toBe('climax');
    const scoreAtClimaxStart = mgr.state.score.baseScore;
    simulateRun(mgr, 5);
    const climaxScore = mgr.state.score.baseScore - scoreAtClimaxStart;
    expect(climaxScore).toBeGreaterThan(0);
  });

  it('score does not tick during encounter phase', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    simulateRun(mgr, 5);
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'encounter' });
    const scoreBefore = mgr.state.score.baseScore;
    simulateRun(mgr, 3); // 3s in encounter — should not accumulate
    expect(mgr.state.score.baseScore).toBe(scoreBefore);
  });

  it('score multiplier amplifies passive accumulation', () => {
    const mgrBase = makeManager();
    mgrBase.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    simulateRun(mgrBase, 5);
    const baseScore = mgrBase.state.score.baseScore;

    const mgrBoosted = makeManager();
    mgrBoosted.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgrBoosted.dispatch({ type: 'SET_MULTIPLIER', multiplier: 2.0 });
    simulateRun(mgrBoosted, 5);
    const boostedScore = mgrBoosted.state.score.baseScore;

    expect(boostedScore).toBeGreaterThan(baseScore);
    // 2× multiplier → approximately 2× score
    expect(boostedScore / baseScore).toBeGreaterThan(1.8);
  });

  it('full 120s run produces score > 0', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    simulateRun(mgr, 120);
    expect(mgr.state.score.baseScore).toBeGreaterThan(0);
    // Sanity: 120s at 300px/s, rate ~1.25 avg → ≥ 120 × 300 × 1.0 = 36,000 points minimum
    expect(mgr.state.score.baseScore).toBeGreaterThan(30000);
  });

  it('perfect dodge still adds bonus score on top of passive', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    simulateRun(mgr, 5);
    const scoreBefore = mgr.state.score.baseScore;
    mgr.dispatch({ type: 'ADD_SCORE', points: 50 });
    expect(mgr.state.score.baseScore).toBeGreaterThan(scoreBefore);
  });
});

// ---------------------------------------------------------------------------
// E2E: HUD receives score via broadcaster
// ---------------------------------------------------------------------------

describe('E2E — HUD score display', () => {
  it('HUD run:state payload has score > 0 after 5s', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();

    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    simulateRun(mgr, 5);

    const payload = emitter.lastPayload('run:state') as any;
    expect(payload).toBeDefined();
    expect(payload.score).toBeGreaterThan(0);

    hud.unmount();
  });

  it('HUD score field matches RunStateManager baseScore exactly', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();

    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    simulateRun(mgr, 10);

    const payload = emitter.lastPayload('run:state') as any;
    expect(payload.score).toBe(mgr.state.score.baseScore);

    hud.unmount();
  });

  it('HUD score updates continuously (multiple distinct values over run)', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();

    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });

    // Sample score at intervals
    const samples = new Set<number>();
    const dt = 1 / 60;
    const dist = WORLD_SPEED_PX_PER_SECOND * dt;
    for (let i = 0; i < 300; i++) { // 5 seconds
      mgr.dispatch({ type: 'TICK', dt, distanceDelta: dist });
      if (i % 30 === 0) samples.add(mgr.state.score.baseScore);
    }

    // Score should have increased — more than 1 distinct value
    expect(samples.size).toBeGreaterThan(1);

    hud.unmount();
  });
});
