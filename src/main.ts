/**
 * Swipe Salvage — Phaser 3 Entry Point
 *
 * Tech stack: Phaser 3.87+ + TypeScript + Vite (per T2 architecture doc)
 * Custom Phaser build excludes: Matter.js physics, Tilemaps, 3D
 */
import Phaser from 'phaser';
import { GameConfig } from './config/GameConfig.ts';
import { RunScene } from './scenes/RunScene.ts';
import { HUDScene } from './scenes/HUDScene.ts';
import { EncounterScene } from './scenes/EncounterScene.ts';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,         // WebGL → Canvas fallback
  backgroundColor: '#050810',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GameConfig.WIDTH,
    height: GameConfig.HEIGHT,
    parent: document.body,
  },
  fps: {
    target: GameConfig.TARGET_FPS,
    forceSetTimeOut: false,  // use rAF (better battery on mobile)
  },
  input: {
    activePointers: 1,       // single-pointer (no multi-touch needed for prototype)
    touch: {
      capture: true,         // prevent page scroll during swipe
    },
  },
  // Exclude unused Phaser modules for bundle size
  // (full custom build exclusion is done in vite.config + phaser custom build tool)
  physics: {
    default: 'arcade',
    arcade: {
      debug: GameConfig.DEBUG_HITBOXES,
      gravity: { x: 0, y: 0 },
    },
  },
  scene: [RunScene, HUDScene, EncounterScene],
};

// Boot
const game = new Phaser.Game(config);

// Expose for debugging and E2E tests
// In CI/E2E: always available. In PROD: gated by query param ?debug=1
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  (window as Window & { __game?: Phaser.Game }).__game = game;
}
