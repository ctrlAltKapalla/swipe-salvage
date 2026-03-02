/**
 * RunScene — primary game scene.
 *
 * State is owned and managed by RunSceneWiring (T8 — Peter's delivery).
 * All mutations flow through wiring.manager.dispatch(action).
 * HUDScene + EncounterScene communicate exclusively via this.game.events.
 *
 * EventBus contract (T2 §3.2):
 *   → 'run:state'        (out, HUDBroadcaster fires on every dispatch)
 *   → 'run:phase_change' (out)
 *   → 'run:hp_change'    (out)
 *   → 'game:over'        (out)
 *   → 'run:complete'     (out)
 *   ← 'hud:restart'      (in, from HUDScene Play Again)
 *   ← 'encounter:result' (in, routed by EncounterBridge inside wiring)
 */
import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig.ts';
import { InputSystem } from '../systems/InputSystem.ts';
import { LaneSystem } from '../systems/LaneSystem.ts';
import { PhaseController } from '../systems/PhaseController.ts';
import { SpawnerSystem } from '../systems/SpawnerSystem.ts';
import { PlayerEntity } from '../entities/PlayerEntity.ts';
import { RunSceneWiring } from '../state/run-scene-wiring.ts';
import { createInitialRunState } from '../types/run-state.ts';
import { TRAIT_REGISTRY } from '../data/traits.data.ts';
import { MODULE_REGISTRY } from '../data/modules.data.ts';
import { createRunRNGStreams, generateRunSeed } from '../rng/SeededRNG.ts';
import { HUD_SCENE_KEY } from './HUDScene.ts';
import { ENCOUNTER_SCENE_KEY } from './EncounterScene.ts';

export const RUN_SCENE_KEY = 'RunScene';

const BG_PARALLAX_MULT = 0.4;

/** Default loadout from data registry — uses LoadoutModule shape */
const defaultActiveModules = () =>
  [...MODULE_REGISTRY.values()].filter(m => m.type === 'active').slice(0, 3)
    .map(def => ({ defId: def.id, upgradeLevel: 0, cooldownRemaining: 0 }));

const defaultPassiveCores = () =>
  [...MODULE_REGISTRY.values()].filter(m => m.type === 'passive_core').slice(0, 1)
    .map(def => ({ defId: def.id, upgradeLevel: 0, cooldownRemaining: 0 }));

export class RunScene extends Phaser.Scene {
  // Systems
  private inputSys!:  InputSystem;
  /** @internal exposed for E2E tests */
  laneSys!:   LaneSystem;
  private phaseCtrl!: PhaseController;
  /** @internal exposed for E2E tests */
  spawner!:   SpawnerSystem;

  // Entities
  /** @internal exposed for E2E tests */
  player!: PlayerEntity;

  // T8 wiring — owns RunStateManager + EncounterBridge + HUDBroadcaster
  /** @internal exposed for E2E tests */
  wiring!: RunSceneWiring;

  /** @internal true until first tap/swipe starts the run */
  isIdle = true;

  // Visuals
  private bgGraphics!:   Phaser.GameObjects.Graphics;
  private laneGraphics!: Phaser.GameObjects.Graphics;
  private scrollOffset = 0;

  // Idle
  private idleText!: Phaser.GameObjects.Text;


  // Distance accumulator for wiring.tick()
  private distanceDelta = 0;

  constructor() {
    super({ key: RUN_SCENE_KEY });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  create() {
    const cw = this.scale.width;
    const ch = this.scale.height;

    this.bgGraphics   = this.add.graphics().setDepth(0);
    this.laneGraphics = this.add.graphics().setDepth(1);

    const startLane = Math.floor(GameConfig.LANE_COUNT / 2);
    this.player = new PlayerEntity(this, 0, ch * GameConfig.PLAYER_Y_FACTOR);

    this.inputSys  = new InputSystem(this);
    this.laneSys   = new LaneSystem(this, this.inputSys, this.player.container, startLane, cw);
    this.phaseCtrl = new PhaseController();

    this.idleText = this.add.text(cw / 2, ch / 2,
      'SWIPE SALVAGE\n\nSwipe or tap to start\n← → or A / D to move', {
        fontFamily: "'Courier New', monospace",
        fontSize: `${Math.min(28, cw * 0.07)}px`,
        color: '#00ffee',
        align: 'center',
        lineSpacing: 12,
      }
    ).setOrigin(0.5).setDepth(50);

    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      if (this.isIdle) this.startRun();
    });

    // ← restart from HUDScene Play Again button
    this.game.events.on('hud:restart', () => this.startRun(), this);

    // Listen for wiring-emitted game:over to show final frame
    this.game.events.on('game:over', () => {
      this.isIdle = true; // stop update loop until restart
    }, this);

