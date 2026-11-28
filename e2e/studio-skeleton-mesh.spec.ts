import { expect, test } from '@playwright/test';
import { expectColours, type Point, type Rgb } from './canvas';

// The Skeleton Lab's rendered view: a 520×420 canvas at 2 px per world unit with the rig origin
// at (260, 390). The "Mesh limb" fixture is a strip 20 units thick from (-60, 100) to (60, 100),
// jointed at (0, 100) and skinned across the joint, textured a solid colour.
const at = (x: number, y: number): Point => ({ x: 260 + 2 * x, y: 390 - 2 * y });
const BACKGROUND: Rgb = [0x15, 0x13, 0x1c];
const LIMB_SKIN: Rgb = [0xc9, 0x4f, 0xd9];
const UPPER = at(-40, 100);
const STRAIGHT_TIP = at(45, 100);
// With `lower` at 90 degrees the far half runs straight up from the joint to (0, 160).
const BENT_TIP = at(0, 145);

test('rotating the joint bends the skinned mesh limb', async ({ page }, testInfo) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto('/labs/skeleton');
  await page.getByLabel('Fixture rig').selectOption({ label: 'Mesh limb' });
  await expect(page.getByTestId('skeleton-view').locator('[data-bone]')).toHaveCount(2);

  await expectColours(page, [
    { point: UPPER, colour: LIMB_SKIN },
    { point: STRAIGHT_TIP, colour: LIMB_SKIN },
    { point: BENT_TIP, colour: BACKGROUND },
  ]);
  await page.screenshot({ path: testInfo.outputPath('mesh-limb-straight.png'), fullPage: true });

  await page.getByLabel('lower rotation').fill('90');
  await expect(page.getByTestId('skeleton-rotation-lower')).toHaveText('90°');
  await expectColours(page, [
    { point: UPPER, colour: LIMB_SKIN },
    { point: BENT_TIP, colour: LIMB_SKIN },
    { point: STRAIGHT_TIP, colour: BACKGROUND },
  ]);
  await page.screenshot({ path: testInfo.outputPath('mesh-limb-bent.png'), fullPage: true });

  // Mirroring flips the triangle winding; meshes are not culled, so the limb still draws.
  await page.getByLabel('Facing').selectOption({ label: 'left (-1)' });
  await expectColours(page, [
    { point: at(40, 100), colour: LIMB_SKIN },
    { point: BENT_TIP, colour: LIMB_SKIN },
    { point: at(-45, 100), colour: BACKGROUND },
  ]);
  await page.screenshot({
    path: testInfo.outputPath('mesh-limb-bent-facing-left.png'),
    fullPage: true,
  });

  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
