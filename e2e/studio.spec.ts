import { expect, test, type Locator, type Page } from '@playwright/test';
import { arenaCanvas, expectColours, type Point, type Rgb } from './canvas';

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
  await expect(state).toContainText('"x": 24000');
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(frame).toHaveText('1');

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => readFrame(frame)).toBeGreaterThan(1);
});

test('step applies held keyboard input to player one', async ({ page }) => {
  await page.goto(SIMULATION_LAB);
  await pausedAt(page);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('sim-state')).toContainText('"x": 24000');

  await page.keyboard.down('KeyD');
  await page.getByRole('button', { name: 'Step' }).click();
  await page.keyboard.up('KeyD');
  await expect(page.getByTestId('sim-state')).toContainText('"x": 24400');
});

test('a key tapped between ticks is applied to exactly one step', async ({ page }) => {
  await page.goto(SIMULATION_LAB);
  await pausedAt(page);
  await page.getByRole('button', { name: 'Reset' }).click();
  const state = page.getByTestId('sim-state');
  const frame = page.getByTestId('sim-frame');
  await expect(state).toContainText('"x": 24000');

  await page.keyboard.down('KeyD');
  await page.keyboard.up('KeyD');
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(frame).toHaveText('1');
  await expect(state).toContainText('"x": 24400');
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(frame).toHaveText('2');
  await expect(state).toContainText('"x": 24400');
});

test('shows seed, RNG state, raw input history and boundary-contact events; Reset clears them', async ({
  page,
}) => {
  await page.goto(SIMULATION_LAB);
  await pausedAt(page);
  await page.getByRole('button', { name: 'Reset' }).click();
  const frame = page.getByTestId('sim-frame');
  const seed = page.getByTestId('sim-seed');
  const rng = page.getByTestId('sim-rng');
  const history = page.getByTestId('input-history-p1');
  const events = page.getByTestId('sim-events').getByRole('listitem');
  await expect(frame).toHaveText('0');
  await expect(seed).toHaveText(/^\d+$/);
  const initialSeed = await seed.textContent();
  await expect(rng).toHaveText(/^-?\d+$/);
  const initialRng = await rng.textContent();
  await expect(history).toBeEmpty();
  await expect(events).toHaveCount(0);

  // Player one starts at x 240 and walks 4 per tick: the 53rd step (frame 52) reaches the edge.
  const step = page.getByRole('button', { name: 'Step' });
  await page.keyboard.down('KeyA');
  for (let i = 0; i < 53; i++) await step.click();
  await page.keyboard.up('KeyA');
  await expect(frame).toHaveText('53');
  await expect(history).toContainText('←');
  await expect(events).toHaveCount(1);
  await expect(events.first()).toHaveText('frame 52: boundary-contact P1 left');

  // Holding several keys while single-stepping records the raw frame, opposing directions kept.
  await page.keyboard.down('KeyD');
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('KeyU');
  await step.click();
  await page.keyboard.up('KeyU');
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('KeyD');
  await expect(history).toContainText(/← ←→1$/);

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(frame).toHaveText('0');
  await expect(seed).toHaveText(initialSeed ?? '');
  await expect(rng).toHaveText(initialRng ?? '');
  await expect(history).toBeEmpty();
  await expect(events).toHaveCount(0);
});

const PLAYER_ONE: Rgb = [0xe0, 0x53, 0x3d];
const FIXTURE: Rgb = [0x33, 0xff, 0x66];
const BACKGROUND: Rgb = [0x15, 0x13, 0x1c];
const FLOOR: Rgb = [0x4a, 0x44, 0x58];
// Default view at 960×540: 1 world unit = 1 px, ground line at y 460. The fixture is centred on
// world (240, 70) → C; S is 40 units left of C, inside the 96-px fixture but outside the 60-unit
// fighter (x 210..270).
const C: Point = { x: 240, y: 390 };
const S: Point = { x: 200, y: 390 };
const FLOOR_POINT: Point = { x: 480, y: 500 };

const fixtureSelect = (page: Page) => page.getByLabel('Fixture renderable');

interface FixtureLine {
  id: number;
  layer: string;
  updates: number;
  lastFrame: number;
  destroys: number;
  textures: string;
}

async function fixtureLines(page: Page): Promise<FixtureLine[]> {
  const text = (await page.getByTestId('fixture-log').textContent()) ?? '';
  return text.split('\n').flatMap((line) => {
    const match =
      /^#(\d+) (\w+): updates (\d+), last frame (-?\d+), destroyed (\d+), textures ([\w ]+)$/.exec(
        line,
      );
    if (!match) return [];
    const [, id, layer = '', updates, lastFrame, destroys, textures = ''] = match;
    return [
      {
        id: Number(id),
        layer,
        updates: Number(updates),
        lastFrame: Number(lastFrame),
        destroys: Number(destroys),
        textures,
      },
    ];
  });
}

const latestFixture = async (page: Page) => (await fixtureLines(page)).at(-1);
const fixtureById = async (page: Page, id: number) =>
  (await fixtureLines(page)).find((line) => line.id === id);

