import { expect, test, type Page } from '@playwright/test';

const MOVEMENT_LAB = '/labs/movement';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function stepTo(page: Page, frame: number) {
  const readout = page.getByTestId('movement-frame');
  const current = Number(await readout.textContent());
  for (let i = current; i < frame; i++) await button(page, 'Step').click();
  await expect(readout).toHaveText(String(frame));
}

test('movement lab is listed under Simulation and loads directly, paused at the fixture', async ({
  page,
}) => {
  await page.goto('/');
  const link = page.getByRole('navigation', { name: 'Labs' }).getByRole('link', {
    name: 'Movement Lab',
  });
  await expect(link).toHaveAttribute('href', MOVEMENT_LAB);

  await page.goto(MOVEMENT_LAB);
  await expect(page.getByRole('heading', { name: 'Movement Lab' })).toBeVisible();
  // StrictMode mounts twice in development: exactly one view must remain.
  await expect(page.getByTestId('movement-view')).toHaveCount(1);
  await expect(page.getByTestId('movement-frame')).toHaveText('0');
  await expect(button(page, 'Play')).toBeVisible();
  await expect(page.getByTestId('movement-p1-x')).toHaveText('24000');
  await expect(page.getByTestId('movement-p2-x')).toHaveText('72000');
  await expect(page.getByTestId('movement-p1-facing')).toHaveText('right');
  await expect(page.getByTestId('movement-p2-facing')).toHaveText('left');
  await expect(page.getByTestId('movement-p1-state')).toHaveText('standing');
  // Readouts are a table with named rows and columns, and they describe the view.
  const readouts = page.getByRole('table', { name: 'Fighter readouts' });
  await expect(readouts.getByRole('rowheader')).toHaveText(['Player 1', 'Player 2']);
  await expect(readouts.getByRole('columnheader')).toHaveText([
    'x',
    'y',
    'vx',
    'vy',
    'facing',
    'state',
  ]);
  await expect(page.getByTestId('movement-view')).toHaveAttribute(
    'aria-describedby',
    'movement-readouts',
  );
  // Player identity is not colour only: each box carries a text label.
  await expect(page.getByTestId('movement-view').locator('text')).toHaveText(['P1', 'P2']);
});

test('neutral jump: apex on the expected frame, landing, parameter set, Reset', async ({
  page,
}) => {
  await page.goto(MOVEMENT_LAB);
  await page.getByRole('combobox', { name: 'Scenario' }).selectOption('neutral-jump');
  const y = page.getByTestId('movement-p1-y');
  const state = page.getByTestId('movement-p1-state');
  const events = page.getByTestId('movement-events').getByRole('listitem');
  await expect(page.getByTestId('movement-frame')).toHaveText('0');

  // Default set: jumpVelocity 1950, gravity 100 → y_n = 1950n − 50n(n − 1): 19950 on ticks 19
  // and 21, the apex 20000 only on tick 20.
  await stepTo(page, 1);
  await expect(y).toHaveText('1950');
  await expect(state).toHaveText('airborne');
  await expect(events).toHaveText(['frame 0: jump P1']);
  await stepTo(page, 19);
  await expect(y).toHaveText('19950');
  await stepTo(page, 20);
  await expect(y).toHaveText('20000');
  await stepTo(page, 21);
  await expect(y).toHaveText('19950');
  await stepTo(page, 40);
  await expect(y).toHaveText('0');
  await expect(state).toHaveText('standing');
  await expect(events).toHaveText(['frame 0: jump P1', 'frame 39: land P1']);

  // Ramped set: jumpVelocity 1750, gravity 90 → apex 17900, also at n = 20.
  await page.getByRole('combobox', { name: 'Parameter set' }).selectOption('ramped');
  await expect(page.getByTestId('movement-frame')).toHaveText('0');
  await expect(events).toHaveCount(0);
  await stepTo(page, 20);
  await expect(y).toHaveText('17900');

  await button(page, 'Reset').click();
  await expect(page.getByTestId('movement-frame')).toHaveText('0');
  await expect(y).toHaveText('0');
  await expect(page.getByTestId('movement-p1-x')).toHaveText('24000');
  await expect(events).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Parameter set' })).toHaveValue('ramped');
  await expect(page.getByTestId('movement-view')).toHaveCount(1);
});

test('review evidence: forward-jump arc with trace, and a corner push', async ({
  page,
}, testInfo) => {
  await page.goto(MOVEMENT_LAB);
  const frame = page.getByTestId('movement-frame');
  await page.getByRole('combobox', { name: 'Scenario' }).selectOption('forward-jump');
  await button(page, 'Play').click();
  await expect.poll(async () => Number(await frame.textContent())).toBeGreaterThan(45);
  await button(page, 'Pause').click();
  // Forward jump: 40 airborne ticks at 500 per tick from x 24000; the 500 landing slide stops
  // after one more tick (friction 400).
  await expect(page.getByTestId('movement-p1-x')).toHaveText('44100');
  await expect(page.getByTestId('movement-p1-state')).toHaveText('standing');
  await page.getByTestId('movement-view').screenshot({
    path: testInfo.outputPath('movement-lab-forward-jump-arc.png'),
  });

  await page.getByRole('combobox', { name: 'Scenario' }).selectOption('corner-push');
  await button(page, 'Play').click();
  // Player 1 pushes player 2 into the right corner on frame 209, then stops against it.
  await expect(page.getByTestId('movement-events').getByRole('listitem')).toHaveText(
    ['frame 209: wall-contact P2 right'],
    { timeout: 15_000 },
  );
  await button(page, 'Pause').click();
  await expect(page.getByTestId('movement-p1-x')).toHaveText('87000');
  await expect(page.getByTestId('movement-p2-x')).toHaveText('93000');
  await page.screenshot({ path: testInfo.outputPath('movement-lab-corner-push.png') });
});
