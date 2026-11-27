import { expect, type Page } from '@playwright/test';

// Canvas colour sampling shared by the Studio lab specs. The sampled canvas is the one inside
// the element with test id `arena`.

export type Rgb = readonly [number, number, number];
export type Point = { readonly x: number; readonly y: number };

export const arenaCanvas = (page: Page) => page.getByTestId('arena').locator('canvas');

/** The few browser APIs the in-page sampler uses (e2e code is typed without the DOM lib). */
interface PixelBrowser {
  createImageBitmap(blob: Blob): Promise<{ readonly width: number; readonly height: number }>;
  OffscreenCanvas: new (
    width: number,
    height: number,
  ) => {
    getContext(type: '2d'): {
      drawImage(image: unknown, x: number, y: number): void;
      getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
    } | null;
  };
}

/** Colours at logical canvas points, read from a screenshot (no WebGL readback needed). */
async function sampleCanvas(page: Page, points: readonly Point[]): Promise<Rgb[]> {
  const canvas = arenaCanvas(page);
  const logicalWidth = Number(await canvas.getAttribute('width'));
  const png = (await canvas.screenshot()).toString('base64');
  return page.evaluate(
    async ({ png, points, logicalWidth }) => {
      const browser = globalThis as unknown as PixelBrowser;
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
      const bitmap = await browser.createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      // The canvas is CSS-stretched to its host, so scale logical points to screenshot pixels.
      const scale = bitmap.width / logicalWidth;
      const context = new browser.OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
      if (!context) throw new Error('No 2D context');
      context.drawImage(bitmap, 0, 0);
      return points.map(({ x, y }): [number, number, number] => {
        const [r = 0, g = 0, b = 0] = context.getImageData(
          Math.round(x * scale),
          Math.round(y * scale),
          1,
          1,
        ).data;
        return [r, g, b];
      });
    },
    { png, points, logicalWidth },
  );
}

const near = (actual: Rgb, expected: Rgb) =>
  actual.every((channel, index) => Math.abs(channel - (expected[index] ?? 0)) <= 24);

/** Polls until every point has (or, with `not`, lacks) its colour. */
export async function expectColours(
  page: Page,
  checks: readonly { point: Point; colour: Rgb; not?: boolean }[],
) {
  await expect
    .poll(async () => {
      const colours = await sampleCanvas(
        page,
        checks.map(({ point }) => point),
      );
      return checks.map(
        ({ colour, not = false }, index) => near(colours[index] ?? [0, 0, 0], colour) !== not,
      );
    })
    .toEqual(checks.map(() => true));
}
