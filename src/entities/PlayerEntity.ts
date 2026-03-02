/**
 * PlayerEntity — player drone.
 *
 * Responsibilities:
 * - Visual representation (procedural rect + glow — no atlas in prototype)
 * - HP tracking and invuln frames
 * - Hit flash
 * - Blink during invuln
 * - Position driven by LaneSystem (x) and fixed Y
 */
import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig.ts';

export class PlayerEntity {
  readonly container: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Rectangle;
  private engine: Phaser.GameObjects.Rectangle;
  private detailTop: Phaser.GameObjects.Line;
  private detailMid: Phaser.GameObjects.Line;

  private _hp: number;
  private invulnTimer = 0;
  private hitFlashTimer = 0;
  private blinkTimer = 0;
  private readonly BLINK_INTERVAL = 80;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const w = GameConfig.PLAYER_WIDTH;
    const h = GameConfig.PLAYER_HEIGHT;

    // Body
    this.body = scene.add.rectangle(0, 0, w, h, 0x00ccdd);

    // Engine glow strip
    this.engine = scene.add.rectangle(0, h / 2 - 4, w / 2, 4, 0x00ffee);

    // Detail lines (drawn as thin rectangles — Line is unreliable in Phaser)
    this.detailTop = scene.add.line(0, 0, -w / 4, -h / 6, w / 4, -h / 6, 0x00ffee, 0.7);
    this.detailMid = scene.add.line(0, 0, -w / 4, h / 8,  w / 4, h / 8,  0x00ffee, 0.5);

    this.container = scene.add.container(x, y, [this.body, this.engine, this.detailTop, this.detailMid]);
    this.container.setDepth(20);

    this._hp = GameConfig.PLAYER_HP;
  }

  get hp(): number { return this._hp; }
  get isInvuln(): boolean { return this.invulnTimer > 0; }
  get isFlashing(): boolean { return this.hitFlashTimer > 0; }

  get x(): number { return this.container.x; }
  set x(v: number) { this.container.x = v; }

  /** Apply a hit. Returns true if now dead. */
  hit(): boolean {
    if (this.invulnTimer > 0) return false;
    this._hp -= 1;
    this.invulnTimer  = GameConfig.INVULN_DURATION_MS;
    this.hitFlashTimer = GameConfig.HIT_FLASH_DURATION_MS;
    return this._hp <= 0;
  }

  reset(x: number, y: number) {
    this._hp          = GameConfig.PLAYER_HP;
    this.invulnTimer  = 0;
    this.hitFlashTimer = 0;
    this.blinkTimer   = 0;
    this.container.setPosition(x, y);
    this.container.setAlpha(1);
    this.body.setFillStyle(0x00ccdd);
    this.engine.setFillStyle(0x00ffee);
  }

  /** Call each frame. delta in ms. */
  update(delta: number) {
    if (this.invulnTimer > 0) {
      this.invulnTimer  -= delta;
      this.hitFlashTimer -= delta;

      // Blink
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.BLINK_INTERVAL) {
        this.blinkTimer -= this.BLINK_INTERVAL;
        const visible = this.container.alpha > 0.5;
        this.container.setAlpha(visible ? 0.15 : 1);
      }
    } else {
      this.container.setAlpha(1);
      this.blinkTimer = 0;
    }

    // Colour
    if (this.hitFlashTimer > 0) {
      this.body.setFillStyle(0xff2200);
      this.engine.setFillStyle(0xff4400);
    } else if (this.invulnTimer <= 0) {
      this.body.setFillStyle(0x00ccdd);
      this.engine.setFillStyle(0x00ffee);
    }
  }

  destroy() {
    this.container.destroy();
  }
}
