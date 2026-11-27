import { expect, test, type Page } from '@playwright/test';

const ANIMATION_LAB = '/labs/animation';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const angle = (page: Page, bone: string) => page.getByTestId(`animation-angle-${bone}`);

test('animation lab is listed as available, loads directly and starts paused at frame 0', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: 'Labs' }).getByRole('link', { name: 'Animation Lab' }),
  ).toHaveAttribute('href', ANIMATION_LAB);

  await page.goto(ANIMATION_LAB);
  await expect(page.getByRole('heading', { name: 'Animation Lab' })).toBeVisible();
  await expect(page.getByRole('main').locator('svg')).toHaveCount(1);
  await expect(page.getByTestId('animation-view').locator('[data-bone]')).toHaveCount(14);
  await expect(page.getByTestId('animation-frame')).toHaveText('0.00');
  await expect(page.getByTestId('animation-mode')).toHaveText('paused');

  await expect(page.getByLabel('Rig', { exact: true })).toHaveValue('mannequin');
  await expect(page.getByLabel('Clip', { exact: true })).toHaveValue('walk-cycle');
  await expect(page.getByLabel('Second clip')).toHaveValue('');
  await expect(page.getByLabel('Blend weight')).toBeDisabled();
  await expect(page.getByLabel('Frame', { exact: true })).toHaveValue('0');
  for (const name of ['Play', 'Step forward', 'Step back', 'Reset']) {
    await expect(button(page, name)).toBeEnabled();
  }
  await expect(button(page, 'Pause')).toBeDisabled();
});

test('scrubbing and stepping the walk cycle report the keyed bone angles', async ({
  page,
}, testInfo) => {
  await page.goto(ANIMATION_LAB);
  const frame = page.getByTestId('animation-frame');
  const thigh = angle(page, 'thigh-left');
  await expect(thigh).toHaveText('205.00°');

  // Frame 16 is a key: thigh-left 155, upper-arm-right -160.
  await page.getByLabel('Frame', { exact: true }).fill('16');
  await expect(frame).toHaveText('16.00');
  await expect(thigh).toHaveText('155.00°');
  await expect(angle(page, 'upper-arm-right')).toHaveText('-160.00°');
  // A bone the clip does not key reports its rest rotation.
  await expect(angle(page, 'head')).toHaveText('0.00°');
  // Review evidence: the walk-cycle fixture paused on a key frame.
  await page.screenshot({ path: testInfo.outputPath('animation-lab-walk-16.png'), fullPage: true });

  await button(page, 'Step forward').click();
  await expect(frame).toHaveText('17.00');
  await button(page, 'Step back').click();
  await button(page, 'Step back').click();
  await expect(frame).toHaveText('15.00');

  // Frame 8 is halfway through the eased swing from 205 to 155; the shin key is 30.
  await page.getByLabel('Frame', { exact: true }).fill('8');
  await expect(thigh).toHaveText('180.00°');
  await expect(angle(page, 'shin-left')).toHaveText('30.00°');
  await page.screenshot({ path: testInfo.outputPath('animation-lab-walk-08.png'), fullPage: true });

  await button(page, 'Reset').click();
  await expect(frame).toHaveText('0.00');
  await expect(thigh).toHaveText('205.00°');
});

test('play advances the frame and pause stops it on a whole frame', async ({ page }) => {
  await page.goto(ANIMATION_LAB);
  const frame = page.getByTestId('animation-frame');
  const mode = page.getByTestId('animation-mode');

  await button(page, 'Play').click();
  await expect(mode).toHaveText('playing');
  await expect(frame).not.toHaveText('0.00');

  await button(page, 'Pause').click();
  await expect(mode).toHaveText('paused');
  await expect(frame).toHaveText(/^\d+\.00$/);
  // Paused: the frame only moves by the step.
  const paused = Number(await frame.textContent());
  await button(page, 'Step forward').click();
  await expect(frame).toHaveText(`${paused + 1}.00`);
  await expect(mode).toHaveText('paused');
});

test('a clip that does not loop stops on its last frame', async ({ page }) => {
  await page.goto(ANIMATION_LAB);
  await page.getByLabel('Clip', { exact: true }).selectOption('raise-staff');
  await expect(angle(page, 'upper-arm-right')).toHaveText('-90.00°');
  await expect(page.getByTestId('animation-slots')).toHaveText(
    'body: body-plain, face: face-neutral, held-right: none',
  );

  await button(page, 'Play').click();
  await expect(page.getByTestId('animation-frame')).toHaveText('20.00');
  await expect(page.getByTestId('animation-mode')).toHaveText('paused');
  await expect(angle(page, 'upper-arm-right')).toHaveText('0.00°');
  // The attachment and draw-order keys at frame 10 are in effect.
  await expect(page.getByTestId('animation-slots')).toHaveText(
    'held-right: staff, body: body-plain, face: face-angry',
  );
});

test('blending a second clip changes the reported angle with the weight', async ({
  page,
}, testInfo) => {
  await page.goto(ANIMATION_LAB);
  const arm = angle(page, 'upper-arm-right');
  const slots = page.getByTestId('animation-slots');
  const weight = page.getByLabel('Blend weight');

  await page.getByLabel('Frame', { exact: true }).fill('16');
  await expect(arm).toHaveText('-160.00°');

  // raise-staff holds upper-arm-right at 0 from frame 10: halfway from -160 is -80.
  await page.getByLabel('Second clip').selectOption('raise-staff');
  await expect(page.getByTestId('animation-weight')).toHaveText('0.50');
  await expect(arm).toHaveText('-80.00°');
  await expect(angle(page, 'forearm-right')).toHaveText('30.00°');
  await expect(slots).toHaveText('held-right: staff, body: body-plain, face: face-angry');
  await page.screenshot({
    path: testInfo.outputPath('animation-lab-blend-half.png'),
    fullPage: true,
  });

  await weight.fill('0.25');
  await expect(arm).toHaveText('-120.00°');
  await expect(slots).toHaveText('body: body-plain, face: face-neutral, held-right: none');
  await weight.fill('0');
  await expect(arm).toHaveText('-160.00°');
  await weight.fill('1');
  await expect(arm).toHaveText('0.00°');

  await button(page, 'Reset').click();
  await expect(page.getByLabel('Second clip')).toHaveValue('');
  await expect(page.getByTestId('animation-frame')).toHaveText('0.00');
  await expect(arm).toHaveText('-200.00°');
});

test('the rig picker switches to the second rig and its clip', async ({ page }, testInfo) => {
  await page.goto(ANIMATION_LAB);
  await page.getByLabel('Rig', { exact: true }).selectOption({ label: 'Four arms and wings' });
  await expect(page.getByTestId('animation-view').locator('[data-bone]')).toHaveCount(9);
  await expect(page.getByLabel('Clip', { exact: true })).toHaveValue('wing-flap');
  await expect(angle(page, 'wing-left-1')).toHaveText('45.00°');

  await page.getByLabel('Frame', { exact: true }).fill('10');
  await expect(angle(page, 'wing-left-1')).toHaveText('90.00°');
  await expect(page.getByTestId('animation-slots')).toHaveText(
    'wing-left: wing-left-membrane, wing-right: wing-right-membrane, shell: shell-plain',
  );
  await page.screenshot({
    path: testInfo.outputPath('animation-lab-wing-flap-10.png'),
    fullPage: true,
  });
});
