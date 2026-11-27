import { expect, test, type Page } from '@playwright/test';

const INPUT_LAB = '/labs/input';

// The page's global object as the gamepad stub sees it (this file is typechecked without DOM).
interface Host {
  __pads: unknown[];
  navigator: { getGamepads: () => unknown[] };
}

interface PadState {
  readonly buttons?: readonly number[];
  readonly axes?: readonly number[];
}

/** Headless browsers have no gamepads: serve them from a page global the test can set. */
async function stubGamepads(page: Page) {
  await page.addInitScript(() => {
    const host = globalThis as unknown as Host;
    host.__pads = [];
    host.navigator.getGamepads = () => host.__pads;
  });
}

async function setGamepads(page: Page, pads: readonly (PadState | null)[]) {
  await page.evaluate((states) => {
    (globalThis as unknown as Host).__pads = states.map(
      (state) =>
        state && {
          connected: true,
          buttons: Array.from({ length: 17 }, (_, index) => ({
            pressed: (state.buttons ?? []).includes(index),
          })),
          axes: state.axes ?? [0, 0, 0, 0],
        },
    );
  }, pads);
}

/** Pauses and resets, so the sampled-frame readouts start empty at tick 0. */
async function pausedAtZero(page: Page) {
  await page.goto(INPUT_LAB);
  const tick = page.getByTestId('input-tick');
  await expect.poll(async () => Number(await tick.textContent())).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(tick).toHaveText('0');
}

test('input lab is linked from navigation and loads directly', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: 'Labs' }).getByRole('link', { name: 'Input Lab' }),
  ).toHaveAttribute('href', INPUT_LAB);

  await page.goto(INPUT_LAB);
  await expect(page.getByRole('heading', { name: 'Input Lab' })).toBeVisible();
  await expect(page.getByTestId('input-raw-p1')).toContainText('keys none');
  await expect(page.getByTestId('input-raw-p2')).toContainText('gamepad 0: not connected');
});

test('a keyboard tap between ticks lands in exactly one sampled frame', async ({ page }) => {
  await pausedAtZero(page);
  const step = page.getByRole('button', { name: 'Step' });
  const raw = page.getByTestId('input-raw-p1');
  const frames = page.getByTestId('input-frames-p1');
  const latched = page.getByTestId('input-latched-p1');
  const taps = page.getByTestId('input-taps').getByRole('listitem');

  await page.keyboard.down('KeyD');
  await expect(raw).toContainText('keys KeyD');
  await page.keyboard.up('KeyD');
  await expect(raw).toContainText('keys none');
  await expect(latched).toHaveText('RIGHT');
  await expect(frames).toBeEmpty();

  await step.click();
  await expect(frames).toHaveText('RIGHT');
  await expect(latched).toHaveText('·');
  await expect(taps).toHaveText(['tick 0: P1 RIGHT']);

  await step.click();
  await step.click();
  await expect(page.getByTestId('input-tick')).toHaveText('3');
  await expect(frames).toHaveText('RIGHT · ·');
  await expect(taps).toHaveCount(1);
  await expect(page.getByTestId('input-frames-p2')).toHaveText('· · ·');
});

test('a held key is sampled every tick and is not a tap', async ({ page }) => {
  await pausedAtZero(page);
  const step = page.getByRole('button', { name: 'Step' });
  await page.keyboard.down('KeyU');
  await step.click();
  await step.click();
  await page.keyboard.up('KeyU');
  await step.click();
  await expect(page.getByTestId('input-frames-p1')).toHaveText('A1 A1 ·');
  await expect(page.getByTestId('input-taps').getByRole('listitem')).toHaveCount(0);
});

test('a stubbed gamepad drives only its assigned player', async ({ page }) => {
  await stubGamepads(page);
  await pausedAtZero(page);
  const step = page.getByRole('button', { name: 'Step' });
  const raw2 = page.getByTestId('input-raw-p2');
  const p1 = page.getByTestId('input-frames-p1');
  const p2 = page.getByTestId('input-frames-p2');

  // Gamepad 0 is player two's by default: A button and d-pad left, then the stick up and right.
  await setGamepads(page, [{ buttons: [0, 14] }]);
  await expect(raw2).toContainText('gamepad 0: buttons 0, 14');
  await step.click();
  await setGamepads(page, [{ axes: [0.9, -0.9] }]);
  await expect(raw2).toContainText('stick 0.90 / -0.90');
  await step.click();
  await setGamepads(page, [{ axes: [0.3, -0.3] }]); // inside the deadzone
  await expect(raw2).toContainText('stick 0.30 / -0.30');
  await step.click();
  await expect(p2).toHaveText('LEFT+A4 RIGHT+UP ·');
  await expect(p1).toHaveText('· · ·');

  // Gamepad 1 is player one's.
  await setGamepads(page, [null, { buttons: [2, 15] }]);
  await expect(raw2).toContainText('gamepad 0: not connected');
  await expect(page.getByTestId('input-raw-p1')).toContainText('gamepad 1: buttons 2, 15');
  await step.click();
  await expect(p1).toHaveText('· · · RIGHT+A1');
  await expect(p2).toHaveText('LEFT+A4 RIGHT+UP · ·');
});

test('both players are active at once without crosstalk', async ({ page }, testInfo) => {
  await stubGamepads(page);
  await pausedAtZero(page);
  const step = page.getByRole('button', { name: 'Step' });
  const raw1 = page.getByTestId('input-raw-p1');
  const raw2 = page.getByTestId('input-raw-p2');

  // Tick 0: player one on the keyboard (hold A, tap J), player two on a gamepad.
  await page.keyboard.down('KeyA');
  await page.keyboard.press('KeyJ');
  await setGamepads(page, [{ buttons: [15, 3] }]);
  await expect(raw2).toContainText('buttons 3, 15');
  await step.click();
  await expect(page.getByTestId('input-tick')).toHaveText('1');
  // Tick 1: both on the same keyboard with disjoint key sets (player two holds 6, taps 1).
  await page.keyboard.down('Numpad6');
  await page.keyboard.press('Digit1');
  await setGamepads(page, [{ buttons: [3] }]);
  await expect(raw2).toContainText('keys Numpad6 · gamepad 0: buttons 3,');
  await step.click();

  await expect(page.getByTestId('input-frames-p1')).toHaveText('LEFT+A4 LEFT');
  await expect(page.getByTestId('input-frames-p2')).toHaveText('RIGHT+A2 RIGHT+A1+A2');
  await expect(page.getByTestId('input-taps').getByRole('listitem')).toHaveText([
    'tick 1: P2 A1',
    'tick 0: P1 A4',
  ]);
  await expect(raw1).toContainText('keys KeyA');
  // Review evidence: the lab with both players active.
  await page.screenshot({ path: testInfo.outputPath('input-lab-both-players.png') });
  await page.keyboard.up('KeyA');
  await page.keyboard.up('Numpad6');
});
