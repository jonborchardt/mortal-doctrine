import { expect, test, type Page } from '@playwright/test';
import { arenaCanvas, expectColours, type Point, type Rgb } from './canvas';

const ARENA_LAB = '/labs/arena';
// The 960×540 viewport, its ground line (80 px above the bottom) and the placeholder arena's
// parallax reference: the centre of its visual bounds −4000…100000 (sub-units).
const WIDTH = 960;
const GROUND_Y = 460;
const REFERENCE = 48_000;

const SKY: Rgb = [32, 44, 84];
const GROUND: Rgb = [120, 84, 56];
// Renderer placeholders, which the lab must not draw.
const PLACEHOLDER_FLOOR: Rgb = [0x4a, 0x44, 0x58];
const PLACEHOLDER_FIGHTERS: readonly Rgb[] = [
  [0xe0, 0x53, 0x3d],
  [0x3d, 0x8f, 0xe0],
];

interface Feature {
  readonly colour: Rgb;
  readonly parallax: number;
  /** Authored left and right edges in sub-units. */
  readonly left: number;
  readonly right: number;
  /** Sampled this many world units above the ground, where no nearer layer covers it. */
  readonly height: number;
}
// One image per moving layer of the placeholder arena fixture.
const FAR: Feature = {
  colour: [110, 80, 160],
  parallax: 0.25,
  left: 24_000,
  right: 40_000,
  height: 200,
};
const MID: Feature = {
  colour: [60, 150, 110],
  parallax: 0.5,
  left: 38_000,
  right: 48_000,
  height: 120,
};
const POST: Feature = {
  colour: [240, 200, 70],
  parallax: 1,
  left: 46_500,
  right: 49_500,
  height: 35,
};
const FEATURES = [FAR, MID, POST];

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const readout = (page: Page, key: string) => page.getByTestId(`arena-${key}`);
const layerToggle = (page: Page, id: string) =>
  page.getByRole('checkbox', { name: new RegExp(`^${id} `) });

interface Camera {
  /** Camera centre in sub-units and logical pixels per sub-unit, from the visible span. */
  readonly centre: number;
  readonly perSubUnit: number;
}

async function readCamera(page: Page): Promise<Camera> {
  const left = Number(await readout(page, 'left').textContent());
  const right = Number(await readout(page, 'right').textContent());
  return { centre: (left + right) / 2, perSubUnit: WIDTH / (right - left) };
}

/** Where the arena package's parallax rule puts authored x of a layer with factor `parallax`. */
const screenX = ({ centre, perSubUnit }: Camera, parallax: number, x: number) =>
  WIDTH / 2 + (x - REFERENCE - parallax * (centre - REFERENCE)) * perSubUnit;

const featureY = (camera: Camera, { height }: Feature) =>
  GROUND_Y - height * 100 * camera.perSubUnit;

/** The feature's colour 3 px inside both predicted edges and not 3 px outside them. */
function edgeChecks(camera: Camera, feature: Feature) {
  const { colour, parallax } = feature;
  const y = featureY(camera, feature);
  const left = screenX(camera, parallax, feature.left);
  const right = screenX(camera, parallax, feature.right);
  return [
    { point: { x: left + 3, y }, colour },
    { point: { x: right - 3, y }, colour },
    { point: { x: left - 3, y }, colour, not: true },
    { point: { x: right + 3, y }, colour, not: true },
  ];
}

/** The ground's top edge is at the ground line, whatever stands on it. */
const groundChecks = (x: number) => [
  { point: { x, y: GROUND_Y + 4 }, colour: GROUND },
  { point: { x, y: GROUND_Y - 4 }, colour: GROUND, not: true },
];

async function expectFixture(page: Page) {
  await expect(readout(page, 'frame')).toHaveText('0');
  // Fighters at 24000 and 72000: 70000 sub-units visible, centred on the parallax reference.
  await expect(readout(page, 'left')).toHaveText('13000');
  await expect(readout(page, 'right')).toHaveText('83000');
  await expect(readout(page, 'midpoint')).toHaveText('48000');
}

