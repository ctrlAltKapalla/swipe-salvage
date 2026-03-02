import { HazardSpawner, DEFAULT_SPAWNER_CONFIG, SpawnerConfig } from '../systems/hazard-spawner';
import { HAZARD_REGISTRY } from '../data/hazards.data';
import { SeededRNG } from '../rng/seeded-rng';

function makeSpawner(seed = 42, config: SpawnerConfig = DEFAULT_SPAWNER_CONFIG): HazardSpawner {
  return new HazardSpawner(config, HAZARD_REGISTRY, new SeededRNG(seed));
}

describe('HazardSpawner — spawn decisions', () => {
  it('suppresses spawn during encounter', () => {
    const spawner = makeSpawner();
    const result = spawner.decide('warmup', 0, true);
    expect(result.events).toHaveLength(0);
  });

  it('suppresses spawn when at max concurrent limit', () => {
    const spawner = makeSpawner();
    const config = DEFAULT_SPAWNER_CONFIG;
    const max = config.phaseConfigs.find((c) => c.phase === 'warmup')!.maxConcurrentHazards;
    const result = spawner.decide('warmup', max, false);
    expect(result.events).toHaveLength(0);
  });

  it('returns a spawn event in warmup phase', () => {
    // Run multiple attempts — should get at least one spawn (no cooldown conflicts initially)
    const spawner = makeSpawner(1);
    let spawned = false;
    for (let i = 0; i < 20; i++) {
      const r = spawner.decide('warmup', 0, false);
      if (r.events.length > 0) { spawned = true; break; }
      spawner.tick(5); // clear cooldowns
    }
    expect(spawned).toBe(true);
  });

  it('always has a valid nextSpawnInSeconds', () => {
    const spawner = makeSpawner(7);
    for (let i = 0; i < 30; i++) {
      const r = spawner.decide('mid', 0, false);
      expect(r.nextSpawnInSeconds).toBeGreaterThan(0);
      spawner.tick(r.nextSpawnInSeconds + 0.1);
    }
  });

  it('respects hazard cooldown — same hazard not spawned immediately', () => {
    const spawner = makeSpawner(5);
    // Force a spawn
    let firstDefId: string | undefined;
    for (let i = 0; i < 50; i++) {
      const r = spawner.decide('warmup', 0, false);
      if (r.events.length > 0) {
        firstDefId = r.events[0].defId;
        break;
      }
      spawner.tick(0.1);
    }
    expect(firstDefId).toBeDefined();

    // Immediately after — same hazard should be on cooldown
    const retry = spawner.decide('warmup', 0, false);
    if (retry.events.length > 0) {
      expect(retry.events[0].defId).not.toBe(firstDefId);
    }
  });

  it('spawned event has valid defId in registry', () => {
    const spawner = makeSpawner(99);
    for (let i = 0; i < 30; i++) {
      const r = spawner.decide('mid', 0, false);
      for (const ev of r.events) {
        expect(HAZARD_REGISTRY.has(ev.defId)).toBe(true);
      }
      spawner.tick(2);
    }
  });

  it('spawned intensity level is 1, 2, or 3', () => {
    const spawner = makeSpawner(200);
    for (let i = 0; i < 30; i++) {
      const r = spawner.decide('climax', 0, false);
      for (const ev of r.events) {
        expect([1, 2, 3]).toContain(ev.intensityLevel);
      }
      spawner.tick(2);
    }
  });

  it('climax phase uses climax config', () => {
    const spawner = makeSpawner(33);
    // Climax config should use higher intensity — just verify it spawns from climax table
    // (table has laser_sweep + mine_strip which don't appear in warmup)
    const ids = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const r = spawner.decide('climax', 0, false);
      r.events.forEach((e) => ids.add(e.defId));
      spawner.tick(2);
    }
    // Climax table includes hazards not in warmup table
    const climaxOnlyHazards = ['haz_crusher', 'haz_laser_sweep'];
    const hasClimaxHazards = climaxOnlyHazards.some((id) => ids.has(id));
    expect(hasClimaxHazards).toBe(true);
  });
});

describe('HazardSpawner — safe lane guarantee', () => {
  it('all spawned events leave at least 1 safe lane', () => {
    const spawner = makeSpawner(777);
    const laneCount = DEFAULT_SPAWNER_CONFIG.laneCount;

    for (let i = 0; i < 100; i++) {
      for (const phase of ['warmup', 'mid', 'climax'] as const) {
        const r = spawner.decide(phase, 0, false);
        for (const ev of r.events) {
          const safeLanes = laneCount - ev.lanes.length;
          expect(safeLanes).toBeGreaterThanOrEqual(1);
        }
        spawner.tick(2);
      }
    }
  });

  it('lane indices are within bounds [0, laneCount)', () => {
    const spawner = makeSpawner(888);
    const laneCount = DEFAULT_SPAWNER_CONFIG.laneCount;

    for (let i = 0; i < 50; i++) {
      const r = spawner.decide('mid', 0, false);
      for (const ev of r.events) {
        for (const lane of ev.lanes) {
          expect(lane).toBeGreaterThanOrEqual(0);
          expect(lane).toBeLessThan(laneCount);
        }
      }
      spawner.tick(2);
    }
  });
});

describe('HazardSpawner — determinism', () => {
  it('produces identical spawn sequence from same seed', () => {
    const decisions1: string[] = [];
    const decisions2: string[] = [];

    const s1 = makeSpawner(12345);
    const s2 = makeSpawner(12345);

    for (let i = 0; i < 30; i++) {
      const r1 = s1.decide('mid', 0, false);
      const r2 = s2.decide('mid', 0, false);
      decisions1.push(JSON.stringify(r1.events));
      decisions2.push(JSON.stringify(r2.events));
      s1.tick(2); s2.tick(2);
    }
    expect(decisions1).toEqual(decisions2);
  });
});
