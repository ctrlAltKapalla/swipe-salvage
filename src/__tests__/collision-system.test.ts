import {
  CollisionSystem,
  PlayerRect,
  HazardRect,
  yOverlap,
  laneOverlap,
  buildLaneGeometry,
} from '../systems/collision-system';
import { HAZARD_REGISTRY } from '../data/hazards.data';
import type { HazardInstance } from '../types/hazards';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayer(overrides: Partial<PlayerRect> = {}): PlayerRect {
  return {
    lane: 2,
    targetLane: 2,
    worldY: 400,
    halfHeight: 30,
    invulnRemaining: 0,
    ...overrides,
  };
}

function makeInstance(
  defId: string,
  lanes: number[],
  state: 'telegraphing' | 'active' | 'expired' = 'active',
): HazardInstance {
  const def = HAZARD_REGISTRY.get(defId)!;
  return {
    id: `inst-${Math.random()}`,
    defId,
    kind: def.kind,
    state,
    occupiedLanes: lanes,
    worldY: 400,
    telegraphRemaining: 0,
    activeRemaining: 0,
    intensity: def.intensityLevels[0],
    hitRegistered: false,
  };
}

function makeHazardRect(inst: HazardInstance, worldY = 400, damage = 1): HazardRect {
  return {
    instanceId: inst.id,
    defId: inst.defId,
    occupiedLanes: inst.occupiedLanes,
    worldY,
    halfHeight: 40,
    damage,
  };
}

function makeCollisionSystem(): CollisionSystem {
  return new CollisionSystem(HAZARD_REGISTRY);
}

// ---------------------------------------------------------------------------
// yOverlap
// ---------------------------------------------------------------------------

describe('yOverlap', () => {
  it('detects overlap when objects touch', () => {
    expect(yOverlap(0, 30, 0, 30)).toBe(true);    // centered
    expect(yOverlap(0, 30, 50, 30)).toBe(true);   // just touching
    expect(yOverlap(0, 30, 61, 30)).toBe(false);  // just apart
    expect(yOverlap(0, 30, 200, 30)).toBe(false); // far apart
  });

  it('is symmetric', () => {
    expect(yOverlap(100, 20, 110, 20)).toBe(yOverlap(110, 20, 100, 20));
  });
});

// ---------------------------------------------------------------------------
// laneOverlap
// ---------------------------------------------------------------------------

