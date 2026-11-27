import { expect, test } from '@playwright/test';

const COMMAND_LAB = '/labs/commands';

test('command lab is linked from navigation and loads directly', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: 'Labs' }).getByRole('link', { name: 'Command Lab' }),
  ).toHaveAttribute('href', COMMAND_LAB);

  await page.goto(COMMAND_LAB);
  await expect(page.getByRole('heading', { name: 'Command Lab' })).toBeVisible();
});

test('the default fixture shows its recognitions, timeline and facing', async ({
  page,
}, testInfo) => {
  await page.goto(COMMAND_LAB);
  // Quarter-circle + A1 for player 1 and its mirror for player 2: 2 idle frames, 3 input
  // frames (the last on frame 4), 6 idle frames.
  await expect(page.getByTestId('command-frame')).toHaveText('11');
  await expect(page.getByTestId('command-log').getByRole('listitem')).toHaveText([
    'frame 4 · P1 · quarter-circle',
    'frame 4 · P2 · quarter-circle',
  ]);
  await expect(page.getByTestId('command-facing-p1')).toHaveText('right');
  await expect(page.getByTestId('command-facing-p2')).toHaveText('left');
  const timeline = page.getByTestId('command-timeline');
  await expect(timeline.getByRole('row').nth(1)).toHaveText('P1··↓↘→1······');
  await expect(timeline.getByRole('row').nth(2)).toHaveText('P2··↓↙←1······');
  // Review evidence: the lab showing a recognized motion.
  await page.screenshot({ path: testInfo.outputPath('command-lab-quarter-circle.png') });
});

test('another fixture shows its own recognitions', async ({ page }) => {
  await page.goto(COMMAND_LAB);
  await page
    .getByRole('combobox', { name: 'Input source' })
    .selectOption({ label: 'Fixture: Charge back, forward + A5' });
  // 2 idle frames, 30 frames of back, forward + A5 on frame 32.
  await expect(page.getByTestId('command-log').getByRole('listitem')).toHaveText([
    'frame 32 · P1 · charge',
    'frame 32 · P2 · charge',
  ]);
});

test('live input: a quarter-circle entered frame by frame is recognized, Reset restores', async ({
  page,
}) => {
  await page.goto(COMMAND_LAB);
  const log = page.getByTestId('command-log').getByRole('listitem');
  const frame = page.getByTestId('command-frame');
  const step = page.getByRole('button', { name: 'Step' });
  await expect(log).toHaveCount(2);

  await page
    .getByRole('combobox', { name: 'Input source' })
    .selectOption({ label: 'Live input (keyboard / gamepad)' });
  await expect(frame).toHaveText('0');
  await expect(log).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

  await page.keyboard.down('KeyS');
  await step.click();
  await page.keyboard.down('KeyD');
  await step.click();
  await page.keyboard.up('KeyS');
  await page.keyboard.down('KeyU');
  await step.click();
  await page.keyboard.up('KeyU');
  await page.keyboard.up('KeyD');
  await expect(frame).toHaveText('3');
  await expect(log).toHaveText(['frame 2 · P1 · quarter-circle']);
  await expect(page.getByTestId('command-timeline').getByRole('row').nth(1)).toHaveText('P1↓↘→1');

  await page
    .getByRole('combobox', { name: 'Input source' })
    .selectOption({ label: 'Fixture: Quarter-circle + A1' });
  await step.click();
  await expect(frame).toHaveText('12');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(frame).toHaveText('11');
  await expect(log).toHaveText(['frame 4 · P1 · quarter-circle', 'frame 4 · P2 · quarter-circle']);
});
