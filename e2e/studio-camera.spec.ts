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

async function stepTo(page: Page, frame: number) {
  const current = await number(page, 'frame');
  for (let i = current; i < frame; i++) await button(page, 'Step').click();
  await expect(readout(page, 'frame')).toHaveText(String(frame));
}

/** The visible span readouts are inside the bounds readouts. */
async function expectInsideBounds(page: Page) {
  await expect
    .poll(async () => {
      const left = await number(page, 'left');
      const right = await number(page, 'right');
      const boundsLeft = await number(page, 'bounds-left');
      const boundsRight = await number(page, 'bounds-right');
      return left >= boundsLeft && right <= boundsRight && left < right;
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

  // Player 1 walks back 40 frames, 24000 → 8000: the frame widens and pans left.
  await stepTo(page, 20);
  await expect.poll(() => number(page, 'scale')).toBeLessThan(1.3714);
  const midway = await number(page, 'scale');
  await expectInsideBounds(page);
  await stepTo(page, 40);
  await expect(readout(page, 'midpoint')).toHaveText('40000');
  await expect.poll(() => number(page, 'scale')).toBeLessThan(midway);
  await expect.poll(() => number(page, 'left')).toBeLessThan(13_000);
  await expectInsideBounds(page);
  // Target: pushbox edges 5000 and 75000 plus 8000 a side.
  await expect(readout(page, 'target-left')).toHaveText('-3000');
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

test('a shake trigger shows on Step, decays to 0 after its duration and is cleared by Reset', async ({
  page,
}) => {
  await page.goto(CAMERA_LAB);
  const shake = readout(page, 'shake');
  await expect(readout(page, 'frame')).toHaveText('0');

  // Paused: the trigger waits for the next tick.
  await button(page, 'Shake: land').click();
  await expect(shake).toHaveText('0');
  await stepTo(page, 1);
  await expect(shake).toHaveText(SHAKE_OFFSET);
  // `land` shakes for 12 frames: frames 1 to 12 are offset, frame 13 is at rest.
  await stepTo(page, 12);
  await expect(shake).toHaveText(SHAKE_OFFSET);
  await stepTo(page, 13);
  await expect(shake).toHaveText('0');
  await stepTo(page, 15);
  await expect(shake).toHaveText('0');

  // `wall-contact` shakes for 8 frames; Reset clears a shake in progress.
  await button(page, 'Shake: wall-contact').click();
  await stepTo(page, 16);
  await expect(shake).toHaveText(SHAKE_OFFSET);
  await button(page, 'Reset').click();
  await expect(readout(page, 'frame')).toHaveText('0');
  await expect(shake).toHaveText('0');
  await stepTo(page, 1);
  await expect(shake).toHaveText('0');
});

test('review evidence: near and far framing with overlays, a shake at a bound', async ({
  page,
}, testInfo) => {
  await page.goto(CAMERA_LAB);
  const scenario = page.getByRole('combobox', { name: 'Scenario' });

  // Far: player 1 has walked back to 8000 (frame 40) and the camera has converged.
  await scenario.selectOption('walk-back');
  await stepTo(page, 100);
  await expect(readout(page, 'left')).toHaveText('-3000');
  await expect(readout(page, 'right')).toHaveText('83000');
  await expect(readout(page, 'scale')).toHaveText('1.1163');
  await page.screenshot({ path: testInfo.outputPath('camera-lab-far-walk-back-frame-100.png') });

  // Near: player 1 pushes player 2 into the right corner (frame 209); closest zoom, at the bound.
  await scenario.selectOption('corner-push');
  await expect(readout(page, 'frame')).toHaveText('0');
  await button(page, 'Play').click();
  await expect(readout(page, 'right')).toHaveText(String(BOUNDS.right), { timeout: 20_000 });
  await expect(readout(page, 'scale')).toHaveText('2.0000', { timeout: 20_000 });
  await button(page, 'Pause').click();
  await expect(readout(page, 'left')).toHaveText('52000');
  await expect(readout(page, 'midpoint')).toHaveText('90000');
  const pausedAt = await number(page, 'frame');
  await page.screenshot({ path: testInfo.outputPath('camera-lab-near-corner-push.png') });

  // Shake against the right bound: the offset is non-zero, the visible span stays inside.
  await button(page, 'Shake: land').click();
  const trace = [`corner-push, paused at frame ${pausedAt}; "Shake: land" then Step`];
  for (let age = 0; age <= 12; age++) {
    await stepTo(page, pausedAt + 1 + age);
    await expect(readout(page, 'shake')).toHaveText(age < 12 ? SHAKE_OFFSET : '0');
    await expectInsideBounds(page);
    trace.push(
      `frame ${pausedAt + 1 + age}: shake ${await readout(page, 'shake').textContent()} px, ` +
        `visible ${await readout(page, 'left').textContent()}..${await readout(page, 'right').textContent()}`,
    );
    if (age < 3) {
      await arenaCanvas(page).screenshot({
        path: testInfo.outputPath(`camera-lab-shake-step-${age + 1}.png`),
      });
    }
  }
  writeFileSync(testInfo.outputPath('camera-lab-shake-trace.txt'), `${trace.join('\n')}\n`);

  // Overlays off: still one canvas.
  await page.getByRole('checkbox', { name: 'Overlays' }).uncheck();
  await expect(page.getByRole('main').locator('canvas')).toHaveCount(1);
});
