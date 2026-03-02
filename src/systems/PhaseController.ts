/**
 * PhaseController — manages run phase transitions and scroll speed.
 *
 * Phases (from GameConfig):
 *   0: WARM-UP  (0–30s)  — speed × 1.0
 *   1: MID      (30–90s) — speed × 1.4
 *   2: CLIMAX   (90–120s)— speed × 2.0
 *
 * Speed ramp: smooth lerp over SPEED_RAMP_DURATION_S at each boundary.
 */
import { GameConfig } from '../config/GameConfig.ts';
import type { PhaseIndex } from '../config/GameConfig.ts';

export class PhaseController {
  private elapsedS = 0;
  private _phase: PhaseIndex = 0;
  private displaySpeed = GameConfig.BASE_SCROLL_SPEED;
  private targetSpeed  = GameConfig.BASE_SCROLL_SPEED;
  private rampFrom     = GameConfig.BASE_SCROLL_SPEED;
  private rampElapsed  = 0;
  private ramping      = false;

  reset() {
    this.elapsedS     = 0;
    this._phase       = 0;
    this.displaySpeed = GameConfig.BASE_SCROLL_SPEED;
    this.targetSpeed  = GameConfig.BASE_SCROLL_SPEED;
    this.rampFrom     = GameConfig.BASE_SCROLL_SPEED;
    this.rampElapsed  = 0;
    this.ramping      = false;
  }

  /** Call each frame with delta in seconds. Returns updated phase state. */
  update(delta: number): { phase: PhaseIndex; speed: number; elapsed: number } {
    this.elapsedS += delta;

    const newPhase: PhaseIndex =
      this.elapsedS >= GameConfig.PHASE_TIMINGS_S[2] ? 2 :
      this.elapsedS >= GameConfig.PHASE_TIMINGS_S[1] ? 1 : 0;

    if (newPhase !== this._phase) {
      this._phase      = newPhase;
      this.rampFrom    = this.displaySpeed;
      this.targetSpeed = GameConfig.BASE_SCROLL_SPEED * GameConfig.PHASE_SPEED_MULT[newPhase];
      this.rampElapsed = 0;
      this.ramping     = true;
    }

    if (this.ramping) {
      this.rampElapsed += delta;
      const t = Math.min(this.rampElapsed / GameConfig.SPEED_RAMP_DURATION_S, 1);
      // Smooth step for speed ramp
      const ease = t * t * (3 - 2 * t);
      this.displaySpeed = this.rampFrom + (this.targetSpeed - this.rampFrom) * ease;
      if (t >= 1) {
        this.displaySpeed = this.targetSpeed;
        this.ramping = false;
      }
    }

    return { phase: this._phase, speed: this.displaySpeed, elapsed: this.elapsedS };
  }

  /**
   * Alternative update when elapsed is driven externally (e.g. by RunStateManager TICK).
   * Computes delta from new vs current elapsed, then runs normal update.
   */
  updateFromElapsed(elapsedS: number): { phase: PhaseIndex; speed: number; elapsed: number } {
    const delta = Math.max(0, elapsedS - this.elapsedS);
    return this.update(delta);
  }

  get phase(): PhaseIndex { return this._phase; }
  get speed(): number { return this.displaySpeed; }
  get elapsed(): number { return this.elapsedS; }
  get phaseLabel(): string { return GameConfig.PHASE_NAMES[this._phase]; }
}
