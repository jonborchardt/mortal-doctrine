import { expect, test, type Page } from '@playwright/test';
import { expectColours, type Rgb } from './canvas';

const EFFECTS_LAB = '/labs/effects';
// `core/land-ring` (fixture colour), drawn at player one's feet: x 24000 → 240 px, ground y 460.
const LAND_RING: Rgb = [0xf2, 0xe6, 0xc8];
const LAND_RING_POINT = { x: 240, y: 452 };

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const readout = (page: Page, key: string) => page.getByTestId(`effects-${key}`);
const activeItems = (page: Page) => page.getByTestId('effects-active').getByRole('listitem');

async function expectFixture(page: Page) {
  await expect(readout(page, 'frame')).toHaveText('0');
  await expect(readout(page, 'count')).toHaveText('0');
  await expect(readout(page, 'age')).toHaveText('-');
  await expect(activeItems(page)).toHaveCount(0);
  await expect(button(page, 'Pause')).toBeEnabled();
  await expect(button(page, 'Step')).toBeDisabled();
}

test('effects lab is listed, loads with one canvas and tears down', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Labs' });
  await expect(nav.getByRole('link', { name: 'Effects Lab' })).toHaveAttribute('href', EFFECTS_LAB);
  await page.goto(EFFECTS_LAB);
  await expect(page.getByRole('heading', { name: 'Effects Lab' })).toBeVisible();
  // StrictMode mounts twice in development: a leaked renderer would leave a second canvas.
  await expect(page.getByRole('main').locator('canvas')).toHaveCount(1);
  await expectFixture(page);

  await nav.getByRole('link', { name: 'Audio Lab' }).click();
  await expect(page.getByRole('heading', { name: 'Audio Lab' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('fire, re-feed, pause and step, restore, expire and reset', async ({ page }, testInfo) => {
  await page.goto(EFFECTS_LAB);
  await expectFixture(page);

  // Paused, so nothing expires while the counts are checked.
  await button(page, 'Pause').click();
  await expect(button(page, 'Step')).toBeEnabled();
  await button(page, 'Fire land (P1)').click();
  await expect(readout(page, 'count')).toHaveText('1');
  await expect(readout(page, 'frame')).toHaveText('1');
  await button(page, 'Fire jump (P2)').click();
  await expect(readout(page, 'count')).toHaveText('2');
  await expect(activeItems(page)).toHaveText([
    'core/land-ring 0.0 / 600 ms',
    'core/dust-burst 0.0 / 900 ms',
  ]);

  // The same batch again: no duplicate. Step's readout change proves a frame was drawn since.
  await button(page, 'Re-feed last batch').click();
  await button(page, 'Step').click();
  await expect(readout(page, 'age')).toHaveText('16.7');
  await expect(readout(page, 'count')).toHaveText('2');
  await button(page, 'Step').click();
  await expect(readout(page, 'age')).toHaveText('33.3');
  await expect(activeItems(page)).toHaveText([
    'core/land-ring 33.3 / 600 ms',
    'core/dust-burst 33.3 / 900 ms',
  ]);
  await expectColours(page, [{ point: LAND_RING_POINT, colour: LAND_RING }]);
  // Review evidence: paused with both effects mid-lifetime.
  await page.screenshot({ path: testInfo.outputPath('effects-lab-paused-mid-lifetime.png') });

  // Restore to frame 0 clears; firing again spawns once.
  await button(page, 'Restore frame 0').click();
  await expect(readout(page, 'frame')).toHaveText('0');
  await expect(readout(page, 'count')).toHaveText('0');
  await expectColours(page, [{ point: LAND_RING_POINT, colour: LAND_RING, not: true }]);
  await button(page, 'Fire land (P1)').click();
  await expect(readout(page, 'count')).toHaveText('1');

  // Display time resumes: the effect expires.
  await button(page, 'Resume').click();
  await expect(readout(page, 'count')).toHaveText('0');
  await expect(activeItems(page)).toHaveCount(0);

  await button(page, 'Fire command (P1)').click();
  await button(page, 'Reset').click();
  await expectFixture(page);
  await expect(page.getByRole('main').locator('canvas')).toHaveCount(1);
});
