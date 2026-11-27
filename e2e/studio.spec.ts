import { expect, test, type Locator, type Page } from '@playwright/test';

const SIMULATION_LAB = '/labs/simulation';
const readFrame = async (frame: Locator) => Number(await frame.textContent());

async function pausedAt(page: Page): Promise<number> {
  const frame = page.getByTestId('sim-frame');
  await expect.poll(() => readFrame(frame)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  return readFrame(frame);
}

test('home lists available labs and planned labs are not links', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Labs' });
  await expect(nav.getByRole('link', { name: 'Simulation Lab' })).toHaveAttribute(
    'href',
    SIMULATION_LAB,
  );
  await expect(nav.getByText('Combat Lab')).toHaveAttribute('aria-disabled', 'true');
  await expect(nav.getByRole('link', { name: 'Combat Lab' })).toHaveCount(0);

  await page
    .getByRole('main')
    .getByRole('link', { name: /Simulation Lab/ })
    .click();
  await expect(page).toHaveURL(SIMULATION_LAB);
  await expect(page.getByRole('heading', { name: 'Simulation Lab' })).toBeVisible();
});

test('unknown lab routes report not found', async ({ page }) => {
  await page.goto('/labs/does-not-exist');
  await expect(page.getByRole('alert')).toHaveText('No lab at /labs/does-not-exist.');
});

test('simulation lab loads directly with exactly one canvas and live diagnostics', async ({
  page,
}) => {
  await page.goto(SIMULATION_LAB);
  // React StrictMode mounts, unmounts and remounts in development: a leaked renderer would
  // leave a second canvas behind.
  await expect(page.getByTestId('arena').locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('sim-tps')).toHaveText(/^\d+$/);
  await expect(page.getByTestId('render-fps')).toHaveText(/^\d+$/);
});

test('pauses, steps one frame, resets and resumes the simulation', async ({ page }) => {
  await page.goto(SIMULATION_LAB);
  const frame = page.getByTestId('sim-frame');
  const state = page.getByTestId('sim-state');

  // Paused: the displayed frame must equal the frame in the state view, and Step adds exactly one.
  const start = await pausedAt(page);
  await expect(state).toContainText(`"frame": ${start}`);
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(frame).toHaveText(String(start + 1));
  await expect(state).toContainText(`"frame": ${start + 1}`);

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(frame).toHaveText('0');
  await expect(state).toContainText('"x": 240');
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(frame).toHaveText('1');

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => readFrame(frame)).toBeGreaterThan(1);
});

test('step applies held keyboard input to player one', async ({ page }) => {
  await page.goto(SIMULATION_LAB);
  await pausedAt(page);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('sim-state')).toContainText('"x": 240');

  await page.keyboard.down('KeyD');
  await page.getByRole('button', { name: 'Step' }).click();
  await page.keyboard.up('KeyD');
  await expect(page.getByTestId('sim-state')).toContainText('"x": 244');
});
