import { HUDBroadcaster } from '../state/hud-broadcaster';
import { RunStateManager } from '../state/run-state-manager';
import { createInitialRunState } from '../types/run-state';
import { TRAIT_REGISTRY } from '../data/traits.data';
import type { IEventEmitter } from '../state/encounter-bridge';

// ---------------------------------------------------------------------------
// TestEmitter (same as encounter-bridge tests)
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
    for (const fn of this._listeners.get(event) ?? []) fn(...args);
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

function makeManager() {
  const state = createInitialRunState(
    'test-hud-run',
    { kind: 'standard', seed: 1 },
    'biome_neon_alley',
    [null, null, null], [null], 5, 2,
  );
  return new RunStateManager(state, TRAIT_REGISTRY);
}

// ---------------------------------------------------------------------------
// HUDBroadcaster tests
// ---------------------------------------------------------------------------

describe('HUDBroadcaster', () => {
  it('emits run:state immediately on mount', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);

    hud.mount();
    expect(emitter.countEmit('run:state')).toBe(1);
    hud.unmount();
  });

  it('emits run:state on every dispatch', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();

    const before = emitter.countEmit('run:state');
    mgr.dispatch({ type: 'ADD_SCORE', points: 100 });
    mgr.dispatch({ type: 'ADD_SCORE', points: 100 });
    expect(emitter.countEmit('run:state')).toBe(before + 2);
    hud.unmount();
  });

  it('emits run:phase_change on phase transition', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();

    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    const phaseEvent = emitter.lastEmit('run:phase_change');
    expect(phaseEvent).toBeDefined();
    expect((phaseEvent!.args[0] as any).to).toBe('warmup');
    hud.unmount();
  });

  it('phase label: emits phase_change at warmup (from loading)', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();

    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    const ev = emitter.lastEmit('run:phase_change');
    expect((ev!.args[0] as any).from).toBe('loading');
    expect((ev!.args[0] as any).to).toBe('warmup');
    hud.unmount();
  });

  it('phase label: mid at 30s (via TICK auto-advance)', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    emitter.emitted = []; // reset

    mgr.dispatch({ type: 'TICK', dt: 30.1, distanceDelta: 100 });
    const ev = emitter.lastEmit('run:phase_change');
    expect(ev).toBeDefined();
    expect((ev!.args[0] as any).to).toBe('mid');
    hud.unmount();
  });

  it('phase label: climax at 90s', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });

    mgr.dispatch({ type: 'TICK', dt: 90.1, distanceDelta: 300 });
    const ev = emitter.lastEmit('run:phase_change');
    expect((ev!.args[0] as any).to).toBe('climax');
    hud.unmount();
  });

  it('emits run:hp_change when HP changes', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });

    mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    const hpEvent = emitter.lastEmit('run:hp_change');
    expect(hpEvent).toBeDefined();
    expect((hpEvent!.args[0] as any).hp).toBe(2);
    expect((hpEvent!.args[0] as any).maxHp).toBe(3);
    hud.unmount();
  });

  it('HP change reflected in same dispatch cycle (same-frame)', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });

    // Take damage — HUD must have updated in same dispatch
    mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });

    const lastState = emitter.lastEmit('run:state');
    expect((lastState!.args[0] as any).hp).toBe(2);
    hud.unmount();
  });

  it('emits game:over on HP=0', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });

    // Kill player
    for (let i = 0; i < 5; i++) {
      mgr.dispatch({ type: 'INVULN_TICK', dt: 1 });
      mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    }

    expect(mgr.state.phase).toBe('dead');
    expect(emitter.countEmit('game:over')).toBeGreaterThan(0);
    hud.unmount();
  });

  it('game:over payload contains finalScore', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'ADD_SCORE', points: 500 });

    for (let i = 0; i < 5; i++) {
      mgr.dispatch({ type: 'INVULN_TICK', dt: 1 });
      mgr.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    }

    const ev = emitter.lastEmit('game:over');
    expect((ev!.args[0] as any).finalScore).toBe(500);
    hud.unmount();
  });

  it('emits run:complete on TRIGGER_RUN_COMPLETE', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'mid' });
    mgr.dispatch({ type: 'PHASE_TRANSITION', to: 'climax' });
    mgr.dispatch({ type: 'TRIGGER_RUN_COMPLETE' });

    expect(emitter.countEmit('run:complete')).toBe(1);
    hud.unmount();
  });

  it('does not emit after unmount', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();
    hud.unmount();
    const countBefore = emitter.emitted.length;

    mgr.dispatch({ type: 'ADD_SCORE', points: 100 });
    expect(emitter.emitted.length).toBe(countBefore);
  });

  it('run:state payload has correct structure', () => {
    const mgr = makeManager();
    const emitter = new TestEmitter();
    const hud = new HUDBroadcaster(mgr, emitter);
    hud.mount();
    mgr.dispatch({ type: 'ADD_RESOURCE', delta: { scrap: 30 } });

    const last = emitter.lastEmit('run:state')!.args[0] as any;
    expect(last).toHaveProperty('phase');
    expect(last).toHaveProperty('hp');
    expect(last).toHaveProperty('maxHp');
    expect(last).toHaveProperty('shields');
    expect(last).toHaveProperty('score');
    expect(last).toHaveProperty('multiplier');
    expect(last).toHaveProperty('wallet');
    expect(last).toHaveProperty('heat');
    expect(last.wallet.scrap).toBe(30);
    hud.unmount();
  });
});
