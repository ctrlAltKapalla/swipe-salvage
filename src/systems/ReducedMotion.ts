/**
 * ReducedMotion — system preference + in-game toggle.
 *
 * Usage:
 *   ReducedMotion.ok              → true = animations allowed
 *   ReducedMotion.duration(ms)    → returns ms OR 0 if reduced
 *   ReducedMotion.setReduced(bool)→ in-game toggle override
 *
 * Wire into Phaser tweens: `duration: ReducedMotion.duration(300)`
 * When reduced: tween runs at duration 0 = instant snap, no animation.
 */
const mq = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

let _override: boolean | null = null;

export const ReducedMotion = {
  get ok(): boolean {
    if (_override !== null) return !_override;
    return !(mq?.matches ?? false);
  },

  /** Returns `ms` if animations allowed, else `0` (instant) */
  duration(ms: number): number {
    return this.ok ? ms : 0;
  },

  /** In-game settings toggle */
  setReduced(reduced: boolean): void {
    _override = reduced;
  },

  reset(): void {
    _override = null;
  },
};