test('arena lab is listed under Presentation and loads directly, paused at the fixture', async ({
  page,
}) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Labs' });
  await expect(nav.getByRole('link', { name: 'Arena Lab' })).toHaveAttribute('href', ARENA_LAB);

  await page.goto(ARENA_LAB);
  await expect(page.getByRole('heading', { name: 'Arena Lab' })).toBeVisible();
  // StrictMode mounts twice in development: a leaked renderer would leave a second canvas.
  await expect(page.getByRole('main').locator('canvas')).toHaveCount(1);
  await expect(arenaCanvas(page)).toHaveAttribute('width', String(WIDTH));
  await expectFixture(page);
  await expect(button(page, 'Play')).toBeEnabled();
  await expect(button(page, 'Step')).toBeEnabled();
  await expect(button(page, 'Reset')).toBeEnabled();
  for (const name of ['Left', 'Right']) {
    await expect(page.getByRole('radio', { name, exact: true })).not.toBeChecked();
  }
  await expect(page.getByRole('radio', { name: 'Hold', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  for (const id of ['sky', 'far', 'mid', 'ground']) {
    await expect(layerToggle(page, id)).toBeChecked();
  }

  // The arena is drawn; the renderer's placeholder floor and fighters (at 24000 and 72000) are not.
  const camera = await readCamera(page);
  const fighterY = GROUND_Y - 10_000 * camera.perSubUnit;
  const fighters: Point[] = [24_000, 72_000].map((x) => ({
    x: screenX(camera, 1, x),
    y: fighterY,
  }));
  await expectColours(page, [
    { point: { x: 480, y: 20 }, colour: SKY },
    { point: { x: 200, y: 500 }, colour: GROUND },
    { point: { x: 200, y: 500 }, colour: PLACEHOLDER_FLOOR, not: true },
    ...fighters.flatMap((point) =>
      PLACEHOLDER_FIGHTERS.map((colour) => ({ point, colour, not: true })),
    ),
  ]);

  // Leaving the lab leaves no canvas behind.
  await nav.getByRole('link', { name: 'Audio Lab' }).click();
  await expect(page.getByRole('heading', { name: 'Audio Lab' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('panning moves each layer by its parallax factor, the ground line stays put, Reset restores', async ({
  page,
}, testInfo) => {
  await page.goto(ARENA_LAB);
  await expectFixture(page);
  const before = await readCamera(page);
  const fixtureChecks = [
    ...FEATURES.flatMap((feature) => edgeChecks(before, feature)),
    ...groundChecks(100),
  ];
  await expectColours(page, fixtureChecks);
  // Review evidence: the lab at two camera positions.
  await page.screenshot({ path: testInfo.outputPath('arena-lab-frame-0.png') });

  // Both fighters walk right for 30 frames; the smoothed camera follows their midpoint.
  await page.getByRole('radio', { name: 'Right', exact: true }).check();
  for (let i = 0; i < 30; i++) await button(page, 'Step').click();
  await expect(readout(page, 'frame')).toHaveText('30');
  await expect(readout(page, 'midpoint')).toHaveText('60000');
  const after = await readCamera(page);
  // The camera moved right by well over the sampling tolerance, at the same zoom.
  expect(after.centre - before.centre).toBeGreaterThan(5000);
  expect(after.perSubUnit).toBeCloseTo(before.perSubUnit, 6);

  // Each feature is where its factor predicts for the new readouts...
  await expectColours(page, [
    ...FEATURES.flatMap((feature) => edgeChecks(after, feature)),
    ...groundChecks(100),
  ]);
  // ...which is a smaller move the farther the layer: far < mid < ground, all to the left.
  const [far = 0, mid = 0, ground = 0] = FEATURES.map(
    ({ parallax, left }) => screenX(before, parallax, left) - screenX(after, parallax, left),
  );
  expect(far).toBeGreaterThan(6);
  expect(mid).toBeGreaterThan(far + 6);
  expect(ground).toBeGreaterThan(mid + 6);
  await page.screenshot({ path: testInfo.outputPath('arena-lab-frame-30-panned-right.png') });

  await button(page, 'Reset').click();
  await expectFixture(page);
  await expect(page.getByRole('radio', { name: 'Hold', exact: true })).toBeChecked();
  await expectColours(page, fixtureChecks);
  await expect(page.getByRole('main').locator('canvas')).toHaveCount(1);
});

test('a layer toggle hides and shows that layer only', async ({ page }) => {
  await page.goto(ARENA_LAB);
  await expectFixture(page);
  const camera = await readCamera(page);
  const centre = (feature: Feature): Point => ({
    x: screenX(camera, feature.parallax, (feature.left + feature.right) / 2),
    y: featureY(camera, feature),
  });
  const shown = [
    { point: centre(MID), colour: MID.colour },
    { point: centre(FAR), colour: FAR.colour },
  ];
  await expectColours(page, shown);

  await layerToggle(page, 'mid').uncheck();
  await expectColours(page, [
    { point: centre(MID), colour: MID.colour, not: true },
    { point: centre(FAR), colour: FAR.colour },
  ]);

  await layerToggle(page, 'mid').check();
  await expectColours(page, shown);
  await expect(page.getByRole('main').locator('canvas')).toHaveCount(1);
});
