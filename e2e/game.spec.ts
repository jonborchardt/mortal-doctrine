import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('loads the game with a rendered canvas and advancing counters', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Mortal Doctrine' })).toBeVisible();
  await expect(page.getByTestId('arena').locator('canvas')).toBeVisible();
  // StrictMode mounts, unmounts and remounts in development: a leaked loop would leave two.
  await expect(page.getByTestId('arena').locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('arena').locator('canvas')).toHaveAttribute('width', '960');

  const frame = page.getByTestId('sim-frame');
  await expect(frame).toHaveText(/\d+/);
  const firstFrame = Number(await frame.textContent());
  await expect.poll(async () => Number(await frame.textContent())).toBeGreaterThan(firstFrame);
  await expect(page.getByTestId('render-fps')).toHaveText(/\d+/);
});

test('keyboard input moves player one', async ({ page }) => {
  const x = page.getByTestId('p1-x');
  await expect(x).toHaveText(/\d+/);
  const start = Number(await x.textContent());

  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => Number(await x.textContent())).toBeGreaterThan(start);
  await page.keyboard.up('ArrowRight');

  const afterRight = Number(await x.textContent());
  await page.keyboard.down('KeyA');
  await expect.poll(async () => Number(await x.textContent())).toBeLessThan(afterRight);
  await page.keyboard.up('KeyA');
});
