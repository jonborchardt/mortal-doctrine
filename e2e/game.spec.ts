import { expect, test, type Page } from '@playwright/test';
import { expectColours, type Rgb } from './canvas';

// What the page requested and what went wrong, collected from before the navigation.
const requested = new WeakMap<Page, string[]>();
const problems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const urls: string[] = [];
  const errors: string[] = [];
  requested.set(page, urls);
  problems.set(page, errors);
  page.on('request', (request) => urls.push(request.url()));
  page.on('requestfailed', (request) => errors.push(`request failed: ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
});

test('loads the game with a rendered canvas and advancing counters', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Mortal Doctrine' })).toBeVisible();
  await expect(page.getByTestId('arena').locator('canvas')).toBeVisible();
  // StrictMode mounts, unmounts and remounts in development: a leaked loop would leave two.
  await expect(page.getByTestId('arena').locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('arena').locator('canvas')).toHaveAttribute('width', '960');

  const frame = page.getByTestId('sim-frame');
  await expect(frame).toHaveText(/\d+/);
  const firstFrame = Number(await frame.textContent());
  await expect.poll(async () => Number(await frame.textContent())).toBeGreaterThan(firstFrame);
  await expect(page.getByTestId('render-fps')).toHaveText(/\d+/);
});

test('keyboard input moves player one', async ({ page }) => {
  const x = page.getByTestId('p1-x');
  await expect(x).toHaveText(/\d+/);
  const start = Number(await x.textContent());

  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => Number(await x.textContent())).toBeGreaterThan(start);
  await page.keyboard.up('ArrowRight');

  const afterRight = Number(await x.textContent());
  await page.keyboard.down('KeyA');
  await expect.poll(async () => Number(await x.textContent())).toBeLessThan(afterRight);
  await page.keyboard.up('KeyA');
});

// The placeholder match at rest: the fighters' pushbox edges (210 and 750 world units) plus the
// 80-unit margin a side, so the camera shows 700 world units across the 960 px canvas (960 / 700
// = 1.3714 px per world unit), centred on x = 480 between the fighters at 240 and 720, ground
// line at y = 460. A mannequin's body attachment is centred 130 world units above its feet:
// x = 480 -/+ 240 x 1.3714 = 150.9 and 809.1, y = 460 - 130 x 1.3714 = 281.7.
const GROUND: Rgb = [120, 84, 56];
const BODY_PLAIN: Rgb = [0x4f, 0x8f, 0xd9];
const BACKGROUND: Rgb = [0x15, 0x13, 0x1c];
const AT_REST = [
  { point: { x: 480, y: 520 }, colour: GROUND },
  { point: { x: 151, y: 282 }, colour: BODY_PLAIN },
  { point: { x: 809, y: 282 }, colour: BODY_PLAIN },
  { point: { x: 480, y: 282 }, colour: BACKGROUND },
];

/**
 * Waits for the stage, then samples it. The frame counter is written only by a fully built
 * stage, so the colour poll does not spend its time on a cold dev server or texture loading.
 */
async function expectMatchAtRest(page: Page) {
  await expect(page.getByTestId('sim-frame')).toHaveText(/\d+/, { timeout: 30_000 });
  await expectColours(page, AT_REST);
}

test('draws the arena and both mannequins with live textures, also after a reload', async ({
  page,
}, testInfo) => {
  // The dev server renders in StrictMode: this stage is the second mount, built after the first
  // one was disposed. Released or missing textures would not draw these colours.
  await expectMatchAtRest(page);
  await expect(page.getByTestId('arena').locator('canvas')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('game-screen.png'), fullPage: true });

  await page.reload();
  await expectMatchAtRest(page);
  await expect(page.getByTestId('arena').locator('canvas')).toHaveCount(1);
});

test('a jump spawns effects and triggers audio cues', async ({ page }) => {
  const effects = page.getByTestId('effects-spawned');
  const cues = page.getByTestId('audio-cues');
  await expect(effects).toHaveText(/\d+/);
  await expect(cues).toHaveText(/\d+/);
  const effectsBefore = Number(await effects.textContent());
  const cuesBefore = Number(await cues.textContent());

  // The key press is also the gesture that unlocks audio.
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => Number(await effects.textContent())).toBeGreaterThan(effectsBefore);
  await expect.poll(async () => Number(await cues.textContent())).toBeGreaterThan(cuesBefore);
  await page.keyboard.up('ArrowUp');
});

test('loads its fixtures from its own origin without failed requests or errors', async ({
  page,
  baseURL,
}) => {
  // The stage has loaded both manifests and every texture once it draws.
  await expectMatchAtRest(page);
  const urls = requested.get(page) ?? [];
  for (const manifest of ['arena', 'skeleton']) {
    expect(urls).toContain(new URL(`/fixtures/${manifest}/manifest.json`, baseURL).href);
  }
  expect(urls.filter((url) => url.includes('/fixtures/')).length).toBeGreaterThan(2);
  for (const url of urls.filter((url) => /^https?:/.test(url))) {
    expect(new URL(url).origin, url).toBe(new URL(baseURL ?? '').origin);
  }
  expect(problems.get(page)).toEqual([]);
});
