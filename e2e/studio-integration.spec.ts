import { expect, test, type Page } from '@playwright/test';
import { expectColours, type Rgb } from './canvas';

const INTEGRATION_LAB = '/labs/integration';
// The seeded fixture: both fighters standing at their default positions on frame 0.
const FIXTURE = {
  frame: '0',
  mode: 'live',
  'p1-x': '24000',
  'p1-y': '0',
  'p1-state': 'idle',
  'p2-x': '72000',
  'p2-y': '0',
  'p2-state': 'idle',
  'effects-active': '0',
  'effects-spawned': '0',
  cues: '0',
  'recorded-frame': '—',
  'recorded-hash': '—',
  'played-frame': '—',
  'played-hash': '—',
} as const;

// The mannequins' body attachments at rest on the 960 px canvas, as in `game.spec.ts`.
const BODY_PLAIN: Rgb = [0x4f, 0x8f, 0xd9];
const BOTH_MANNEQUINS = [
  { point: { x: 151, y: 282 }, colour: BODY_PLAIN },
  { point: { x: 809, y: 282 }, colour: BODY_PLAIN },
];

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const readout = (page: Page, key: string) => page.getByTestId(`integration-${key}`);
const numberOf = (page: Page, key: string) => async () =>
  Number(await readout(page, key).textContent());

async function expectFixture(page: Page) {
  for (const [key, text] of Object.entries(FIXTURE)) {
    await expect(readout(page, key), key).toHaveText(text);
  }
}

/** Loads the lab and waits for its first drawn frame. */
async function openLab(page: Page) {
  await page.goto(INTEGRATION_LAB);
  // The first load compiles the lab on a cold dev server and fetches two texture manifests.
  await expect(page.getByRole('heading', { name: 'Integration Lab' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(button(page, 'Play')).toBeEnabled({ timeout: 30_000 });
  await expectFixture(page);
}

test('integration lab is listed under Analysis and loads the seeded fixture', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: 'Labs' }).getByRole('link', { name: 'Integration Lab' }),
  ).toHaveAttribute('href', INTEGRATION_LAB);

  await openLab(page);
  // React StrictMode mounts, unmounts and remounts in development: a leaked renderer would
  // leave a second canvas behind.
  await expect(page.getByTestId('arena').locator('canvas')).toHaveCount(1);
  // Both skeletons hold their own handle on one texture manifest.
  await expectColours(page, BOTH_MANNEQUINS);
  await expect(readout(page, 'seed')).toHaveText('1180199');
  // The camera frames both fighters inside the arena's visual bounds.
  await expect.poll(numberOf(page, 'camera-left')).toBeGreaterThanOrEqual(-4000);
  await expect.poll(numberOf(page, 'camera-left')).toBeLessThan(24000);
  await expect.poll(numberOf(page, 'camera-right')).toBeGreaterThan(72000);
  await expect.poll(numberOf(page, 'camera-right')).toBeLessThanOrEqual(100000);
  // Paused at frame 0: Step runs exactly one tick.
  await button(page, 'Step').click();
  await expect(readout(page, 'frame')).toHaveText('1');

  // Leaving unmounts the lab; coming back builds one new session from the fixture.
  const labs = page.getByRole('navigation', { name: 'Labs' });
  await labs.getByRole('link', { name: 'Simulation Lab' }).click();
  await expect(page.getByRole('heading', { name: 'Integration Lab' })).toHaveCount(0);
  await labs.getByRole('link', { name: 'Integration Lab' }).click();
  await expect(button(page, 'Play')).toBeEnabled({ timeout: 30_000 });
  await expectFixture(page);
  await expect(page.getByTestId('arena').locator('canvas')).toHaveCount(1);
  // The stage released its textures on leaving; the new one loaded and draws them again.
  await expectColours(page, BOTH_MANNEQUINS);
  expect(errors).toEqual([]);
});

test('fighters move on input, a jump triggers an effect and a cue, Reset restores the fixture', async ({
  page,
}) => {
  await openLab(page);
  await button(page, 'Play').click();
  await expect(button(page, 'Pause')).toBeEnabled();

  // Player one walks right while D is held, and the mannequin's state follows.
  await page.keyboard.down('KeyD');
  await expect.poll(numberOf(page, 'p1-x')).toBeGreaterThan(Number(FIXTURE['p1-x']) + 1000);
  await expect(readout(page, 'p1-state')).toHaveText('walk');
  await page.keyboard.up('KeyD');
  await expect(readout(page, 'p1-state')).toHaveText('idle');
  await expect(readout(page, 'effects-spawned')).toHaveText('0');

  // A jump spawns the dust burst and triggers the jump cue; landing adds the ring.
  await page.keyboard.down('KeyW');
  await expect.poll(numberOf(page, 'effects-spawned')).toBeGreaterThanOrEqual(1);
  await expect(readout(page, 'cue-log')).toContainText('jump → jump');
  await page.keyboard.up('KeyW');
  await expect(readout(page, 'p1-state')).toHaveText('idle');
  await expect(readout(page, 'cue-log')).toContainText('land → land');
  await expect(readout(page, 'effects-last')).toHaveText('core/land-ring');
  // Player two was given no input.
  await expect(readout(page, 'p2-x')).toHaveText(FIXTURE['p2-x']);

  await button(page, 'Reset').click();
  await expectFixture(page);
  await expect(button(page, 'Play')).toBeEnabled();
  await expect(button(page, 'Play replay')).toBeDisabled();
});

