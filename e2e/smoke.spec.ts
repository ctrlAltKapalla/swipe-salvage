/**
 * Swipe Salvage — E2E Smoke Tests
 *
 * 7 tests covering the full core loop against the built game.
 * Runs against `npm run preview` (Vite preview on :4173) or BASE_URL env var.
 *
 * Test strategy:
 * - Phaser exposes `window.__game` in all builds (set in main.ts)
 * - RunScene exposes `window.__runScene` when active (set below via page.evaluate)
 * - Pixel sampling via Canvas.getImageData confirms non-blank frame
 * - Lane position read from Phaser scene registry via evaluate()
 *
 * Acceptance criteria:
 * - All 7 tests pass
 * - Suite completes in < 30s
 * - 0 console errors
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wait for Phaser game to be fully booted (window.__game present + canvas ready) */
async function waitForGame(page: Page, timeoutMs = 8000) {
  await page.waitForFunction(
    () => {
      const g = (window as any).__game;
      return g && g.isBooted && document.querySelector('canvas') !== null;
    },
    { timeout: timeoutMs },
  );
}

/** Tap center of screen to start the run */
async function tapToStart(page: Page) {
  const canvas = page.locator('canvas');
  await canvas.waitFor({ state: 'visible' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Wait for RunScene to be running (idle text gone)
  await page.waitForFunction(
    () => {
      const g = (window as any).__game;
      if (!g) return false;
      const scene = g.scene.getScene('RunScene');
      return scene && !scene.isIdle;
    },
    { timeout: 5000 },
  );
}

/** Sample a 10×10 block of pixels from canvas center; returns [r,g,b,a] average */
async function sampleCanvasPixels(page: Page): Promise<[number, number, number, number]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('no canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context'); // Phaser uses WebGL; need to read differently
    // For WebGL canvas, read from Phaser's renderer
    const g = (window as any).__game;
    if (!g) throw new Error('no game');
    const renderer = g.renderer;
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    // Phaser WebGL snapshot is async; use pixel buffer from canvas directly
    // (WebGL canvas: getContext('webgl') — use readPixels)
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
    if (gl) {
      const buf = new Uint8Array(4 * 10 * 10);
      (gl as WebGLRenderingContext).readPixels(cx - 5, cy - 5, 10, 10,
        (gl as WebGLRenderingContext).RGBA, (gl as WebGLRenderingContext).UNSIGNED_BYTE, buf);
      let r = 0, g2 = 0, b = 0, a = 0;
      for (let i = 0; i < 400; i += 4) { r += buf[i]; g2 += buf[i+1]; b += buf[i+2]; a += buf[i+3]; }
      const n = 100;
      return [r/n, g2/n, b/n, a/n] as [number, number, number, number];
    }
    // Canvas2D fallback
    const imgData = ctx.getImageData(cx - 5, cy - 5, 10, 10);
    let r = 0, g2 = 0, b = 0, a = 0;
    for (let i = 0; i < imgData.data.length; i += 4) {
      r += imgData.data[i]; g2 += imgData.data[i+1]; b += imgData.data[i+2]; a += imgData.data[i+3];
    }
    const n = 100;
    return [r/n, g2/n, b/n, a/n] as [number, number, number, number];
  });
}

/** Get the player X position from Phaser scene */
async function getPlayerX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const scene = g?.scene?.getScene('RunScene') as any;
    return scene?.player?.container?.x ?? scene?.laneSys?.positions?.[scene?.laneSys?.lane] ?? -1;
  });
}

/** Read HUD timer text from Phaser scene */
async function getTimerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const hud = g?.scene?.getScene('HUDScene') as any;
    return hud?.timerText?.text ?? '';
  });
}

