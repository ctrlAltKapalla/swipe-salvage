/**
 * HUDScene — parallel overlay scene per T2 §3.
 *
 * Receives run state via game.events 'run:state' (emitted by HUDBroadcaster after
 * every RunStateManager dispatch — T8 wiring). No direct RunScene reference.
 *
 * State type: T4 RunState (src/types/run-state.ts).
 * Field map:
 *   state.vitals.hp / maxHp / shields / maxShields / heat / invulnRemaining
 *   state.wallet.scrap / energy / cores
 *   state.score.baseScore / multiplier
 *   state.elapsedSeconds / state.phase
 *   state.activeModules[i].cooldownRemaining + MODULE_REGISTRY lookup for def
 *   state.passiveCores[0]
 */
import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig.ts';
import { ReducedMotion } from '../systems/ReducedMotion.ts';
import { MODULE_REGISTRY } from '../data/modules.data.ts';
import type { RunState } from '../types/run-state.ts';
import type { LoadoutModule } from '../types/modules.ts';

export const HUD_SCENE_KEY = 'HUDScene';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  ACCENT:   0x00ffee,
  WARN:     0xffcc00,
  DANGER:   0xff2200,
  DIM:      0x223344,
  BG:       0x050810,
  HEART:    0xff3355,
  LOST:     0x223344,
  MOD_BG:   0x0a1828,
  HEAT_LIT: 0xff5500,
  HEAT_CRIT:0xff2200,
  SHIELD:   0x00aaff,
} as const;

const FONT        = "'Courier New'";
const HEAT_SEGS   = 8;
const TOP_H       = 54;
const BOTTOM_H    = 90;
const MODULE_SIZE = 52;
const MODULE_GAP  = 12;
const PASSIVE_R   = 22;
const HEART_SZ    = 16;

// Tween durations
const T_REFILL  = 180;
const T_RES     = 200;
const T_SHIELD  = 1200;
const T_READY   = 300;
const T_FADE    = 250;

// Phase label map
const PHASE_LABELS: Record<string, string> = {
  loading:   'LOADING',
  warmup:    'WARM-UP',
  mid:       'MID-RUN',
  climax:    'CLIMAX',
  encounter: 'ENCOUNTER',
  dead:      'GAME OVER',
  complete:  'COMPLETE',
};

export class HUDScene extends Phaser.Scene {
  private _state: RunState | null = null;

  // Top bar
  /** @internal exposed for E2E tests */
  timerText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;

  // Vitals
  private hearts!:     Phaser.GameObjects.Rectangle[];
  private shieldBg!:   Phaser.GameObjects.Graphics;
  private shieldFill!: Phaser.GameObjects.Rectangle;
  private shieldTween: Phaser.Tweens.Tween | null = null;

  // Resources
  private scrapText!:  Phaser.GameObjects.Text;
  private energyText!: Phaser.GameObjects.Text;
  private coresText!:  Phaser.GameObjects.Text;
  private prevScrap  = -1;
  private prevEnergy = -1;
  private prevCores  = -1;

  // Heat
  private heatContainer!: Phaser.GameObjects.Container;
  private heatSegs!:      Phaser.GameObjects.Rectangle[];

  // Bottom / modules
  private passiveIcon!:   Phaser.GameObjects.Text;
  private modBg!:         Phaser.GameObjects.Rectangle[];
  private modIcon!:       Phaser.GameObjects.Text[];
  private modOverlay!:    Phaser.GameObjects.Rectangle[];
  private modBarFill!:    Phaser.GameObjects.Rectangle[];
  private modBorder!:     Phaser.GameObjects.Graphics[];
  private modLabel!:      Phaser.GameObjects.Text[];
  private modWasReady!:   boolean[];

  // Game-over
  private goGroup!:   Phaser.GameObjects.Container;
  private goBtn!:     Phaser.GameObjects.Rectangle;
  private goScore!:   Phaser.GameObjects.Text;
  /** @internal exposed for E2E tests */
  goVisible = false;

  // Prev state for change detection
  private prevHP     = -1;
  private prevShield = -1;

  constructor() { super({ key: HUD_SCENE_KEY }); }

