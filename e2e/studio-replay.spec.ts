import { expect, test, type Page } from '@playwright/test';

const REPLAY_LAB = '/labs/replay';
const INITIAL_X = '24000';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** Records about two seconds of player one walking right; returns the final frame and x. */
async function recordWalk(page: Page) {
  const frame = page.getByTestId('replay-frame');
  const mode = page.getByTestId('replay-mode');
  await page.goto(REPLAY_LAB);
  await expect(mode).toHaveText('idle');
  // Held before Record, so every recorded tick walks right.
  await page.keyboard.down('KeyD');
  await button(page, 'Record').click();
  await expect(mode).toHaveText('recording');
  await expect.poll(async () => Number(await frame.textContent())).toBeGreaterThan(120);
  await page.keyboard.up('KeyD');
  await button(page, 'Stop').click();
  await expect(mode).toHaveText('paused');

  // Stop shows the last recorded frame.
  const length = (await page.getByTestId('replay-length').textContent()) ?? '';
  const x = (await page.getByTestId('replay-p1-x').textContent()) ?? '';
  expect(Number(length)).toBeGreaterThan(120);
  expect(Number(x)).toBeGreaterThan(Number(INITIAL_X));
  await expect(frame).toHaveText(length);
  return { length, x };
}

/** Plays from frame 0 and expects the recorded end state. */
async function playToEnd(page: Page, recorded: { length: string; x: string }) {
  await expect(page.getByTestId('replay-frame')).toHaveText('0');
  await expect(page.getByTestId('replay-p1-x')).toHaveText(INITIAL_X);
  await button(page, 'Play').click();
  await expect(page.getByTestId('replay-frame')).toHaveText(recorded.length, { timeout: 30_000 });
  await expect(page.getByTestId('replay-mode')).toHaveText('paused');
  await expect(page.getByTestId('replay-p1-x')).toHaveText(recorded.x);
  await expect(page.getByTestId('replay-desync')).toHaveText('none');
}

test('replay lab is linked from the navigation and loads with exactly one canvas', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: 'Labs' }).getByRole('link', { name: 'Replay Lab' }),
  ).toHaveAttribute('href', REPLAY_LAB);

  await page.goto(REPLAY_LAB);
  await expect(page.getByRole('heading', { name: 'Replay Lab' })).toBeVisible();
  // React StrictMode mounts, unmounts and remounts in development: a leaked renderer would
  // leave a second canvas behind.
  await expect(page.getByTestId('arena').locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('replay-frame')).toHaveText('0');
  await expect(page.getByTestId('replay-p1-x')).toHaveText(INITIAL_X);
});

test('a recording of live input replays to the recorded final frame and position', async ({
  page,
}) => {
  const recorded = await recordWalk(page);
  await page.getByLabel('Seek').fill('0');
  await playToEnd(page, recorded);
});

test('steps, seeks, exports and imports a replay; a malformed import is rejected', async ({
  page,
}) => {
  const recorded = await recordWalk(page);
  const frame = page.getByTestId('replay-frame');
  const x = page.getByTestId('replay-p1-x');
  const seek = page.getByLabel('Seek');
  const json = page.getByLabel('Replay JSON');

  // Player one walked right at 400 sub-units per tick from the first recorded tick.
  await seek.fill('30');
  await expect(frame).toHaveText('30');
  await expect(x).toHaveText('36000');
  await button(page, 'Step').click();
  await expect(frame).toHaveText('31');
  await expect(x).toHaveText('36400');
  await expect(seek).toHaveValue('31');
  await expect(page.getByTestId('replay-mode')).toHaveText('paused');

  await button(page, 'Export').click();
  await expect(json).toHaveValue(/^\{"replayVersion":1,/);
  const exported = await json.inputValue();

  // A malformed import reports the problem and keeps the loaded replay where it was.
  await json.fill(exported.replace('"replayVersion":1', '"replayVersion":99'));
  await button(page, 'Import').click();
  await expect(page.getByRole('alert')).toHaveText(
    'Import failed: Unsupported replayVersion 99; supported: 1',
  );
  await json.fill('not a replay');
  await button(page, 'Import').click();
  await expect(page.getByRole('alert')).toContainText('Replay is not valid JSON');
  await expect(frame).toHaveText('31');
  await expect(page.getByTestId('replay-length')).toHaveText(recorded.length);

  // Importing the exported text into a reset lab reproduces the recording.
  await button(page, 'Reset').click();
  await expect(page.getByTestId('replay-mode')).toHaveText('idle');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await json.fill(exported);
  await button(page, 'Import').click();
  await expect(page.getByTestId('replay-length')).toHaveText(recorded.length);
  await playToEnd(page, recorded);
});

test('an imported replay with a changed input frame stops at the next checksum', async ({
  page,
}) => {
  await recordWalk(page);
  const json = page.getByLabel('Replay JSON');
  await button(page, 'Export').click();
  await expect(json).toHaveValue(/^\{"replayVersion":1,/);
  // Player one held right ([2,0]) from the first tick; make the first tick idle instead.
  const exported = await json.inputValue();
  expect(exported).toContain('"inputs":[[2,0],');
  await json.fill(exported.replace('"inputs":[[2,0],', '"inputs":[[0,0],'));
  await button(page, 'Import').click();
  await button(page, 'Play').click();
  await expect(page.getByTestId('replay-desync')).toContainText('frame 60: state ');
  await expect(page.getByTestId('replay-frame')).toHaveText('60');
  await expect(page.getByTestId('replay-mode')).toHaveText('paused');
});