// ── Console error collection ──────────────────────────────────────────────────
let consoleErrors: string[] = [];

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Swipe Salvage — Smoke Suite', () => {
  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err: Error) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });

    // ?debug=1 ensures window.__game is exposed (see main.ts)
    await page.goto('/?debug=1');
    await page.waitForLoadState('domcontentloaded');
  });

  // ── Test 1: Game boots ────────────────────────────────────────────────────
  test('1. Game boots — canvas present within 5s', async ({ page }) => {
    await waitForGame(page, 5000);
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Phaser game object exists and is booted
    const isBooted = await page.evaluate(() => !!(window as any).__game?.isBooted);
    expect(isBooted).toBe(true);
  });

  // ── Test 2: Canvas is not blank ───────────────────────────────────────────
  test('2. Canvas renders non-blank frame (background visible)', async ({ page }) => {
    await waitForGame(page);

    // Wait one rAF for first render
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    await page.waitForTimeout(200);

    const [r, g, b, a] = await sampleCanvasPixels(page);
    // Background is #050810 (very dark blue) — alpha should be 255
    // Any non-zero alpha means Phaser rendered something
    expect(a).toBeGreaterThan(0);
    // Should not be pure white (blank/broken)
    expect(r + g + b).toBeLessThan(700);
  });

  // ── Test 3: Input — swipe changes lane ────────────────────────────────────
  test('3. Swipe right → player moves to adjacent lane', async ({ page }) => {
    await waitForGame(page);
    await tapToStart(page);

    // Wait for game to actually be running
    await page.waitForTimeout(300);

    const x0 = await getPlayerX(page);
    expect(x0).toBeGreaterThan(0); // player placed correctly

    // Simulate swipe right: pointerdown → move 80px right → pointerup within 200ms
    const canvas = page.locator('canvas');
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.5;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(cx + 80, cy, { steps: 5 });
    await page.mouse.up();

    // Lane tween is 120ms — wait for it to complete
    await page.waitForTimeout(300);

    const x1 = await getPlayerX(page);
    expect(x1).toBeGreaterThan(x0); // moved right
  });

  // ── Test 4: Timer decreases ────────────────────────────────────────────────
  test('4. HUD timer counts down over 2s', async ({ page }) => {
    await waitForGame(page);
    await tapToStart(page);
    await page.waitForTimeout(500);

    const t0 = await getTimerText(page);
    await page.waitForTimeout(2000);
    const t1 = await getTimerText(page);

    // Both should be MM:SS format
    expect(t0).toMatch(/^\d{2}:\d{2}$/);
    expect(t1).toMatch(/^\d{2}:\d{2}$/);

    // t1 should be less than t0
    const toSeconds = (s: string) => {
      const [m, sec] = s.split(':').map(Number);
      return m * 60 + sec;
    };
    expect(toSeconds(t1)).toBeLessThan(toSeconds(t0));
  });

  // ── Test 5: Hazards spawn ─────────────────────────────────────────────────
  test('5. Hazards spawn within 5s of run start', async ({ page }) => {
    await waitForGame(page);
    await tapToStart(page);

    // Wait up to 5s for at least one active hazard
    await page.waitForFunction(
      () => {
        const g = (window as any).__game;
        const scene = g?.scene?.getScene('RunScene') as any;
        // SpawnerSystem exposes active group via spawner
        const spawner = scene?.spawner;
        if (!spawner) return false;
        const group = spawner._group ?? spawner.group;
        if (!group) return false;
        const active = group.getMatching?.('active', true) ?? [];
        return active.length > 0;
      },
      { timeout: 7000, polling: 500 },
    );

    // If we get here without timeout, hazards spawned
    const hazardCount = await page.evaluate(() => {
      const g = (window as any).__game;
      const scene = g?.scene?.getScene('RunScene') as any;
      const spawner = scene?.spawner;
      const group = spawner?._group ?? spawner?.group;
      const active = group?.getMatching?.('active', true) ?? [];
      return active.length;
    });

    expect(hazardCount).toBeGreaterThan(0);
  });

  // ── Test 6: Game over overlay ─────────────────────────────────────────────
  test('6. Game over overlay appears when HP reaches 0', async ({ page }) => {
    await waitForGame(page);
    await tapToStart(page);
    await page.waitForTimeout(300);

    // Force HP to 0 via RunStateManager dispatch
    await page.evaluate(() => {
      const g = (window as any).__game;
      const scene = g?.scene?.getScene('RunScene') as any;
      const wiring = scene?.wiring;
      if (wiring) {
        wiring.manager.dispatch({ type: 'TAKE_DAMAGE', damage: 10, isProjectile: false });
      }
    });

    // Game-over overlay should appear (HUDScene listens to game:over event)
    await page.waitForFunction(
      () => {
        const g = (window as any).__game;
        const hud = g?.scene?.getScene('HUDScene') as any;
        return hud?.goVisible === true;
      },
      { timeout: 3000 },
    );

    const goVisible = await page.evaluate(() => {
      const g = (window as any).__game;
      return (g?.scene?.getScene('HUDScene') as any)?.goVisible;
    });
    expect(goVisible).toBe(true);
  });

  // ── Test 7: No console errors ─────────────────────────────────────────────
  test('7. No console errors during boot and run', async ({ page }) => {
    await waitForGame(page);
    await tapToStart(page);
    await page.waitForTimeout(1000);

    // Filter known benign Phaser warnings
    const realErrors = consoleErrors.filter(e =>
      !e.includes('chunkSizeWarning') &&
      !e.includes('favicon') &&
      !e.includes('WARN'),
    );

    if (realErrors.length > 0) {
      console.log('Console errors captured:', realErrors);
    }
    expect(realErrors).toHaveLength(0);
  });
});