  create() {
    this.scene.bringToTop();
    const W = this.scale.width;
    const H = this.scale.height;

    this.buildTopBar(W);
    this.buildVitals(W);
    this.buildResources(W);
    this.buildHeat(W);
    this.buildBottom(W, H);
    this.buildGameOver(W, H);

    this.events.on(Phaser.Scenes.Events.RESUME, () => this.scene.bringToTop());

    // Receive state via EventBus — HUDBroadcaster emits RunStatePayload wrapper:
    // { state: RunState, phase, hp, ... }. Unwrap .state to get the full RunState.
    // (setVisible(false) on a container does NOT stop Phaser delivering events)
    this.game.events.on('run:state', (payload: { state: RunState }) => {
      this._state = payload.state;
    }, this);
    this.game.events.on('run:started', () => {
      this.goVisible = false;
      this.goGroup.setVisible(false).setAlpha(0);
      this.prevHP = -1; this.prevShield = -1;
      this.prevScrap = -1; this.prevEnergy = -1; this.prevCores = -1;
    }, this);
    this.game.events.on('game:over', (_payload: unknown) => {
      if (this._state && !this.goVisible) this.showGameOver(this._state.score.baseScore);
    }, this);
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('run:state',   undefined, this);
      this.game.events.off('run:started', undefined, this);
      this.game.events.off('game:over',   undefined, this);
    });
  }

  // ── Top bar ───────────────────────────────────────────────────────────────
  private buildTopBar(W: number) {
    const g = this.add.graphics().setDepth(90);
    g.fillGradientStyle(C.BG, C.BG, C.BG, C.BG, 0.92, 0.92, 0, 0);
    g.fillRect(0, 0, W, TOP_H);

    const cy = TOP_H / 2 - 6;
    this.timerText = this.add.text(W / 2, cy, '02:00', {
      fontFamily: FONT, fontSize: `${px(26, W, 0.065)}px`,
      color: '#00ffee', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(91).setShadow(0, 0, '#00ffee', 6);

    this.phaseText = this.add.text(W / 2, cy + 20, 'WARM-UP', {
      fontFamily: FONT, fontSize: `${px(11, W, 0.028)}px`,
      color: '#00ffee', letterSpacing: 4,
    }).setOrigin(0.5).setDepth(91).setAlpha(0.8);

    this.scoreText = this.add.text(W - 14, cy, '0', {
      fontFamily: FONT, fontSize: `${px(15, W, 0.038)}px`, color: '#cceeff',
    }).setOrigin(1, 0.5).setDepth(91);
  }

  // ── Vitals ────────────────────────────────────────────────────────────────
  private buildVitals(W: number) {
    this.hearts = [];
    for (let i = 0; i < GameConfig.PLAYER_HP; i++) {
      this.hearts.push(
        this.add.rectangle(14 + i * (HEART_SZ + 5) + HEART_SZ / 2,
          TOP_H + 8 + HEART_SZ / 2, HEART_SZ, HEART_SZ, C.HEART).setDepth(91)
      );
    }
    const shieldW = Math.min(88, W * 0.22);
    const shieldY = TOP_H + 8 + HEART_SZ + 7;
    this.shieldBg = this.add.graphics().setDepth(91);
    this.shieldBg.fillStyle(C.SHIELD, 0.12);
    this.shieldBg.fillRoundedRect(14, shieldY, shieldW, 5, 2);
    this.shieldFill = this.add.rectangle(14, shieldY + 1, 0, 3, C.SHIELD)
      .setOrigin(0, 0).setDepth(92).setVisible(false);
    this.shieldBg.setVisible(false);
  }

  // ── Resources ─────────────────────────────────────────────────────────────
  private buildResources(W: number) {
    const fs = `${px(13, W, 0.033)}px`;
    const x  = W - 14;
    const y0 = TOP_H + 8;
    this.scrapText  = this.add.text(x, y0,      '⚙ 0',  { fontFamily: FONT, fontSize: fs, color: '#889aaa' }).setOrigin(1, 0).setDepth(91);
    this.energyText = this.add.text(x, y0 + 20, '⚡ 0', { fontFamily: FONT, fontSize: fs, color: '#889aaa' }).setOrigin(1, 0).setDepth(91);
    this.coresText  = this.add.text(x, y0 + 40, '◆ 0',  { fontFamily: FONT, fontSize: fs, color: '#889aaa' }).setOrigin(1, 0).setDepth(91);
  }

  // ── Heat ──────────────────────────────────────────────────────────────────
  private buildHeat(W: number) {
    const sw = 10, sh = 10, gap = 3;
    const totalW = HEAT_SEGS * (sw + gap) - gap;
    const sx = W / 2 - totalW / 2;
    const hy = TOP_H + 10;

    const label = this.add.text(W / 2, hy, 'HEAT', {
      fontFamily: FONT, fontSize: '9px', color: '#ff6600', letterSpacing: 3,
    }).setOrigin(0.5, 0).setDepth(91).setAlpha(0.8);

    this.heatSegs = Array.from({ length: HEAT_SEGS }, (_, i) =>
      this.add.rectangle(sx + i * (sw + gap) + sw / 2, hy + 14 + sh / 2,
        sw, sh, C.DIM).setDepth(91).setAlpha(0.3)
    );
    this.heatContainer = this.add.container(0, 0, [label, ...this.heatSegs]);
    this.heatContainer.setVisible(false);
  }

  // ── Bottom bar + modules ──────────────────────────────────────────────────
  private buildBottom(W: number, H: number) {
    const bottomY = H - BOTTOM_H;
    const cy = bottomY + BOTTOM_H / 2 - 6;

    const g = this.add.graphics().setDepth(90);
    g.fillGradientStyle(C.BG, C.BG, C.BG, C.BG, 0, 0, 0.92, 0.92);
    g.fillRect(0, bottomY, W, BOTTOM_H);

    // Passive core
    const passX = 14 + PASSIVE_R;
    this.add.arc(passX, cy, PASSIVE_R, 0, 360, false, C.MOD_BG)
      .setStrokeStyle(1.5, 0x9966ff, 0.6).setDepth(91);
    this.passiveIcon = this.add.text(passX, cy, '—', {
      fontFamily: FONT, fontSize: '18px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(92);
    this.add.text(passX, cy + PASSIVE_R + 4, 'CORE', {
      fontFamily: FONT, fontSize: '7px', color: '#9966ff', letterSpacing: 2,
    }).setOrigin(0.5, 0).setDepth(91).setAlpha(0.6);

    // Module slots
    const totalW  = 3 * MODULE_SIZE + 2 * MODULE_GAP;
    const startX  = W / 2 - totalW / 2;
    this.modBg = []; this.modIcon = []; this.modOverlay = [];
    this.modBarFill = []; this.modBorder = []; this.modLabel = [];
    this.modWasReady = [false, false, false];

    for (let i = 0; i < 3; i++) {
      const mx  = startX + i * (MODULE_SIZE + MODULE_GAP) + MODULE_SIZE / 2;
      const barY = cy + MODULE_SIZE / 2 + 5;

      this.modBg.push(this.add.rectangle(mx, cy, MODULE_SIZE, MODULE_SIZE, C.MOD_BG).setDepth(91));

      const border = this.add.graphics().setDepth(92);
      this.drawModBorder(border, mx, cy, false);
      this.modBorder.push(border);

      this.modIcon.push(
        this.add.text(mx, cy, '?', { fontFamily: FONT, fontSize: '20px', color: '#ffffff' })
          .setOrigin(0.5).setDepth(94)
      );

      // Cooldown overlay (height = cover fraction × MODULE_SIZE)
      this.modOverlay.push(
        this.add.rectangle(mx, cy - MODULE_SIZE / 2, MODULE_SIZE, MODULE_SIZE, 0x000000, 0.65)
          .setOrigin(0.5, 0).setDepth(93)
      );

      this.add.rectangle(mx, barY, MODULE_SIZE, 4, C.DIM, 0.25).setDepth(91);
      this.modBarFill.push(
        this.add.rectangle(mx - MODULE_SIZE / 2, barY, 0, 4, C.ACCENT)
          .setOrigin(0, 0.5).setDepth(92)
      );
      this.modLabel.push(
        this.add.text(mx, barY + 7, '—', {
          fontFamily: FONT, fontSize: '8px', color: '#446677', letterSpacing: 1,
        }).setOrigin(0.5, 0).setDepth(91)
      );
    }
  }

  // ── Game-over overlay ─────────────────────────────────────────────────────
  private buildGameOver(W: number, H: number) {
    const cx = W / 2, cy = H / 2;
    const bg    = this.add.rectangle(cx, cy, W, H, C.BG, 0.88).setDepth(200);
    const title = this.add.text(cx, cy - 70, 'GAME OVER', {
      fontFamily: FONT, fontSize: `${px(36, W, 0.09)}px`,
      color: '#ff4444', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(201).setShadow(0, 0, '#ff2200', 12);
    this.goScore = this.add.text(cx, cy - 10, 'Score: 0', {
      fontFamily: FONT, fontSize: `${px(20, W, 0.05)}px`, color: '#cceeff',
    }).setOrigin(0.5).setDepth(201);
    // NOT interactive at create-time — enabled in showGameOver(), disabled in hideGameOver()
    const btn = this.add.rectangle(cx, cy + 60, 168, 48, 0x003333, 0.92)
      .setStrokeStyle(2, C.ACCENT).setDepth(201);
    this.goBtn = btn;
    const btnTxt = this.add.text(cx, cy + 60, 'PLAY AGAIN', {
      fontFamily: FONT, fontSize: `${px(16, W, 0.041)}px`, color: '#00ffee', letterSpacing: 3,
    }).setOrigin(0.5).setDepth(202);
    btn.on(Phaser.Input.Events.POINTER_UP, () => {
      this.hideGameOver();
      this.game.events.emit('hud:restart');
    });
    btn.on(Phaser.Input.Events.POINTER_OVER, () => btn.setFillStyle(0x005555, 0.92));
    btn.on(Phaser.Input.Events.POINTER_OUT,  () => btn.setFillStyle(0x003333, 0.92));
    this.goGroup = this.add.container(0, 0, [bg, title, this.goScore, btn, btnTxt]);
    this.goGroup.setVisible(false);
  }

  // ── Update ────────────────────────────────────────────────────────────────
  update() {
    if (!this._state) return;
    const s = this._state;

    this.updateTimer(s.elapsedSeconds);
    this.phaseText.setText(PHASE_LABELS[s.phase] ?? s.phase.toUpperCase());
    const total = s.score.baseScore;
    const mult  = s.score.multiplier;
    this.scoreText.setText(`${total.toLocaleString()}  ×${mult.toFixed(1)}`);

    this.updateHP(s.vitals);
    this.updateResources(s.wallet.scrap, s.wallet.energy, s.wallet.cores);
    this.updateHeat(s.vitals.heat);
    this.updateModules(s.activeModules);
    this.updatePassive(s.passiveCores);
  }

  // ── Updaters ──────────────────────────────────────────────────────────────
  private updateTimer(elapsed: number) {
    const rem = Math.max(0, GameConfig.RUN_DURATION_S - elapsed);
    const m = String(Math.floor(rem / 60)).padStart(2, '0');
    const sc = String(Math.floor(rem % 60)).padStart(2, '0');
    this.timerText.setText(`${m}:${sc}`);
  }

  private updateHP(v: { hp: number; maxHp: number; shields: number; maxShields: number }) {
    if (v.hp !== this.prevHP) {
      const lost = v.hp < this.prevHP && this.prevHP >= 0;
      for (let i = 0; i < this.hearts.length && i < v.maxHp; i++) {
        this.hearts[i].setFillStyle(i < v.hp ? C.HEART : C.LOST);
      }
      if (lost && ReducedMotion.ok) {
        this.hearts.filter((_, i) => i < v.hp).forEach((h, i) => {
          this.tweens.add({ targets: h, scaleX: 1.35, scaleY: 1.35,
            duration: 100, yoyo: true, delay: i * 30, ease: 'Quad.easeOut' });
        });
      }
      this.prevHP = v.hp;
    }

    if (v.shields !== this.prevShield) {
      const maxW = Math.min(88, this.scale.width * 0.22);
      const pct  = v.maxShields > 0 ? v.shields / v.maxShields : 0;
      this.tweens.add({
        targets: this.shieldFill, width: Math.max(0, pct * maxW),
        duration: ReducedMotion.duration(T_REFILL), ease: 'Quad.easeOut',
      });
      const vis = v.maxShields > 0;
      this.shieldFill.setVisible(vis);
      this.shieldBg.setVisible(vis);
      if (v.shields > 0 && ReducedMotion.ok) {
        if (this.shieldTween) this.shieldTween.stop();
        this.shieldTween = this.tweens.add({
          targets: this.shieldFill, alpha: { from: 1, to: 0.45 },
          duration: T_SHIELD, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      } else if (this.shieldTween) {
        this.shieldTween.stop(); this.shieldFill.setAlpha(1); this.shieldTween = null;
      }
      this.prevShield = v.shields;
    }
  }

  private updateResources(scrap: number, energy: number, cores: number) {
    this.tickRes(this.scrapText,  scrap,  '⚙',  this.prevScrap,  v => { this.prevScrap  = v; });
    this.tickRes(this.energyText, energy, '⚡', this.prevEnergy, v => { this.prevEnergy = v; });
    this.tickRes(this.coresText,  cores,  '◆',  this.prevCores,  v => { this.prevCores  = v; });
  }

  private tickRes(txt: Phaser.GameObjects.Text, val: number, icon: string, prev: number, set: (v: number) => void) {
    if (val === prev) return;
    txt.setText(`${icon} ${val}`);
    if (val > prev && ReducedMotion.ok) {
      this.tweens.add({ targets: txt, scaleX: 1.25, scaleY: 1.25,
        duration: T_RES, yoyo: true, ease: 'Back.easeOut' });
    }
    set(val);
  }

  private updateHeat(heat: number) {
    const visible = heat > 0.05;
    this.heatContainer.setVisible(visible);
    if (!visible) return;
    const lit = Math.round(heat * HEAT_SEGS);
    this.heatSegs.forEach((seg, i) => {
      const isLit  = i < lit;
      const isCrit = isLit && i >= HEAT_SEGS - 2;
      seg.setFillStyle(isLit ? (isCrit ? C.HEAT_CRIT : C.HEAT_LIT) : C.DIM)
         .setAlpha(isLit ? 1 : 0.3);
    });
  }

  private updateModules(slots: ReadonlyArray<LoadoutModule | null>) {
    for (let i = 0; i < 3; i++) {
      const slot = slots[i] ?? null;
      const def  = slot ? MODULE_REGISTRY.get(slot.defId) : null;
      const icon = def ? def.name.slice(0, 2).toUpperCase() : '—';
      const baseCd = def?.baseCooldown ?? 1;
      const rem    = slot?.cooldownRemaining ?? 0;
      const ready  = rem <= 0;
      const pct    = ready ? 1 : 1 - rem / baseCd;
      const cover  = ready ? 0 : rem / baseCd;

      this.modIcon[i].setText(icon);
      this.modOverlay[i].setDisplaySize(MODULE_SIZE, Math.max(0, cover * MODULE_SIZE));

      this.tweens.add({
        targets: this.modBarFill[i], width: Math.max(0, pct * MODULE_SIZE),
        duration: ReducedMotion.duration(T_REFILL), ease: 'Linear', overwrite: true,
      });

      if (ready !== this.modWasReady[i]) {
        this.drawModBorder(this.modBorder[i], this.modBg[i].x, this.modBg[i].y, ready);
        if (ready && ReducedMotion.ok) {
          this.tweens.add({ targets: this.modBorder[i], alpha: { from: 0.3, to: 1 },
            duration: T_READY, ease: 'Quad.easeOut' });
        }
        this.modWasReady[i] = ready;
      }

      const labelStr = ready ? 'READY' : `${Math.ceil(rem)}s`;
      this.modLabel[i].setText(labelStr).setColor(ready ? '#00ffee' : '#446677');
    }
  }

  private updatePassive(cores: ReadonlyArray<LoadoutModule | null>) {
    const slot = cores[0] ?? null;
    const def  = slot ? MODULE_REGISTRY.get(slot.defId) : null;
    this.passiveIcon.setText(def ? def.name.slice(0, 1).toUpperCase() : '—');
  }

  private drawModBorder(g: Phaser.GameObjects.Graphics, mx: number, my: number, ready: boolean) {
    g.clear();
    g.lineStyle(1.5, ready ? C.ACCENT : C.DIM, ready ? 0.85 : 0.35);
    g.strokeRect(mx - MODULE_SIZE / 2, my - MODULE_SIZE / 2, MODULE_SIZE, MODULE_SIZE);
    if (ready) {
      g.lineStyle(3, C.ACCENT, 0.18);
      g.strokeRect(mx - MODULE_SIZE / 2 - 2, my - MODULE_SIZE / 2 - 2, MODULE_SIZE + 4, MODULE_SIZE + 4);
    }
  }

  private showGameOver(score: number) {
    this.goVisible = true;
    this.goScore.setText(`Score: ${score.toLocaleString()}`);
    this.goBtn.setInteractive({ useHandCursor: true });
    this.goGroup.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.goGroup, alpha: 1,
      duration: ReducedMotion.duration(T_FADE), ease: 'Quad.easeOut' });
  }

  private hideGameOver() {
    this.goVisible = false;
    this.goBtn.disableInteractive();
    this.tweens.add({ targets: this.goGroup, alpha: 0,
      duration: ReducedMotion.duration(T_FADE),
      onComplete: () => this.goGroup.setVisible(false) });
  }
}

function px(maxPx: number, W: number, vw: number): number {
  return Math.min(maxPx, Math.round(W * vw));
}
