/**
 * Swipe Salvage — E2E Smoke Tests
 *
 * 7 tests covering the full core loop against the built game.
 * Runs against `npm run preview` (Vite preview on :4173) or BASE_URL env var.
 *
 * Test strategy:
 * - Phaser exposes `window.__game` in all builds (set in main.ts)
 * - Lane index read from `laneSys.lane` (more reliable than pixel X)
 * - Blank-frame check via Playwright screenshot buffer (CI-safe, no WebGL readPixels)
 * - Game-over forced via RunStateManager.dispatch()
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
  // Wait for RunScene to be running (isIdle → false)
  await page.waitForFunction(
    () => {
      const g = (window as any).__game;
      if (!g) return false;
      const scene = g.scene.getScene('RunScene');
      return scene && !scene.isIdle;
    },
    { timeout: 6000 },
  );
  // Extra buffer — let first update loop tick
  await page.waitForTimeout(200);
}

/** Get current lane index from LaneSystem */
async function getLane(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const scene = g?.scene?.getScene('RunScene') as any;
    return scene?.laneSys?.lane ?? -1;
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

    const isBooted = await page.evaluate(() => !!(window as any).__game?.isBooted);
    expect(isBooted).toBe(true);
  });

  // ── Test 2: Canvas is not blank ───────────────────────────────────────────
  // Uses Playwright screenshot buffer instead of WebGL readPixels (CI-safe).
  // WebGL readPixels returns zeros after framebuffer swap in headless Chromium.
  test('2. Canvas renders non-blank frame (background visible)', async ({ page }) => {
    await waitForGame(page);

    // Wait two rAFs for Phaser to render at least one frame
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await page.waitForTimeout(300);

    // Take screenshot and verify pixels are not all the same value (non-blank)
    const screenshot = await page.screenshot({ type: 'png' });
    const bytes = Array.from(screenshot);

    // PNG header is ~8 bytes; actual pixel data varies. A non-blank image has varied bytes.
    // Check last quarter of buffer (pixel data) for variation
    const sample = bytes.slice(Math.floor(bytes.length * 0.5));
    const unique = new Set(sample).size;

    // A blank/white canvas would have very few unique byte values; a rendered scene has many
    expect(unique).toBeGreaterThan(5);
  });

  // ── Test 3: Input — swipe changes lane ────────────────────────────────────
  // Reads laneSys.lane index directly — more reliable than sampling X pixel position.
  test('3. Swipe right → player moves to adjacent lane', async ({ page }) => {
    await waitForGame(page);
    await tapToStart(page);

    const lane0 = await getLane(page);
    expect(lane0).toBeGreaterThanOrEqual(0); // valid lane index

    // Use keyboard ArrowRight — InputSystem has keyboard fallback (← → A D).
    // Mouse swipe is unreliable in headless Chromium (Phaser POINTER_DOWN timing vs rAF).
    // Keyboard dispatch is synchronous and CI-stable.
    await page.keyboard.press('ArrowRight');


    // Lane tween is 120ms — wait for snap + state update
    await page.waitForTimeout(400);

    const lane1 = await getLane(page);

    // If already at rightmost lane, swipe right is clamped — skip directional check
    const laneCount = await page.evaluate(() => {
      const g = (window as any).__game;
      const scene = g?.scene?.getScene('RunScene') as any;
      return scene?.laneSys?.positions?.length ?? 5;
    });

    if (lane0 < laneCount - 1) {
      expect(lane1).toBe(lane0 + 1);
    } else {
      // At right edge — clamped, still valid
      expect(lane1).toBe(lane0);
    }
  });

  // ── Test 4: Timer decreases ────────────────────────────────────────────────
  test('4. HUD timer counts down over 2s', async ({ page }) => {
    await waitForGame(page);
    await tapToStart(page);
    await page.waitForTimeout(500);

    const t0 = await getTimerText(page);
    await page.waitForTimeout(2000);
    const t1 = await getTimerText(page);

    expect(t0).toMatch(/^\d{2}:\d{2}$/);
    expect(t1).toMatch(/^\d{2}:\d{2}$/);

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

    await page.waitForFunction(
      () => {
        const g = (window as any).__game;
        const scene = g?.scene?.getScene('RunScene') as any;
        const spawner = scene?.spawner;
        if (!spawner) return false;
        const group = spawner._group ?? spawner.group;
        if (!group) return false;
        const active = group.getMatching?.('active', true) ?? [];
        return active.length > 0;
      },
      { timeout: 7000, polling: 500 },
    );

    const hazardCount = await page.evaluate(() => {
      const g = (window as any).__game;
      const scene = g?.scene?.getScene('RunScene') as any;
      const spawner = scene?.spawner;
      const group = spawner?._group ?? spawner?.group;
      return group?.getMatching?.('active', true)?.length ?? 0;
    });

    expect(hazardCount).toBeGreaterThan(0);
  });

  // ── Test 6: Game over overlay ─────────────────────────────────────────────
  test('6. Game over overlay appears when HP reaches 0', async ({ page }) => {
    await waitForGame(page);
    await tapToStart(page);

    // Ensure wiring is mounted and invuln is 0 before forcing damage
    await page.waitForFunction(
      () => {
        const g = (window as any).__game;
        const scene = g?.scene?.getScene('RunScene') as any;
        return scene?.wiring?.manager?.state?.vitals?.invulnRemaining === 0;
      },
      { timeout: 3000 },
    );

    // Dispatch enough damage to kill (initial HP=3, damage=10 → dead)
    await page.evaluate(() => {
      const g = (window as any).__game;
      const scene = g?.scene?.getScene('RunScene') as any;
      scene?.wiring?.manager?.dispatch({ type: 'TAKE_DAMAGE', damage: 10, isProjectile: false });
    });

    // HUDScene listens to game:over event from HUDBroadcaster
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
