/**
 * LaneSystem — deterministic lane snap via Phaser tweens.
 *
 * Rules:
 * - LANE_POSITIONS computed from canvas width (never hardcoded)
 * - Snap via Phaser.Tweens, duration 120ms, Quad.easeOut
 * - One tween at a time — no chaining during move (input buffered by InputSystem)
 * - Lane index is integer, clamped [0, LANE_COUNT-1]
 * - Consumer calls update(dt) each frame to process buffer
 */
import Phaser from 'phaser';
import { GameConfig, computeLanePositions } from '../config/GameConfig.ts';
import type { InputSystem } from './InputSystem.ts';

export class LaneSystem {
  private scene: Phaser.Scene;
  private input: InputSystem;

  readonly positions: number[];
  private _lane: number;
  private _targetLane: number;
  private _isMoving = false;
  private _targetX: number;

  // The game object to tween (player sprite/container)
  private target: { x: number };

  // Lane highlight timer (ms) for visual confirmation
  private highlightTimer = 0;
  private readonly HIGHLIGHT_DURATION = 120;

  constructor(
    scene: Phaser.Scene,
    input: InputSystem,
    target: { x: number },
    startLane: number,
    canvasWidth: number,
  ) {
    this.scene = scene;
    this.input  = input;
    this.target = target;
    this.positions = computeLanePositions(canvasWidth, GameConfig.LANE_COUNT);

    this._lane = startLane;
    this._targetLane = startLane;
    this._targetX = this.positions[startLane];
    this.target.x = this._targetX;
  }

  get lane(): number { return this._lane; }
  get targetLane(): number { return this._targetLane; }
  get isMoving(): boolean { return this._isMoving; }

  /** Highlight alpha 0–1 for lane confirmation flash */
  get highlightAlpha(): number {
    return Math.max(0, this.highlightTimer / this.HIGHLIGHT_DURATION);
  }

  /** Call once per frame */
  update(delta: number) {
    if (this.highlightTimer > 0) this.highlightTimer -= delta;

    // Only consume input when not mid-tween
    if (this._isMoving) return;

    const intent = this.input.consume();
    if (intent === null) return;

    const next = Phaser.Math.Clamp(this._lane + intent, 0, GameConfig.LANE_COUNT - 1);
    if (next === this._lane) return;

    this._targetLane = next;
    this._targetX    = this.positions[next];
    this._isMoving   = true;
    this.highlightTimer = this.HIGHLIGHT_DURATION;

    this.scene.tweens.add({
      targets: this.target,
      x: this._targetX,
      duration: GameConfig.LANE_SNAP_DURATION_MS,
      ease: GameConfig.LANE_SNAP_EASE,
      onComplete: () => {
        this._lane     = next;
        this._isMoving = false;
        // Immediately process next buffered input on next update()
      },
    });
  }

  /** Instantly snap to a lane (e.g. on game reset) — no tween */
  snapTo(lane: number) {
    this.scene.tweens.killTweensOf(this.target);
    this._lane       = Phaser.Math.Clamp(lane, 0, GameConfig.LANE_COUNT - 1);
    this._targetLane = this._lane;
    this._targetX    = this.positions[this._lane];
    this.target.x    = this._targetX;
    this._isMoving   = false;
  }

  destroy() {
    this.scene.tweens.killTweensOf(this.target);
  }
}
