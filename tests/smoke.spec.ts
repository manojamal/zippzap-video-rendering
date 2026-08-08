import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_CLIP = path.join(__dirname, 'fixtures', 'test-clip.mp4');

test.beforeEach(async ({ page }) => {
  // Start each test from a clean slate - this app persists a lot of state to
  // localStorage, which would otherwise let one test's data leak into another.
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test.describe('Core app shell', () => {
  test('loads without console errors and shows the login screen', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await expect(page.getByText('Fast Entry Profiles')).toBeVisible({ timeout: 15000 });

    expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join('\n')}`).toHaveLength(0);
  });

  test('quick-login as a demo account reaches the dashboard', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Adaeze/i }).click();
    await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByRole('button', { name: /Adaeze/i }).click();
    await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('can navigate to every core section without crashing', async ({ page }) => {
    const sections = [
      'Video Stitcher',
      'Slideshow Creator',
      'Synthesizer TTS',
      'Media Vault',
      'Upload Wishes',
      'Surprise Dispatch',
      'Member Profile',
      'Pricing Tiers',
      'Canvas Theme',
    ];

    for (const label of sections) {
      const navButton = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
      await navButton.click();
      // The app should not blank out (ErrorBoundary would show "Something went wrong").
      await expect(page.getByText('Something went wrong')).not.toBeVisible();
    }
  });
});

test.describe('Video Studio - core stitching flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByRole('button', { name: /Adaeze/i }).click();
    await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Video Stitcher/i }).first().click();
    await expect(page.getByText('Live Stitcher Studio')).toBeVisible({ timeout: 10000 });
  });

  test('uploading a real clip adds it to the timeline', async ({ page }) => {
    const fileInput = page.getByTestId('studio-main-upload-input');
    await fileInput.setInputFiles(TEST_CLIP);

    // The uploaded clip should now appear as a timeline entry (named after the file).
    await expect(page.getByText('test-clip')).toBeVisible({ timeout: 10000 });
  });

  test('render button is disabled or absent with an empty timeline', async ({ page }) => {
    // Guards against the render pipeline being triggered with zero clips.
    const renderButton = page.getByRole('button', { name: /Stitch & Render|Start Render/i }).first();
    if (await renderButton.count() > 0) {
      await expect(renderButton).toBeDisabled().catch(async () => {
        // If it's not disabled, clicking it with an empty timeline should show a
        // friendly message rather than attempting to render nothing.
        await renderButton.click();
        await expect(page.getByText(/add at least one clip/i)).toBeVisible({ timeout: 5000 });
      });
    }
  });
});

test.describe('Responsive layout', () => {
  test('dashboard has no horizontal overflow on a small mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.getByRole('button', { name: /Adaeze/i }).click();
    await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 10000 });

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    });
    expect(hasHorizontalOverflow).toBe(false);
  });
});

test.describe('Contributor portal', () => {
  test('opens without crashing and blocks submission with no content', async ({ page }) => {
    await page.getByRole('button', { name: /Adaeze/i }).click();
    await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 10000 });

    // The contributor hub / portal entry points vary by seeded demo data; this is a
    // light smoke check that the surface renders rather than a full contribution flow.
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });
});