    // Launch overlay scenes (T2 §3 scene stack)
    this.scene.launch(HUD_SCENE_KEY);
    this.scene.bringToTop(HUD_SCENE_KEY);
    this.scene.launch(ENCOUNTER_SCENE_KEY);
  }

  // ── Start / restart ───────────────────────────────────────────────────────
  private startRun() {
    this.isIdle = false;
    this.idleText.setVisible(false);

    const cw   = this.scale.width;
    const ch   = this.scale.height;
    const seed = generateRunSeed();
    const streams = createRunRNGStreams(seed);

    if (this.spawner) this.spawner.destroy();
    this.spawner = new SpawnerSystem(this, streams.hazard, cw);

    // Build initial RunState from T4 types
    const initialState = createInitialRunState(
      `run-${seed}`,
      { kind: 'standard', seed },
      'scrapyard',                // biomeId — T6 will vary this
      defaultActiveModules(),
      defaultPassiveCores(),
      GameConfig.LANE_COUNT,
      Math.floor(GameConfig.LANE_COUNT / 2),
    );

    // T8 wiring: drop-in per Peter's delivery
    if (this.wiring) this.wiring.unmount();
    this.wiring = new RunSceneWiring(initialState, this.game.events, TRAIT_REGISTRY);
    this.wiring.mount();

    // Dispatch run start
    this.wiring.manager.dispatch({ type: 'PHASE_TRANSITION', to: 'warmup' });

    this.scrollOffset  = 0;
    this.distanceDelta = 0;

    const startLane = Math.floor(GameConfig.LANE_COUNT / 2);
    this.player.reset(this.laneSys.positions[startLane], ch * GameConfig.PLAYER_Y_FACTOR);
    this.laneSys.snapTo(startLane);
    this.phaseCtrl.reset();

    this.game.events.emit('run:started');
  }

  // ── Update (hot path — no allocations) ───────────────────────────────────
  update(_time: number, delta: number) {
    const dtS  = Math.min(delta / 1000, 0.05);
    const dtMs = Math.min(delta, 50);

    this.drawBackground(dtS);

    if (this.isIdle || !this.wiring) return;

    const state = this.wiring.state;
    if (state.phase === 'dead' || state.phase === 'complete') return;

    // 1. Input → lane
    this.laneSys.update(delta);

    // 2. Scroll speed from phase controller
    const elapsed = state.elapsedSeconds;
    const { speed } = this.phaseCtrl.updateFromElapsed(elapsed);

    // 3. Hazard spawn + scroll
    this.spawner.update(dtS, speed, this.scale.height);

    // 4. Player visual
    this.player.update(dtMs);

    // 5. Collision → dispatch TAKE_DAMAGE
    this.checkCollision();

    // 6. Distance this frame (for score/speed ramp in wiring.tick)
    this.distanceDelta = speed * dtS;

    // 7. T8 wiring tick — TICK + MODULE_COOLDOWN_TICK + INVULN_TICK dispatched here
    this.wiring.tick(dtMs / 1000, this.distanceDelta);

    // 8. Sync lane into state
    this.wiring.manager.dispatch({ type: 'LANE_SYNC', lane: this.laneSys.lane });

    // 9. Draw lanes
    this.drawLaneGrid();
  }

  // ── Shutdown ──────────────────────────────────────────────────────────────
  shutdown() {
    this.wiring?.unmount();
    this.game.events.off('hud:restart',  undefined, this);
    this.game.events.off('game:over',    undefined, this);
  }

  // ── Collision ─────────────────────────────────────────────────────────────
  private checkCollision() {
    const state = this.wiring.state;
    if (state.vitals.invulnRemaining > 0) return;

    const px = this.player.container.x;
    const py = this.player.container.y;

    if (this.spawner.checkCollision(px, py, GameConfig.PLAYER_WIDTH, GameConfig.PLAYER_HEIGHT)) {
      this.player.hit();
      // Route damage through RunStateManager — HUDBroadcaster fires run:hp_change
      this.wiring.manager.dispatch({ type: 'TAKE_DAMAGE', damage: 1, isProjectile: false });
    }
  }

  // ── Drawing ───────────────────────────────────────────────────────────────
  private drawBackground(dtS: number) {
    const cw  = this.scale.width;
    const ch  = this.scale.height;
    const spd = this.wiring?.state.distance ?? 0;

    this.scrollOffset = (this.scrollOffset + spd * BG_PARALLAX_MULT * dtS) % 40;

    this.bgGraphics.clear();
    this.bgGraphics.fillStyle(0x050810, 1);
    this.bgGraphics.fillRect(0, 0, cw, ch);

    this.bgGraphics.lineStyle(1, 0x00ffee, 0.04);
    for (let y = (this.scrollOffset % 40) - 40; y < ch; y += 40) {
      this.bgGraphics.beginPath();
      this.bgGraphics.moveTo(0, y);
      this.bgGraphics.lineTo(cw, y);
      this.bgGraphics.strokePath();
    }
  }

  private drawLaneGrid() {
    const cw = this.scale.width;
    const ch = this.scale.height;
    const lw = cw / GameConfig.LANE_COUNT;

    this.laneGraphics.clear();
    this.laneGraphics.lineStyle(1, 0x00ffee, 0.12);
    for (let i = 1; i < GameConfig.LANE_COUNT; i++) {
      const x = i * lw;
      this.laneGraphics.beginPath();
      this.laneGraphics.moveTo(x, 0);
      this.laneGraphics.lineTo(x, ch);
      this.laneGraphics.strokePath();
    }

    const alpha = this.laneSys.highlightAlpha;
    if (alpha > 0) {
      this.laneGraphics.fillStyle(0x00ffee, alpha * 0.15);
      this.laneGraphics.fillRect(this.laneSys.targetLane * lw, 0, lw, ch);
    }
  }
}
