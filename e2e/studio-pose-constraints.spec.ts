import { expect, test, type Page } from '@playwright/test';

const LAB = '/labs/pose-constraints';
// The lab's view box in world units (y up), and the rest position of the right forearm's tip.
const VIEW = { left: -130, top: 195, width: 260, height: 210 };
const REST_EFFECTOR = '68.00, 146.00';

/** Drags the target handle to a world position with the mouse. */
async function dragTargetTo(page: Page, x: number, y: number) {
  const handle = await page.getByTestId('pose-target-handle').boundingBox();
  const view = await page.getByTestId('pose-view').boundingBox();
  if (!handle || !view) throw new Error('the lab view is not laid out');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    view.x + ((x - VIEW.left) / VIEW.width) * view.width,
    view.y + ((VIEW.top - y) / VIEW.height) * view.height,
    { steps: 5 },
  );
  await page.mouse.up();
}

test('pose constraints lab is listed as available and loads directly on its fixture', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page
      .getByRole('navigation', { name: 'Labs' })
      .getByRole('link', { name: 'Pose Constraints Lab' }),
  ).toHaveAttribute('href', LAB);

  await page.goto(LAB);
  await expect(page.getByRole('heading', { name: 'Pose Constraints Lab' })).toBeVisible();
  await expect(page.getByRole('main').locator('svg')).toHaveCount(1);
  const view = page.getByTestId('pose-view');
  await expect(view.locator('[data-bone]')).toHaveCount(14);
  await expect(view.locator('[data-limit]')).toHaveCount(2);
  await expect(view.locator('[data-limit="forearm-right"]')).toBeVisible();
  await expect(view.locator('[data-limit="head"]')).toBeVisible();
  await expect(page.getByTestId('pose-target-handle')).toBeVisible();

  await expect(page.getByRole('slider', { name: 'Mix', exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Bend').getByRole('option')).toHaveText([
    'counter-clockwise elbow (1)',
    'clockwise elbow (-1)',
  ]);
  await expect(page.getByLabel('Bend')).toHaveValue('1');
  await expect(page.getByTestId('pose-target')).toHaveText('50.00, 120.00');
  await expect(page.getByTestId('pose-effector')).toHaveText('50.00, 120.00');
  // The head aims at the target as far as its limit allows.
  await expect(page.getByTestId('pose-limit-head')).toHaveText('-40.00° (at limit)');
});

test('dragging the target moves the hand onto reachable targets and to full reach beyond', async ({
  page,
}, testInfo) => {
  await page.goto(LAB);
  const target = page.getByTestId('pose-target');
  const effector = page.getByTestId('pose-effector');
  const reach = page.getByTestId('pose-effector-distance');
  await expect(effector).toHaveText('50.00, 120.00');

  // Reachable: the shoulder is at (10, 146) and the arm is 58 long.
  await dragTargetTo(page, 40, 110);
  await expect(target).toHaveText('40.00, 110.00');
  await expect(effector).toHaveText('40.00, 110.00');
  await expect(reach).toHaveText('46.86');
  await expect(page.getByTestId('pose-out-of-reach')).toHaveCount(0);
  // Review evidence: a reachable target.
  await page.screenshot({
    path: testInfo.outputPath('pose-constraints-reachable.png'),
    fullPage: true,
  });

  // Unreachable: 131.89 from the shoulder. The arm is straight, along the line to the target.
  await dragTargetTo(page, 110, 60);
  await expect(target).toHaveText('110.00, 60.00');
  await expect(reach).toHaveText('58.00');
  await expect(page.getByTestId('pose-out-of-reach')).toHaveText('(target out of reach)');
  await expect(effector).toHaveText('53.97, 108.18');
  await expect(page.getByTestId('pose-limit-forearm-right')).toHaveText('0.00°');
  // Review evidence: an unreachable target.
  await page.screenshot({
    path: testInfo.outputPath('pose-constraints-unreachable.png'),
    fullPage: true,
  });
});

test('mix 0 shows the unconstrained pose and mix 1 the full constraint', async ({ page }) => {
  await page.goto(LAB);
  const effector = page.getByTestId('pose-effector');
  const mix = page.getByLabel('Mix');
  await expect(effector).toHaveText('50.00, 120.00');

  await mix.fill('0');
  await expect(page.getByTestId('pose-mix')).toHaveText('0.00');
  await expect(effector).toHaveText(REST_EFFECTOR);
  await expect(page.getByTestId('pose-limit-head')).toHaveText('0.00°');
  await expect(page.getByTestId('pose-limit-forearm-right')).toHaveText('0.00°');
  await expect(page.getByTestId('pose-target')).toHaveText('50.00, 120.00');

  await mix.fill('0.5');
  await expect(effector).not.toHaveText(REST_EFFECTOR);
  await expect(effector).not.toHaveText('50.00, 120.00');

  await mix.fill('1');
  await expect(effector).toHaveText('50.00, 120.00');
});

test('bend flips the elbow, the target can be typed, and reset returns to the fixture', async ({
  page,
}) => {
  await page.goto(LAB);
  const elbow = page.getByTestId('pose-limit-forearm-right');
  const effector = page.getByTestId('pose-effector');
  await expect(elbow).toHaveText(/^-\d/);

  await page.getByLabel('Bend').selectOption('-1');
  await expect(elbow).toHaveText(/^\d/);
  await expect(effector).toHaveText('50.00, 120.00');

  await page.getByLabel('Target x').fill('30');
  await page.getByLabel('Target y').fill('170');
  await expect(page.getByTestId('pose-target')).toHaveText('30.00, 170.00');
  await expect(effector).toHaveText('30.00, 170.00');

  // Typed key by key, a negative value passes through a lone "-", which is not a number yet.
  const targetY = page.getByLabel('Target y');
  await targetY.press('ControlOrMeta+a');
  await targetY.pressSequentially('-10');
  await expect(targetY).toHaveValue('-10');
  await expect(page.getByTestId('pose-target')).toHaveText('30.00, -10.00');

  // A typed value is held inside the view, like a dragged one.
  const targetX = page.getByLabel('Target x');
  await targetX.fill('500');
  await expect(page.getByTestId('pose-target')).toHaveText('130.00, -10.00');
  await targetX.blur();
  await expect(targetX).toHaveValue('130');

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByLabel('Bend')).toHaveValue('1');
  await expect(page.getByTestId('pose-target')).toHaveText('50.00, 120.00');
  await expect(effector).toHaveText('50.00, 120.00');
  await expect(elbow).toHaveText(/^-\d/);
});
