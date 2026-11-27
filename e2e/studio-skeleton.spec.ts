import { expect, test } from '@playwright/test';
import { arenaCanvas, expectColours, type Point, type Rgb } from './canvas';

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

// The rendered view: a 520×420 canvas at 2 px per world unit with the rig origin at (260, 390).
// Placeholder textures are solid colours, as long as their bone and centred on it.
const at = (x: number, y: number): Point => ({ x: 260 + 2 * x, y: 390 - 2 * y });
const BACKGROUND: Rgb = [0x15, 0x13, 0x1c];
const BODY_PLAIN: Rgb = [0x4f, 0x8f, 0xd9];
const BODY_ROBE: Rgb = [0xd9, 0x8f, 0x2b];
const FACE_NEUTRAL: Rgb = [0xe8, 0xc9, 0xa0];
const SHELL_PLAIN: Rgb = [0xd9, 0xc2, 0x3f];
const STAFF: Rgb = [0x8f, 0xd9, 0x4f];
// Mannequin: spine from (0, 110) to (0, 150), head from there to (0, 175).
const BODY = at(0, 130);
const FACE = at(0, 165);
const EMPTY = at(-60, 60);
// The staff starts at the right hand (68, 146) and is 56 long.
const STAFF_RIGHT = at(100, 146);
const STAFF_LEFT = at(-100, 146);
// Non-humanoid: core from (0, 60) to (0, 110).
const SHELL = at(0, 75);

const MANNEQUIN_AT_REST = [
  { point: BODY, colour: BODY_PLAIN },
  { point: FACE, colour: FACE_NEUTRAL },
  { point: EMPTY, colour: BACKGROUND },
  { point: STAFF_RIGHT, colour: BACKGROUND },
];

test('the rendered view is one canvas beside the one debug view, across fixtures and reset', async ({
  page,
}) => {
  await page.goto(SKELETON_LAB);
  const main = page.getByRole('main');
  // React StrictMode remounts in development: a leaked renderer would leave a second canvas.
  await expect(main.locator('canvas')).toHaveCount(1);
  await expect(main.locator('svg')).toHaveCount(1);
  await expect(arenaCanvas(page)).toHaveAttribute('width', '520');

  await page.getByLabel('Fixture rig').selectOption({ label: 'Four arms and wings' });
  await expectColours(page, [{ point: SHELL, colour: SHELL_PLAIN }]);
  await expect(main.locator('canvas')).toHaveCount(1);
  await expect(main.locator('svg')).toHaveCount(1);

  await page.getByRole('button', { name: 'Reset' }).click();
  await expectColours(page, [{ point: SHELL, colour: SHELL_PLAIN }]);
  await expect(main.locator('canvas')).toHaveCount(1);
  await expect(main.locator('svg')).toHaveCount(1);
});

test('the canvas draws each attachment placeholder on its bone', async ({ page }, testInfo) => {
  await page.goto(SKELETON_LAB);
  await expectColours(page, MANNEQUIN_AT_REST);
  // Review evidence: the rendered view next to the debug view.
  await page.screenshot({ path: testInfo.outputPath('rendered-mannequin.png'), fullPage: true });

  await page.getByLabel('body attachment').selectOption('body-robe');
  await expectColours(page, [
    { point: BODY, colour: BODY_ROBE },
    { point: FACE, colour: FACE_NEUTRAL },
  ]);
  await page.getByLabel('body attachment').selectOption({ label: 'none' });
  await expectColours(page, [{ point: BODY, colour: BACKGROUND }]);

  await page.getByLabel('Fixture rig').selectOption({ label: 'Four arms and wings' });
  await expectColours(page, [
    { point: SHELL, colour: SHELL_PLAIN },
    { point: FACE, colour: BACKGROUND },
  ]);
  await page.screenshot({
    path: testInfo.outputPath('rendered-non-humanoid.png'),
    fullPage: true,
  });
});

test('facing left mirrors the rendered rig about its origin', async ({ page }, testInfo) => {
  await page.goto(SKELETON_LAB);
  await page.getByLabel('held-right attachment').selectOption('staff');
  await expectColours(page, [
    { point: STAFF_RIGHT, colour: STAFF },
    { point: STAFF_LEFT, colour: BACKGROUND },
    { point: BODY, colour: BODY_PLAIN },
  ]);

  await page.getByLabel('Facing').selectOption({ label: 'left (-1)' });
  await expectColours(page, [
    { point: STAFF_LEFT, colour: STAFF },
    { point: STAFF_RIGHT, colour: BACKGROUND },
    { point: BODY, colour: BODY_PLAIN },
  ]);
  await page.screenshot({
    path: testInfo.outputPath('rendered-mannequin-facing-left.png'),
    fullPage: true,
  });

  await page.getByLabel('Facing').selectOption({ label: 'right (1)' });
  await expectColours(page, [
    { point: STAFF_RIGHT, colour: STAFF },
    { point: STAFF_LEFT, colour: BACKGROUND },
  ]);
});

test('switching fixtures back and forth without waiting reloads the released textures', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto(SKELETON_LAB);
  await expectColours(page, MANNEQUIN_AT_REST);

  const picker = page.getByLabel('Fixture rig');
  await picker.selectOption({ label: 'Four arms and wings' });
  await picker.selectOption({ label: 'Mannequin' });

  await expectColours(page, MANNEQUIN_AT_REST);
  await expect(page.getByRole('main').locator('canvas')).toHaveCount(1);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
