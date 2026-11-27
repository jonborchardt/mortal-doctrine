import { expect, test, type Page } from '@playwright/test';

const AUDIO_LAB = '/labs/audio';

// Variations are a pure function of event identity, so this list is fixed.
const FIXTURE_LOG = [
  'frame 4 · command → command (command-low)',
  'frame 4 · command → command (command-low)',
  'frame 12 · command → command (command-high)',
  'frame 20 · jump → jump (jump-voice)',
  'frame 52 · land → land (land-thud)',
  'frame 70 · wall-contact → wall (wall-sting)',
];

async function fireAll(page: Page) {
  const buttons = page.getByRole('region', { name: 'Fixture events' }).getByRole('button');
  await expect(buttons).toHaveCount(FIXTURE_LOG.length);
  for (const button of await buttons.all()) await button.click();
}

test('audio lab is linked from navigation and loads directly', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: 'Labs' }).getByRole('link', { name: 'Audio Lab' }),
  ).toHaveAttribute('href', AUDIO_LAB);
  await page.goto(AUDIO_LAB);
  await expect(page.getByRole('heading', { name: 'Audio Lab' })).toBeVisible();
});

test('unlock, fire, re-simulate, bus controls and reset', async ({ page }, testInfo) => {
  await page.goto(AUDIO_LAB);
  const state = page.getByTestId('audio-state');
  const log = page.getByTestId('audio-log').getByRole('listitem');

  await expect(state).toHaveText('locked');
  await fireAll(page);
  await expect(log).toHaveCount(0);

  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(state).toHaveText('unlocked');
  // Events fired while locked were dropped, so Re-simulate has nothing to re-send.
  await page.getByRole('button', { name: 'Re-simulate' }).click();
  // Firing one event then shows only that event: the locked-period events were not replayed.
  await page.getByRole('region', { name: 'Fixture events' }).getByRole('button').first().click();
  await expect(log).toHaveText(FIXTURE_LOG.slice(0, 1));
  await fireAll(page);
  await expect(log).toHaveText(FIXTURE_LOG);

  await page.getByRole('button', { name: 'Re-simulate' }).click();
  await fireAll(page);
  await expect(log).toHaveText(FIXTURE_LOG);

  await page.getByRole('slider', { name: 'sfx volume' }).fill('0.5');
  await expect(page.getByTestId('audio-bus-sfx')).toHaveText('50%');
  await page.getByRole('checkbox', { name: 'Mute music' }).check();
  await expect(page.getByTestId('audio-bus-music')).toHaveText('muted · 100%');
  await expect(page.getByTestId('audio-bus-voice')).toHaveText('100%');
  // Review evidence: the triggered-cue list and bus controls.
  await page.screenshot({ path: testInfo.outputPath('audio-lab-fixture.png'), fullPage: true });

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(state).toHaveText('locked');
  await expect(log).toHaveCount(0);
  await expect(page.getByTestId('audio-bus-sfx')).toHaveText('100%');
  await expect(page.getByTestId('audio-bus-music')).toHaveText('100%');
  await expect(page.getByRole('checkbox', { name: 'Mute music' })).not.toBeChecked();
});
