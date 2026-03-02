/**
 * EncounterScene — per T2 §3 scene inventory.
 *
 * Handles:
 *   - Risk Gate: 2–3 choice cards, min 44px touch targets, outcome preview
 *   - Shop Drone: stub overlay
 *
 * Lifecycle:
 *   - Always resident (launched at game start, sleeps until needed)
 *   - Activated via `game.events.emit('encounter:open', data)`
 *   - Pauses RunScene while active; resumes on close
 *   - Communicates result via `game.events.emit('encounter:result', { id, choice })`
 *
 * Design rules (GDD §10.1):
 *   - Cards min 44px height (touch target compliance)
 *   - Clear risk badge per option (LOW / MED / HIGH)
 *   - Outcome preview text on each card
 */
import Phaser from 'phaser';
import { ReducedMotion } from '../systems/ReducedMotion.ts';

export const ENCOUNTER_SCENE_KEY = 'EncounterScene';

export type EncounterType = 'risk_gate' | 'shop_drone';

export interface RiskOption {
  id: string;
  label: string;
  detail: string;
  risk: 'low' | 'med' | 'high';
}

export interface EncounterData {
  type: EncounterType;
  options?: RiskOption[];   // risk_gate only
}

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  BG:       0x000510,
  ACCENT:   0x00ffee,
  WARN:     0xffcc00,
  DANGER:   0xff5500,
  CARD_BG:  0x0a1828,
  LOW:      0x00ff88,
  MED:      0xffcc00,
  HIGH:     0xff4400,
  TEXT:     0xcceeff,
  DIM:      0x446677,
} as const;

const FONT     = "'Courier New'";
const CARD_H   = 72;   // ≥44px touch target
const CARD_GAP = 12;
const ANIM_MS  = 220;

export class EncounterScene extends Phaser.Scene {
  private bg!: Phaser.GameObjects.Rectangle;
  private titleText!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;
  private cards: Phaser.GameObjects.Container[] = [];
  private closeBtn!: Phaser.GameObjects.Text;
  private _data: EncounterData | null = null;