test('the camera zooms out to keep a jumping fighter in frame', async ({ page }, testInfo) => {
  // Twenty single steps of the whole composition, each waiting for its drawn frame.
  test.slow();
  await openLab(page);
  const visibleWidth = async () =>
    (await numberOf(page, 'camera-right')()) - (await numberOf(page, 'camera-left')());
  // At rest: the fighters' span plus the margins.
  await expect.poll(visibleWidth).toBe(70_000);

  // Paused, so the jump is stepped tick by tick: 20 ticks reach its apex, 200 world units up.
  await page.keyboard.down('KeyW');
  for (let tick = 1; tick <= 20; tick++) {
    await button(page, 'Step').click();
    await expect(readout(page, 'frame')).toHaveText(String(tick));
  }
  await page.keyboard.up('KeyW');
  await expect(readout(page, 'p1-state')).toHaveText('air');
  await expect.poll(numberOf(page, 'p1-y')).toBeGreaterThan(19_000);
  await expect.poll(visibleWidth).toBeGreaterThan(70_000);
  // Review evidence: the whole airborne mannequin, staff included, is below the top edge.
  await page
    .getByTestId('arena')
    .locator('canvas')
    .screenshot({ path: testInfo.outputPath('integration-lab-jump-apex.png') });
});

test('a recorded session replays to the same final frame, hash, effects and cues', async ({
  page,
}) => {
  await openLab(page);
  // Held before Record, so the recording walks from its first tick.
  await page.keyboard.down('KeyD');
  await button(page, 'Record').click();
  await expect(readout(page, 'mode')).toHaveText('recording');
  // The same button is now Stop and keeps keyboard focus; Reset would discard the recording.
  await expect(button(page, 'Stop')).toBeFocused();
  await expect(button(page, 'Reset')).toBeDisabled();
  await expect.poll(numberOf(page, 'frame')).toBeGreaterThan(60);
  await page.keyboard.down('KeyW');
  await expect(readout(page, 'cue-log')).toContainText('jump → jump');
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');
  await expect(readout(page, 'cue-log')).toContainText('land → land');
  await button(page, 'Stop').click();
  await expect(readout(page, 'mode')).toHaveText('live');
  await expect(button(page, 'Record')).toBeFocused();
  await expect(button(page, 'Reset')).toBeEnabled();
  await expect(readout(page, 'recorded-hash')).toHaveText(/^[0-9a-f]{8}$/);

  // Stopped: the readouts hold still on the recording's last frame.
  const recorded = {
    frame: (await readout(page, 'recorded-frame').textContent()) ?? '',
    hash: (await readout(page, 'recorded-hash').textContent()) ?? '',
    x: (await readout(page, 'p1-x').textContent()) ?? '',
    effects: (await readout(page, 'effects-spawned').textContent()) ?? '',
    cues: (await readout(page, 'cues').textContent()) ?? '',
    cueLog: (await readout(page, 'cue-log').textContent()) ?? '',
  };
  expect(Number(recorded.frame)).toBeGreaterThan(60);
  expect(Number(recorded.x)).toBeGreaterThan(Number(FIXTURE['p1-x']));
  expect(Number(recorded.effects)).toBeGreaterThanOrEqual(2);
  expect(Number(recorded.cues)).toBeGreaterThanOrEqual(2);
  await expect(readout(page, 'frame')).toHaveText(recorded.frame);

  await button(page, 'Play replay').click();
  await expect(button(page, 'Play replay')).toBeFocused();
  await expect(readout(page, 'played-frame')).toHaveText(recorded.frame, { timeout: 30_000 });
  await expect(readout(page, 'played-hash')).toHaveText(recorded.hash);
  await expect(readout(page, 'mode')).toHaveText('playback');
  await expect(readout(page, 'frame')).toHaveText(recorded.frame);
  await expect(readout(page, 'p1-x')).toHaveText(recorded.x);
  // Each effect and cue of the recording came back once: none missing, none doubled.
  await expect(readout(page, 'effects-spawned')).toHaveText(recorded.effects);
  await expect(readout(page, 'cues')).toHaveText(recorded.cues);
  await expect(readout(page, 'cue-log')).toHaveText(recorded.cueLog);
  // The recording is kept, unchanged, next to the playback result.
  await expect(readout(page, 'recorded-hash')).toHaveText(recorded.hash);

  // A finished playback cannot continue: Play starts it over and it ends on the same frame.
  await button(page, 'Play').click();
  await expect(button(page, 'Pause')).toBeFocused();
  await expect(readout(page, 'played-frame')).toHaveText(recorded.frame, { timeout: 30_000 });
  await expect(readout(page, 'played-hash')).toHaveText(recorded.hash);
  await expect(readout(page, 'cues')).toHaveText(recorded.cues);
  // So does Step, paused on frame 1.
  await button(page, 'Step').click();
  await expect(readout(page, 'frame')).toHaveText('1');
  await expect(readout(page, 'played-frame')).toHaveText('—');
  await expect(button(page, 'Step')).toBeFocused();
});
