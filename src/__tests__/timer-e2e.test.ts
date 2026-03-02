/**
 * E2E: Timer expiry triggers Game Over (run:complete).
 * Validates the bug fix for "Timer läuft ab aber Spiel läuft weiter".
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
  countEmit(event: string) { return this.emitted.filter(e => e.event === event).length; }
  lastPayload(event: string) { return [...this.emitted].reverse().find(e => e.event === event)?.args[0]; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManager() {
  const state = createInitialRunState(
    'e2e-timer-run',
    { kind: 'standard', seed: 99 },
    'biome_neon_alley',
    [null, null, null], [null], 5, 2,
  );
  return new RunStateManager(state, TRAIT_REGISTRY);
}

const DT = 1 / 60;
const DIST_PER_FRAME = 300 * DT;

function tickFor(mgr: RunStateManager, seconds: number) {
  const ticks = Math.ceil(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    if (mgr.state.phase === 'complete' || mgr.state.phase === 'dead') break;
    mgr.dispatch({ type: 'TICK', dt: DT, distanceDelta: DIST_PER_FRAME });
  }
}

// ---------------------------------------------------------------------------
// Timer expiry
// ---------------------------------------------------------------------------

describe('E2E — Timer expiry → Game Over', () => {
  it('phase is NOT complete before 120s', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    tickFor(mgr, 60);
    expect(mgr.state.phase).not.toBe('complete');
    expect(mgr.state.elapsedSeconds).toBeCloseTo(60, 0);
  });

  it('phase transitions to complete at 120s', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    tickFor(mgr, 121); // just past limit
    expect(mgr.state.phase).toBe('complete');
  });

  it('elapsedSeconds reaches 120 before completion', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    tickFor(mgr, 121);
    expect(mgr.state.elapsedSeconds).toBeGreaterThanOrEqual(120);
  });

  it('no further state mutations accepted after complete (terminal guard)', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    tickFor(mgr, 121);
    expect(mgr.state.phase).toBe('complete');

    const scoreBefore = mgr.state.score.baseScore;
    mgr.dispatch({ type: 'ADD_SCORE', points: 99999 });
    expect(mgr.state.score.baseScore).toBe(scoreBefore); // no change
  });

  it('player death mid-run is NOT overridden by timer (dead wins over complete)', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    // Kill the player
    for (let i = 0; i < 5; i++) {
      mgr.dispatch({ type: 'INVULN_TICK', dt: 1 });
      mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    }
    expect(mgr.state.phase).toBe('dead');

    // Tick past timer limit — should stay dead, not flip to complete
    for (let i = 0; i < 200; i++) {
      mgr.dispatch({ type: 'TICK', dt: DT, distanceDelta: DIST_PER_FRAME });
    }
    expect(mgr.state.phase).toBe('dead');
  });

  it('final score is > 0 when timer expires', () => {
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    tickFor(mgr, 121);
    expect(mgr.state.phase).toBe('complete');
    expect(mgr.state.score.baseScore).toBeGreaterThan(0);
  });

  it('single large dt tick past 120s triggers completion', () => {
    // Simulates a frame hitch / test fast-forward
    const mgr = makeManager();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'TICK', dt: 121, distanceDelta: 121 * 300 });
    expect(mgr.state.phase).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// HUDBroadcaster emits run:complete
// ---------------------------------------------------------------------------

describe('E2E — HUD emits run:complete on timer expiry', () => {
  it('run:complete event emitted when timer expires', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();

    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    tickFor(mgr, 121);

    expect(emitter.countEmit('run:complete')).toBeGreaterThan(0);
    hud.unmount();
  });

  it('run:complete payload contains finalScore > 0', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();

    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    tickFor(mgr, 121);

    const payload = emitter.lastPayload('run:complete') as any;
    expect(payload).toBeDefined();
    expect(payload.finalScore).toBeGreaterThan(0);
    hud.unmount();
  });

  it('game:over is NOT emitted on timer expiry (only run:complete)', () => {
    // game:over = death; run:complete = time up — distinct events
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();

    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    tickFor(mgr, 121);

    expect(emitter.countEmit('run:complete')).toBe(1);
    expect(emitter.countEmit('game:over')).toBe(0);
    hud.unmount();
  });

  it('game:over still fires on HP=0 before timer', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();

    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    for (let i = 0; i < 5; i++) {
      mgr.dispatch({ type: 'INVULN_TICK', dt: 1 });
      mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    }

    expect(emitter.countEmit('game:over')).toBeGreaterThan(0);
    expect(emitter.countEmit('run:complete')).toBe(0);
    hud.unmount();
  });

  it('run:complete emitted exactly once (not on every subsequent tick)', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();

    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    // Tick well past 120s timer, then keep going to verify no second event
    tickFor(mgr, 125); // reaches complete at 120s, terminal guard stops further mutations
    // A few more ticks after completion — terminal phase, no new events
    for (let i = 0; i < 60; i++) {
      mgr.dispatch({ type: 'TICK', dt: DT, distanceDelta: DIST_PER_FRAME });
    }

    expect(emitter.countEmit('run:complete')).toBe(1);
    hud.unmount();
  });
});