test('registered renderables draw in the layer they name, composited in declared order', async ({
  page,
}) => {
  await page.goto(SIMULATION_LAB);
  await pausedAt(page);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('sim-frame')).toHaveText('0');

  // (a) No fixture: C is player one, S is not fixture-coloured; the floor is unchanged.
  await expectColours(page, [
    { point: C, colour: PLAYER_ONE },
    { point: S, colour: FIXTURE, not: true },
    { point: S, colour: BACKGROUND },
    { point: FLOOR_POINT, colour: FLOOR },
  ]);

  // (b) In `effects` (declared after `fighters`) the fixture covers the fighter.
  await fixtureSelect(page).selectOption('effects');
  await expect(page.getByTestId('fixture-size')).toHaveText('96×32');
  await expectColours(page, [
    { point: C, colour: FIXTURE },
    { point: S, colour: FIXTURE },
  ]);

  // (c) In `background` (declared before `fighters`) the fighter covers the fixture.
  await fixtureSelect(page).selectOption('background');
  await expect.poll(async () => (await latestFixture(page))?.layer).toBe('background');
  await expectColours(page, [
    { point: C, colour: PLAYER_ONE },
    { point: S, colour: FIXTURE },
  ]);

  // The fixture receives advancing snapshot frames while running.
  const whilePaused = (await latestFixture(page))?.lastFrame ?? 0;
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect
    .poll(async () => (await latestFixture(page))?.lastFrame ?? -1)
    .toBeGreaterThan(whilePaused + 5);
});

test('texture resolution selects the fixture texture logical size', async ({ page }) => {
  await page.goto(SIMULATION_LAB);
  const size = page.getByTestId('fixture-size');
  await expect(size).toHaveText('off');
  await fixtureSelect(page).selectOption('effects');
  await expect(size).toHaveText('96×32');
  await page.getByLabel('Texture resolution').selectOption('1');
  await expect(size).toHaveText('192×64');
  await page.getByLabel('Texture resolution').selectOption('2');
  await expect(size).toHaveText('96×32');
});

test('a texture that fails to load reports its id and URL without leaking a canvas', async ({
  page,
}) => {
  await page.route('**/fixture-block@2x.png', (route) => route.fulfill({ status: 404 }));
  await page.goto(SIMULATION_LAB);
  await expect(arenaCanvas(page)).toHaveCount(1);
  await fixtureSelect(page).selectOption('effects');
  const error = page.getByTestId('fixture-error');
  await expect(error).toContainText('fixture-block');
  await expect(error).toContainText('/fixtures/renderer/textures/fixture-block@2x.png');
  await expect(page.getByTestId('fixture-size')).toHaveText('failed');
  await expect(arenaCanvas(page)).toHaveCount(1);
});

test('the viewport select recreates the loop at the chosen size, leaving one canvas', async ({
  page,
}) => {
  await page.goto(SIMULATION_LAB);
  await expect(arenaCanvas(page)).toHaveCount(1);
  await expect(arenaCanvas(page)).toHaveAttribute('width', '960');
  await expect(arenaCanvas(page)).toHaveAttribute('height', '540');
  await page.getByLabel('Viewport').selectOption('640x360');
  await expect(arenaCanvas(page)).toHaveCount(1);
  await expect(arenaCanvas(page)).toHaveAttribute('width', '640');
  await expect(arenaCanvas(page)).toHaveAttribute('height', '360');
  await expect.poll(() => readFrame(page.getByTestId('sim-frame'))).toBeGreaterThan(0);
});

test('destroying a loop tears down its registered renderable and releases its textures', async ({
  page,
}) => {
  await page.goto(SIMULATION_LAB);
  await fixtureSelect(page).selectOption('effects');
  await expect.poll(async () => (await latestFixture(page))?.updates ?? 0).toBeGreaterThan(0);
  const old = await latestFixture(page);
  if (!old) throw new Error('No fixture record');
  expect(old).toMatchObject({ destroys: 0, textures: 'loaded' });

  await page.getByLabel('Viewport').selectOption('640x360');
  await expect(arenaCanvas(page)).toHaveCount(1);
  await expect(arenaCanvas(page)).toHaveAttribute('width', '640');
  await expect
    .poll(() => fixtureById(page, old.id))
    .toMatchObject({ destroys: 1, textures: 'released' });
  const frozen = await fixtureById(page, old.id);

  // The new loop's fixture keeps updating while the destroyed one stays frozen.
  await expect.poll(async () => (await latestFixture(page))?.id ?? 0).toBeGreaterThan(old.id);
  const frame = page.getByTestId('sim-frame');
  const start = await readFrame(frame);
  await expect.poll(() => readFrame(frame)).toBeGreaterThan(start + 30);
  expect(await fixtureById(page, old.id)).toEqual(frozen);
  expect((await latestFixture(page))?.updates).toBeGreaterThan(0);
});

test('gameplay arrow keys on a focused lab select change neither the select nor the viewport', async ({
  page,
}) => {
  await page.goto(SIMULATION_LAB);
  const paused = await pausedAt(page);
  for (const [label, value] of [
    ['Viewport', '960x540'],
    ['Fixture renderable', 'off'],
    ['Texture resolution', '2'],
  ] as const) {
    const select = page.getByLabel(label);
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await expect(select).toHaveValue(value);
  }
  await expect(arenaCanvas(page)).toHaveAttribute('width', '960');
  await expect(page.getByTestId('sim-frame')).toHaveText(String(paused));
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
});

test('the interpolation checkbox switches the alpha readout', async ({ page }) => {
  await page.goto(SIMULATION_LAB);
  const alpha = page.getByTestId('render-alpha');
  const checkbox = page.getByLabel('Interpolation');
  await expect(alpha).toHaveText('off');
  await checkbox.check();
  await expect(alpha).toHaveText(/^0\.\d{3}$/);
  await checkbox.uncheck();
  await expect(alpha).toHaveText('off');
});
