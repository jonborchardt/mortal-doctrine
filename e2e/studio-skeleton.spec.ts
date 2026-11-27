import { expect, test } from '@playwright/test';

const SKELETON_LAB = '/labs/skeleton';

test('skeleton lab is listed as available and loads directly with one debug view', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: 'Labs' }).getByRole('link', { name: 'Skeleton Lab' }),
  ).toHaveAttribute('href', SKELETON_LAB);

  await page.goto(SKELETON_LAB);
  await expect(page.getByRole('heading', { name: 'Skeleton Lab' })).toBeVisible();
  await expect(page.getByRole('main').locator('svg')).toHaveCount(1);
  const view = page.getByTestId('skeleton-view');
  await expect(view.locator('[data-bone]')).toHaveCount(14);
  await expect(view.locator('[data-slot]')).toHaveCount(3);
  await expect(view.locator('[data-anchor]')).toHaveCount(3);
  await expect(view.locator('[data-bone="forearm-right"]')).toBeVisible();
  await expect(view.locator('[data-slot="body"]')).toBeVisible();
  await expect(view.locator('[data-anchor="crown"]')).toBeVisible();
  // Every slot has an attachment control.
  for (const slot of ['body', 'face', 'held-right']) {
    await expect(page.getByLabel(`${slot} attachment`)).toBeVisible();
  }
});

test('rotating a bone moves the reported anchor; reset restores the fixture', async ({ page }) => {
  await page.goto(SKELETON_LAB);
  const grip = page.getByTestId('skeleton-anchor-grip-right');
  const forearm = page.getByLabel('forearm-right rotation');

  // Rest: shoulder (10, 146), then 30 + 28 + 5 units along +x.
  await expect(grip).toHaveText('73.00, 146.00');
  await expect(forearm).toHaveValue('0');

  // Forearm at 90 degrees: elbow stays at (40, 146); forearm 28 and grip offset 5 now point up.
  await forearm.fill('90');
  await expect(page.getByTestId('skeleton-rotation-forearm-right')).toHaveText('90°');
  await expect(grip).toHaveText('40.00, 179.00');
  await expect(page.getByTestId('skeleton-anchor-crown')).toHaveText('0.00, 175.00');

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(grip).toHaveText('73.00, 146.00');
  await expect(forearm).toHaveValue('0');
});

test('toggling an attachment changes the reported active attachment', async ({ page }) => {
  await page.goto(SKELETON_LAB);
  const body = page.getByTestId('skeleton-slot-body');
  const held = page.getByTestId('skeleton-slot-held-right');
  await expect(body).toHaveText('body-plain');
  await expect(held).toHaveText('none');

  await page.getByLabel('body attachment').selectOption('body-robe');
  await page.getByLabel('held-right attachment').selectOption('staff');
  await expect(body).toHaveText('body-robe');
  await expect(held).toHaveText('staff');

  await page.getByLabel('body attachment').selectOption({ label: 'none' });
  await expect(body).toHaveText('none');

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(body).toHaveText('body-plain');
  await expect(held).toHaveText('none');
});

test('the fixture picker switches between the three rigs', async ({ page }, testInfo) => {
  await page.goto(SKELETON_LAB);
  const picker = page.getByLabel('Fixture rig');
  const view = page.getByTestId('skeleton-view');
  await expect(view.locator('[data-bone]')).toHaveCount(14);
  // Review evidence: both fixture rigs at rest.
  await page.screenshot({
    path: testInfo.outputPath('skeleton-lab-mannequin.png'),
    fullPage: true,
  });

  await picker.selectOption({ label: 'Four arms and wings' });
  await expect(view.locator('[data-bone]')).toHaveCount(9);
  await expect(view.locator('[data-slot]')).toHaveCount(3);
  await expect(view.locator('[data-anchor]')).toHaveCount(5);
  await expect(page.getByTestId('skeleton-anchor-palm-lower-right')).toHaveText('40.00, 85.00');
  // (-35 - 20 * sqrt(2), 100 + 20 * sqrt(2))
  await expect(page.getByTestId('skeleton-anchor-wingtip-left')).toHaveText('-63.28, 128.28');
  await expect(page.getByLabel('wing-left attachment')).toHaveValue('wing-left-feathers');
  await page.screenshot({
    path: testInfo.outputPath('skeleton-lab-non-humanoid.png'),
    fullPage: true,
  });

  await picker.selectOption({ label: 'Mannequin + tail extension' });
  await expect(view.locator('[data-bone]')).toHaveCount(16);
  await expect(page.getByTestId('skeleton-anchor-tail-tip')).toHaveText('20.00, 105.00');
  await expect(page.getByTestId('skeleton-slot-tail')).toHaveText('tail-plain');
  await page.screenshot({
    path: testInfo.outputPath('skeleton-lab-mannequin-tail.png'),
    fullPage: true,
  });
});
