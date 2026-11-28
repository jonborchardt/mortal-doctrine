import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { arenaCanvas } from './canvas';

const CAMERA_LAB = '/labs/camera';
// The fixture camera's visual bounds, in sub-units.
const BOUNDS = { left: -4000, right: 100_000 };
const SHAKE_OFFSET = /^-?\d+\.\d\d, -?\d+\.\d\d$/;

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const readout = (page: Page, key: string) => page.getByTestId(`camera-${key}`);
const number = async (page: Page, key: string) => Number(await readout(page, key).textContent());

/** Steps from frame `from` to frame `to`. */
async function stepTo(page: Page, from: number, to: number) {
  for (let i = from; i < to; i++) await button(page, 'Step').click();
  await expect(readout(page, 'frame')).toHaveText(String(to));
}

/** The visible span readouts are inside the bounds. */
async function expectInsideBounds(page: Page) {
  await expect
    .poll(async () => {
      const left = await number(page, 'left');
      const right = await number(page, 'right');
      return left >= BOUNDS.left && right <= BOUNDS.right && left < right;
    })
    .toBe(true);
}

test('camera lab is listed under Presentation and loads directly, paused at the fixture', async ({
  page,
}) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Labs' });
  await expect(nav.getByRole('link', { name: 'Camera Lab' })).toHaveAttribute('href', CAMERA_LAB);

  await page.goto(CAMERA_LAB);
  await expect(page.getByRole('heading', { name: 'Camera Lab' })).toBeVisible();
  // StrictMode mounts twice in development: a leaked renderer would leave a second canvas.
  await expect(page.getByRole('main').locator('canvas')).toHaveCount(1);
  await expect(arenaCanvas(page)).toHaveAttribute('width', '960');
  await expect(readout(page, 'frame')).toHaveText('0');
  await expect(button(page, 'Play')).toBeEnabled();
  // Fighters at 24000 and 72000: 70000 sub-units visible, centred on their midpoint.
  await expect(readout(page, 'scale')).toHaveText('1.3714');
  await expect(readout(page, 'left')).toHaveText('13000');
  await expect(readout(page, 'right')).toHaveText('83000');
  await expect(readout(page, 'midpoint')).toHaveText('48000');
  await expect(readout(page, 'bounds-left')).toHaveText(String(BOUNDS.left));
  await expect(readout(page, 'bounds-right')).toHaveText(String(BOUNDS.right));
  await expect(readout(page, 'shake')).toHaveText('0');
  await expect(page.getByRole('checkbox', { name: 'Overlays' })).toBeChecked();
  await expect(button(page, 'Shake: land')).toBeVisible();
  await expect(button(page, 'Shake: wall-contact')).toBeVisible();

  // Leaving the lab leaves no canvas behind.
  await nav.getByRole('link', { name: 'Audio Lab' }).click();
  await expect(page.getByRole('heading', { name: 'Audio Lab' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('separating fighters zooms out inside the bounds; Reset restores frame 0', async ({
  page,
}) => {
  await page.goto(CAMERA_LAB);
  await page.getByRole('combobox', { name: 'Scenario' }).selectOption('walk-back');
  await expect(readout(page, 'scale')).toHaveText('1.3714');

  // Player 1 walks back 400 a frame from 24000: the frame widens and pans left.
  await stepTo(page, 0, 3);
  await expect.poll(() => number(page, 'scale')).toBeLessThan(1.3714);
  const midway = await number(page, 'scale');
  await expectInsideBounds(page);
  await stepTo(page, 3, 6);
  await expect(readout(page, 'midpoint')).toHaveText('46800');
  await expect.poll(() => number(page, 'scale')).toBeLessThan(midway);
  await expect.poll(() => number(page, 'left')).toBeLessThan(13_000);
  await expectInsideBounds(page);
  // Target: pushbox edges 18600 and 75000 plus 8000 a side.
  await expect(readout(page, 'target-left')).toHaveText('10600');
  await expect(readout(page, 'target-right')).toHaveText('83000');

  await button(page, 'Reset').click();
  await expect(readout(page, 'frame')).toHaveText('0');
  await expect(readout(page, 'scale')).toHaveText('1.3714');
  await expect(readout(page, 'left')).toHaveText('13000');
  await expect(readout(page, 'right')).toHaveText('83000');
  await expect(readout(page, 'shake')).toHaveText('0');
  await expect(page.getByRole('combobox', { name: 'Scenario' })).toHaveValue('walk-back');
  await expect(page.getByRole('main').locator('canvas')).toHaveCount(1);
});

test('a jump zooms out while airborne and returns to the grounded framing after landing', async ({
  page,
}) => {
  await page.goto(CAMERA_LAB);
  await page.getByRole('combobox', { name: 'Scenario' }).selectOption('neutral-jump');
  await expect(readout(page, 'frame')).toHaveText('0');
  await expect(readout(page, 'scale')).toHaveText('1.3714');

  // The apex, 200 world units up, with 200 of headroom in the 460 px above the ground line:
  // 834.78 world units across.
  await stepTo(page, 0, 20);
  await expect(readout(page, 'scale')).toHaveText('1.1500');
  await expectInsideBounds(page);
  // The fighters have not moved sideways: the frame widened around the same midpoint.
  await expect(readout(page, 'midpoint')).toHaveText('48000');
  await expect(readout(page, 'target-left')).toHaveText('6261');
  await expect(readout(page, 'target-right')).toHaveText('89739');

  // Landed (frame 40) and converged: exactly the frame-0 framing again.
  await button(page, 'Play').click();
  await expect(readout(page, 'scale')).toHaveText('1.3714', { timeout: 20_000 });
  await expect(readout(page, 'left')).toHaveText('13000', { timeout: 20_000 });
  await button(page, 'Pause').click();
  await expect(readout(page, 'right')).toHaveText('83000');
  expect(await number(page, 'frame')).toBeGreaterThan(40);
});

test('a shake trigger shows on Step, decays to 0 after its duration and is cleared by Reset', async ({
  page,
}, testInfo) => {
  await page.goto(CAMERA_LAB);
  const shake = readout(page, 'shake');
  await expect(readout(page, 'frame')).toHaveText('0');

  // Paused: the trigger waits for the next tick.
  await button(page, 'Shake: land').click();
  await expect(shake).toHaveText('0');
  // `land` shakes for 12 frames: frames 1 to 12 are offset, frame 13 is at rest. The trace and
  // the first three frames are review evidence.
  const trace = ['walk-forward, paused at frame 0; "Shake: land" then Step'];
  for (let frame = 1; frame <= 13; frame++) {
    await stepTo(page, frame - 1, frame);
    await expect(shake).toHaveText(frame <= 12 ? SHAKE_OFFSET : '0');
    trace.push(`frame ${frame}: shake ${await shake.textContent()} px`);
    if (frame <= 3) {
      await arenaCanvas(page).screenshot({
        path: testInfo.outputPath(`camera-lab-shake-frame-${frame}.png`),
      });
    }
  }
  writeFileSync(testInfo.outputPath('camera-lab-shake-trace.txt'), `${trace.join('\n')}\n`);

  // Reset clears a shake in progress.
  await button(page, 'Shake: wall-contact').click();
  await stepTo(page, 13, 14);
  await expect(shake).toHaveText(SHAKE_OFFSET);
  await button(page, 'Reset').click();
  await expect(readout(page, 'frame')).toHaveText('0');
  await expect(shake).toHaveText('0');
  await stepTo(page, 0, 1);
  await expect(shake).toHaveText('0');
});

test('review evidence: far framing with overlays', async ({ page }, testInfo) => {
  await page.goto(CAMERA_LAB);
  await page.getByRole('combobox', { name: 'Scenario' }).selectOption('walk-back');
  await expect(readout(page, 'frame')).toHaveText('0');
  // Player 1 walks back to 8000 by frame 40; the scene is still from then on and the camera
  // converges on pushbox edges 5000 and 75000 plus 8000 a side.
  await button(page, 'Play').click();
  await expect(readout(page, 'left')).toHaveText('-3000', { timeout: 20_000 });
  await expect(readout(page, 'scale')).toHaveText('1.1163', { timeout: 20_000 });
  await button(page, 'Pause').click();
  await expect(readout(page, 'right')).toHaveText('83000');
  await expect(readout(page, 'midpoint')).toHaveText('40000');
  await page.screenshot({ path: testInfo.outputPath('camera-lab-far-walk-back.png') });
});

test('review evidence: near framing at a bound with overlays, and a shake there', async ({
  page,
}, testInfo) => {
  await page.goto(CAMERA_LAB);
  // Player 1 pushes player 2 into the right corner (frame 209): closest zoom, at the bound.
  await page.getByRole('combobox', { name: 'Scenario' }).selectOption('corner-push');
  await expect(readout(page, 'frame')).toHaveText('0');
  await button(page, 'Play').click();
  // The fighters stop at 87000 and 93000; the camera reaches the bound before they do.
  await expect(readout(page, 'midpoint')).toHaveText('90000', { timeout: 20_000 });
  await expect(readout(page, 'scale')).toHaveText('2.0000', { timeout: 20_000 });
  await button(page, 'Pause').click();
  await expect(readout(page, 'left')).toHaveText('52000');
  await expect(readout(page, 'right')).toHaveText(String(BOUNDS.right));
  await page.screenshot({ path: testInfo.outputPath('camera-lab-near-corner-push.png') });

  // A shake against the right bound: the offset is non-zero, the visible span stays inside.
  await button(page, 'Shake: land').click();
  await button(page, 'Step').click();
  await expect(readout(page, 'shake')).toHaveText(SHAKE_OFFSET);
  await expectInsideBounds(page);

  // Overlays off: still one canvas.
  await page.getByRole('checkbox', { name: 'Overlays' }).uncheck();
  await expect(page.getByRole('main').locator('canvas')).toHaveCount(1);
});
