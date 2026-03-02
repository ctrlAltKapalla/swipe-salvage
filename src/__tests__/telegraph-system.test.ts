import { TelegraphSystem, telegraphProgress } from '../systems/telegraph-system';
import { HAZARD_REGISTRY } from '../data/hazards.data';
import type { HazardInstance } from '../types/hazards';

function makeInstance(defId: string, lanes: number[]): HazardInstance {
  const def = HAZARD_REGISTRY.get(defId)!;
  return {
    id: `inst-${defId}`,
    defId,
    kind: def.kind,
    state: 'telegraphing',
    occupiedLanes: lanes,
    worldY: 300,
    telegraphRemaining: def.telegraph.durationSeconds,
    activeRemaining: 0,
    intensity: def.intensityLevels[0],
    hitRegistered: false,
  };
}

describe('TelegraphSystem', () => {
  it('fires telegraph_start on spawn', () => {
    const sys = new TelegraphSystem(HAZARD_REGISTRY);
    const events: string[] = [];
    sys.onEvent((e) => events.push(e.kind));
    const inst = makeInstance('haz_barrier', [2]);
    sys.onHazardSpawned(inst);
    expect(events).toContain('telegraph_start');
  });

  it('fires telegraph_snap at correct progress point', () => {
    const sys = new TelegraphSystem(HAZARD_REGISTRY);
    const events: string[] = [];
    sys.onEvent((e) => events.push(e.kind));

    const def = HAZARD_REGISTRY.get('haz_barrier')!;
    const inst = makeInstance('haz_barrier', [2]);
    sys.onHazardSpawned(inst);

    // Advance just past snap threshold (snapAt=0.75 of 1.2s = 0.9s elapsed)
    const snapTime = def.telegraph.durationSeconds * def.telegraph.snapAt;
    sys.update([inst], snapTime + 0.01);

    expect(events).toContain('telegraph_snap');
  });

  it('fires hazard_activate when telegraph expires', () => {
    const sys = new TelegraphSystem(HAZARD_REGISTRY);
    const events: string[] = [];
    sys.onEvent((e) => events.push(e.kind));

    const def = HAZARD_REGISTRY.get('haz_barrier')!;
    const inst = makeInstance('haz_barrier', [2]);
    sys.onHazardSpawned(inst);

    // Advance past full telegraph duration
    sys.update([inst], def.telegraph.durationSeconds + 0.1);

    expect(events).toContain('hazard_activate');
    expect(inst.state).toBe('active');
  });

  it('fires hazard_expire for timed hazards after active duration', () => {
    const sys = new TelegraphSystem(HAZARD_REGISTRY);
    const events: string[] = [];
    sys.onEvent((e) => events.push(e.kind));

    // Crusher has activeDurationSeconds > 0
    const def = HAZARD_REGISTRY.get('haz_crusher')!;
    const inst = makeInstance('haz_crusher', [2]);
    sys.onHazardSpawned(inst);

    // Skip through telegraph
    sys.update([inst], def.telegraph.durationSeconds + 0.1);
    expect(inst.state).toBe('active');

    // Skip through active duration
    sys.update([inst], def.activeDurationSeconds + 0.1);
    expect(inst.state).toBe('expired');
    expect(events).toContain('hazard_expire');
  });

  it('does not fire snap twice for same instance', () => {
    const sys = new TelegraphSystem(HAZARD_REGISTRY);
    const snaps: string[] = [];
    sys.onEvent((e) => { if (e.kind === 'telegraph_snap') snaps.push(e.instanceId); });

    const def = HAZARD_REGISTRY.get('haz_crusher')!;
    const inst = makeInstance('haz_crusher', [1]);
    sys.onHazardSpawned(inst);

    // Advance past snap, then again
    const snapTime = def.telegraph.durationSeconds * def.telegraph.snapAt;
    sys.update([inst], snapTime + 0.01);
    sys.update([inst], 0.1);
    sys.update([inst], 0.1);

    expect(snaps.filter((id) => id === inst.id)).toHaveLength(1);
  });

  it('unsubscribe stops receiving events', () => {
    const sys = new TelegraphSystem(HAZARD_REGISTRY);
    const events: string[] = [];
    const unsub = sys.onEvent((e) => events.push(e.kind));
    unsub();
    const inst = makeInstance('haz_barrier', [0]);
    sys.onHazardSpawned(inst);
    expect(events).toHaveLength(0);
  });
});

describe('telegraphProgress', () => {
  it('returns 0 for expired instance', () => {
    const def = HAZARD_REGISTRY.get('haz_barrier')!;
    const inst = makeInstance('haz_barrier', [1]);
    inst.state = 'expired';
    expect(telegraphProgress(inst, def)).toBe(0);
  });

  it('returns 1 for active instance', () => {
    const def = HAZARD_REGISTRY.get('haz_barrier')!;
    const inst = makeInstance('haz_barrier', [1]);
    inst.state = 'active';
    expect(telegraphProgress(inst, def)).toBe(1);
  });

  it('returns partial progress during telegraph', () => {
    const def = HAZARD_REGISTRY.get('haz_barrier')!;
    const inst = makeInstance('haz_barrier', [1]);
    // Half the telegraph time remaining
    inst.telegraphRemaining = def.telegraph.durationSeconds / 2;
    const progress = telegraphProgress(inst, def);
    expect(progress).toBeCloseTo(0.5, 5);
  });
});