describe('laneOverlap', () => {
  it('detects hit when player is centered in hazard lane', () => {
    expect(laneOverlap(2, [2, 3], 0.8, 0.5)).toBe(true);
  });

  it('misses when player is in a safe lane', () => {
    expect(laneOverlap(1, [2, 3], 0.8, 0.5)).toBe(false);
    expect(laneOverlap(4, [2, 3], 0.8, 0.5)).toBe(false);
  });

  it('forgiveness: player at edge of lane with narrow hitbox is safe', () => {
    // widthFraction=0.65 means hazard occupies 65% of lane (center 17.5–82.5%)
    // Player at lane edge (normalized 0.05) should be safe
    expect(laneOverlap(2, [2], 0.65, 0.05)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CollisionSystem.checkCollisions
// ---------------------------------------------------------------------------

describe('CollisionSystem.checkCollisions', () => {
  const cs = makeCollisionSystem();

  it('detects hit when player is in hazard lane and Y overlaps', () => {
    const player = makePlayer({ lane: 2, targetLane: 2 });
    const inst = makeInstance('haz_barrier', [2]);
    const rects = new Map([[inst.id, makeHazardRect(inst, 400)]]);

    const hits = cs.checkCollisions(player, [inst], rects);
    expect(hits).toHaveLength(1);
    expect(hits[0].defId).toBe('haz_barrier');
  });

  it('no hit when player in different lane', () => {
    const player = makePlayer({ lane: 0, targetLane: 0 });
    const inst = makeInstance('haz_barrier', [3]);
    const rects = new Map([[inst.id, makeHazardRect(inst, 400)]]);
    expect(cs.checkCollisions(player, [inst], rects)).toHaveLength(0);
  });

  it('no hit during invuln window', () => {
    const player = makePlayer({ lane: 2, targetLane: 2, invulnRemaining: 0.5 });
    const inst = makeInstance('haz_barrier', [2]);
    const rects = new Map([[inst.id, makeHazardRect(inst, 400)]]);
    expect(cs.checkCollisions(player, [inst], rects)).toHaveLength(0);
  });

  it('no hit during telegraph phase', () => {
    const player = makePlayer({ lane: 2, targetLane: 2 });
    const inst = makeInstance('haz_barrier', [2], 'telegraphing');
    const rects = new Map([[inst.id, makeHazardRect(inst, 400)]]);
    expect(cs.checkCollisions(player, [inst], rects)).toHaveLength(0);
  });

  it('no hit if Y does not overlap', () => {
    const player = makePlayer({ lane: 2, worldY: 400 });
    const inst = makeInstance('haz_barrier', [2]);
    const rects = new Map([[inst.id, makeHazardRect(inst, 800)]]);
    expect(cs.checkCollisions(player, [inst], rects)).toHaveLength(0);
  });

  it('no multi-hit on same instance', () => {
    const player = makePlayer({ lane: 2, targetLane: 2 });
    const inst = makeInstance('haz_barrier', [2]);
    const rects = new Map([[inst.id, makeHazardRect(inst, 400)]]);

    const hits1 = cs.checkCollisions(player, [inst], rects);
    expect(hits1).toHaveLength(1);
    // inst.hitRegistered is now true
    const hits2 = cs.checkCollisions(player, [inst], rects);
    expect(hits2).toHaveLength(0);
  });

  it('tween grace: player current lane hit but target lane is safe → no hit', () => {
    // Player is mid-tween: currently in lane 2 (hazard lane) but targeting lane 0 (safe)
    const player = makePlayer({ lane: 2, targetLane: 0 });
    const inst = makeInstance('haz_barrier', [2]);
    const rects = new Map([[inst.id, makeHazardRect(inst, 400)]]);
    // currentInHazard=true, targetInHazard=false → grace → no hit
    expect(cs.checkCollisions(player, [inst], rects)).toHaveLength(0);
  });

  it('multi-lane hazard hits player in any occupied lane', () => {
    for (const lane of [1, 2, 3]) {
      const player = makePlayer({ lane, targetLane: lane });
      const inst = makeInstance('haz_mine_strip', [1, 2, 3]);
      const rects = new Map([[inst.id, makeHazardRect(inst, 400)]]);
      const hits = cs.checkCollisions(player, [inst], rects);
      expect(hits).toHaveLength(1);
    }
  });

  it('returns damage value from hazard rect', () => {
    const player = makePlayer({ lane: 2, targetLane: 2 });
    const inst = makeInstance('haz_crusher', [2]);
    const rects = new Map([[inst.id, makeHazardRect(inst, 400, 2)]]);
    const hits = cs.checkCollisions(player, [inst], rects);
    expect(hits[0].damage).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Fairness validation
// ---------------------------------------------------------------------------

describe('CollisionSystem.validateFairness', () => {
  const cs = makeCollisionSystem();

  it('barrier with 1 lane is fair in 5-lane world', () => {
    const inst = makeInstance('haz_barrier', [2]);
    const result = cs.validateFairness(inst, 5);
    expect(result.fair).toBe(true);
    expect(result.safeCount).toBe(4);
  });

  it('detects unfair all-lane block', () => {
    const inst = makeInstance('haz_barrier', [0, 1, 2, 3, 4]);
    const result = cs.validateFairness(inst, 5);
    expect(result.fair).toBe(false);
    expect(result.safeCount).toBe(0);
  });

  it('laser_sweep with 1 safe lane is barely fair', () => {
    const inst = makeInstance('haz_laser_sweep', [0, 1, 2, 3]);
    const result = cs.validateFairness(inst, 5);
    expect(result.fair).toBe(true);
    expect(result.safeCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 120s stability test — no false positives over a long run
// ---------------------------------------------------------------------------

describe('CollisionSystem — 120s run stability', () => {
  it('no false positive collisions when player is always in safe lane', () => {
    const cs = makeCollisionSystem();
    const FPS = 60;
    const TOTAL_TICKS = 120 * FPS;
    let falsePositives = 0;

    // Player stays in lane 0 (always safe — hazards always block lanes 1–4 max)
    const player = makePlayer({ lane: 0, targetLane: 0 });

    for (let tick = 0; tick < TOTAL_TICKS; tick++) {
      // Simulate up to 4 simultaneous hazards, all in lanes 1–4
      const instances: HazardInstance[] = [];
      const rects = new Map<string, HazardRect>();

      for (let h = 0; h < 4; h++) {
        const def = HAZARD_REGISTRY.get('haz_barrier')!;
        const inst: HazardInstance = {
          id: `inst-${tick}-${h}`,
          defId: 'haz_barrier',
          kind: 'barrier',
          state: 'active',
          occupiedLanes: [1 + h], // lanes 1, 2, 3, 4 — never lane 0
          worldY: 400,
          telegraphRemaining: 0,
          activeRemaining: 0,
          intensity: def.intensityLevels[0],
          hitRegistered: false,
        };
        instances.push(inst);
        rects.set(inst.id, makeHazardRect(inst, 400));
      }

      const hits = cs.checkCollisions(player, instances, rects);
      falsePositives += hits.length;
    }

    expect(falsePositives).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lane geometry
// ---------------------------------------------------------------------------

describe('buildLaneGeometry', () => {
  it('computes correct lane centers', () => {
    const geo = buildLaneGeometry(5, 500);
    expect(geo.laneWidth).toBe(100);
    expect(geo.laneCenter(0)).toBe(50);
    expect(geo.laneCenter(2)).toBe(250);
    expect(geo.laneCenter(4)).toBe(450);
  });
});
