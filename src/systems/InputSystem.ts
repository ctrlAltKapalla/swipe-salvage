/**
 * InputSystem — unified swipe/tap/keyboard input.
 *
 * Key behaviours:
 * - Swipe: horizontal delta ≥ SWIPE_THRESHOLD_PX within SWIPE_MAX_DURATION_MS
 * - Tap: pointer up with < TAP_MAX_MOVE_PX movement
 * - Buffer queue depth: INPUT_BUFFER_DEPTH — prevents dropped inputs during frame hitches
 * - Keyboard: ← → A D as fallback
 * - Module tap: fires 'module_tap' event (consumed by PlayerSystem)
 */
import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig.ts';

export type LaneIntent = -1 | 1;   // -1 = left, 1 = right

export class InputSystem {
  private scene: Phaser.Scene;
  private buffer: LaneIntent[] = [];

  // Touch tracking
  private touchStartX = 0;
  private touchStartY = 0;
  private touchStartTime = 0;
  private pointerDown = false;

  // Events emitted to scene (consumed by PlayerSystem)
  static readonly EVT_LANE   = 'input:lane';
  static readonly EVT_TAP    = 'input:tap';

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.bind();
  }

  // ── Binding ──────────────────────────────────────────────────────────────
  private bind() {
    const input = this.scene.input;

    // Pointer events (touch + mouse unified)
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    input.on(Phaser.Input.Events.POINTER_UP,   this.onUp,   this);

    // Keyboard fallback
    const kb = this.scene.input.keyboard;
    if (kb) {
      kb.on('keydown-LEFT',  () => this.enqueue(-1));
      kb.on('keydown-RIGHT', () => this.enqueue(1));
      kb.on('keydown-A',     () => this.enqueue(-1));
      kb.on('keydown-D',     () => this.enqueue(1));
    }
  }

  private onDown(pointer: Phaser.Input.Pointer) {
    this.touchStartX    = pointer.x;
    this.touchStartY    = pointer.y;
    this.touchStartTime = pointer.downTime;
    this.pointerDown    = true;
  }

  private onUp(pointer: Phaser.Input.Pointer) {
    if (!this.pointerDown) return;
    this.pointerDown = false;

    const dx       = pointer.x - this.touchStartX;
    const dy       = pointer.y - this.touchStartY;
    const dist     = Math.sqrt(dx * dx + dy * dy);
    const duration = pointer.upTime - this.touchStartTime;

    // Swipe: horizontal dominance, threshold met, within time window
    if (
      Math.abs(dx) >= GameConfig.SWIPE_THRESHOLD_PX &&
      Math.abs(dx) > Math.abs(dy) &&
      duration <= GameConfig.SWIPE_MAX_DURATION_MS
    ) {
      this.enqueue(dx > 0 ? 1 : -1);
      return;
    }

    // Tap: minimal movement
    if (dist < GameConfig.TAP_MAX_MOVE_PX) {
      this.scene.events.emit(InputSystem.EVT_TAP, { x: pointer.x, y: pointer.y });
    }
  }

  /** Add a lane intent to the buffer (respects depth cap) */
  private enqueue(intent: LaneIntent) {
    if (this.buffer.length < GameConfig.INPUT_BUFFER_DEPTH) {
      this.buffer.push(intent);
    }
    // If buffer full: silently drop oldest and add newest (prefer recency)
    else {
      this.buffer.shift();
      this.buffer.push(intent);
    }
  }

  /** Consume next lane intent from buffer. Returns null if empty. */
  consume(): LaneIntent | null {
    return this.buffer.shift() ?? null;
  }

  /** Peek — is there anything queued? */
  hasPending(): boolean {
    return this.buffer.length > 0;
  }

  destroy() {
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP,   this.onUp,   this);
    this.buffer = [];
  }
}