  constructor() {
    super({ key: ENCOUNTER_SCENE_KEY, active: false });
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    // Full-screen dim
    // NOT interactive at create-time — only enabled during open() to avoid
    // blocking RunScene pointer events on the start screen (bug fix T-79ccda48)
    this.bg = this.add.rectangle(W / 2, H / 2, W, H, C.BG, 0)
      .setDepth(300);

    // Title + subtitle (populated on open)
    this.titleText = this.add.text(W / 2, H * 0.28, '', {
      fontFamily: FONT,
      fontSize: `${Math.min(28, W * 0.072)}px`,
      color: '#00ffee',
      fontStyle: 'bold',
      letterSpacing: 3,
    }).setOrigin(0.5).setDepth(301).setShadow(0, 0, '#00ffee', 10).setAlpha(0);

    this.subText = this.add.text(W / 2, H * 0.34, '', {
      fontFamily: FONT,
      fontSize: `${Math.min(12, W * 0.03)}px`,
      color: '#446677',
      letterSpacing: 3,
    }).setOrigin(0.5).setDepth(301).setAlpha(0);

    // Skip/close
    this.closeBtn = this.add.text(W / 2, H * 0.88, '[ SKIP ]', {
      fontFamily: FONT,
      fontSize: `${Math.min(13, W * 0.033)}px`,
      color: '#446677',
      letterSpacing: 3,
    }).setOrigin(0.5).setDepth(302).setAlpha(0)
      // NOT interactive at create-time — enabled in open(), disabled in close()
      ;

    this.closeBtn.on(Phaser.Input.Events.POINTER_UP, () => this.close());

    // Listen for open events from any scene
    this.game.events.on('encounter:open', this.open, this);
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('encounter:open', this.open, this);
    });
  }

  // ── Open ──────────────────────────────────────────────────────────────────
  private open(data: EncounterData) {
    this._data = data;
    this.scene.bringToTop();
    this.clearCards();
    // Enable hit-blocks only while encounter is open
    this.bg.setInteractive();
    this.closeBtn.setInteractive({ useHandCursor: true });

    if (data.type === 'risk_gate') {
      this.buildRiskGate(data.options ?? []);
    } else {
      this.buildShopDrone();
    }

    // Fade in
    const dur = ReducedMotion.duration(ANIM_MS);
    this.tweens.add({ targets: this.bg, alpha: 0.88, duration: dur });
    this.tweens.add({ targets: [this.titleText, this.subText, this.closeBtn], alpha: 1, duration: dur });
  }

  // ── Risk Gate ─────────────────────────────────────────────────────────────
  private buildRiskGate(options: RiskOption[]) {
    const W = this.scale.width;
    const maxCardW = Math.min(340, W - 32);
    const cardX = W / 2;
    const startY = this.scale.height * 0.42;

    this.titleText.setText('⚠  RISK GATE');
    this.subText.setText('CHOOSE YOUR PATH');

    options.forEach((opt, i) => {
      const cy = startY + i * (CARD_H + CARD_GAP) + CARD_H / 2;

      // Card background
      const cardBg = this.add.rectangle(cardX, cy, maxCardW, CARD_H, C.CARD_BG)
        .setStrokeStyle(1.5, this.riskColor(opt.risk), 0.6)
        .setDepth(302).setAlpha(0)
        .setInteractive({ useHandCursor: true });

      // Label
      const labelTxt = this.add.text(cardX - maxCardW / 2 + 16, cy - 12, opt.label, {
        fontFamily: FONT,
        fontSize: `${Math.min(17, W * 0.043)}px`,
        color: '#cceeff',
        fontStyle: 'bold',
      }).setOrigin(0, 0.5).setDepth(303).setAlpha(0);

      // Detail / outcome preview
      const detailTxt = this.add.text(cardX - maxCardW / 2 + 16, cy + 12, opt.detail, {
        fontFamily: FONT,
        fontSize: `${Math.min(11, W * 0.028)}px`,
        color: '#446677',
      }).setOrigin(0, 0.5).setDepth(303).setAlpha(0);

      // Risk badge (right-aligned)
      const badge = this.add.text(cardX + maxCardW / 2 - 12, cy, opt.risk.toUpperCase(), {
        fontFamily: FONT,
        fontSize: '9px',
        color: Phaser.Display.Color.IntegerToColor(this.riskColor(opt.risk)).rgba,
        backgroundColor: `rgba(${this.riskColorRGB(opt.risk)},0.15)`,
        padding: { x: 5, y: 2 },
        letterSpacing: 2,
      }).setOrigin(1, 0.5).setDepth(303).setAlpha(0);

      const dur = ReducedMotion.duration(ANIM_MS);
      this.tweens.add({ targets: [cardBg, labelTxt, detailTxt, badge], alpha: 1, duration: dur, delay: i * 60 });

      // Hover / active feedback
      cardBg.on(Phaser.Input.Events.POINTER_OVER, () => {
        if (ReducedMotion.ok) cardBg.setFillStyle(0x0d2035);
      });
      cardBg.on(Phaser.Input.Events.POINTER_OUT, () => {
        cardBg.setFillStyle(C.CARD_BG);
      });
      cardBg.on(Phaser.Input.Events.POINTER_UP, () => {
        this.choose(opt.id);
      });

      this.cards.push(this.add.container(0, 0, [cardBg, labelTxt, detailTxt, badge]));
    });
  }

  // ── Shop Drone ────────────────────────────────────────────────────────────
  private buildShopDrone() {
    const W = this.scale.width;
    this.titleText.setText('🛸  SHOP DRONE');
    this.subText.setText('SPEND YOUR ENERGY');

    const stub = this.add.text(W / 2, this.scale.height * 0.52, '[ Shop coming in T6+ ]', {
      fontFamily: FONT,
      fontSize: `${Math.min(14, W * 0.036)}px`,
      color: '#446677',
      letterSpacing: 2,
    }).setOrigin(0.5).setDepth(302).setAlpha(0);

    const dur = ReducedMotion.duration(ANIM_MS);
    this.tweens.add({ targets: stub, alpha: 1, duration: dur });
    this.cards.push(this.add.container(0, 0, [stub]));
  }

  // ── Choose / close ────────────────────────────────────────────────────────
  private choose(optionId: string) {
    // Dispatch RunAction via EventBus → RunScene → RunStateManager (T2 §3.2)
    if (this._data?.type === 'risk_gate') {
      this.game.events.emit('run:action', {
        type: 'CHOOSE_RISK_GATE',
        optionId,
        encounterSeed: Date.now(),
      });
    } else if (this._data?.type === 'shop_drone') {
      // Shop purchase — stub (itemId/cost defined by T6 shop data)
      this.game.events.emit('run:action', {
        type: 'SHOP_PURCHASE',
        itemId: optionId,
        cost: { scrap: 0 },
      });
    }
    this.game.events.emit('encounter:result', { type: this._data?.type, choice: optionId });
    this.close();
  }

  private close() {
    const dur = ReducedMotion.duration(ANIM_MS);
    this.tweens.add({
      targets: [this.bg, this.titleText, this.subText, this.closeBtn],
      alpha: 0,
      duration: dur,
      onComplete: () => {
        this.clearCards();
        // Remove hit-blocks so RunScene receives pointer events again
        this.bg.disableInteractive();
        this.closeBtn.disableInteractive();
        this.game.events.emit('encounter:closed');
      },
    });
  }

  private clearCards() {
    this.cards.forEach(c => c.destroy());
    this.cards = [];
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private riskColor(risk: RiskOption['risk']): number {
    return risk === 'low' ? C.LOW : risk === 'med' ? C.MED : C.HIGH;
  }

  private riskColorRGB(risk: RiskOption['risk']): string {
    return risk === 'low' ? '0,255,136' : risk === 'med' ? '255,204,0' : '255,68,0';
  }
}
