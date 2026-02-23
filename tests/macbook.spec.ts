import { test, expect } from '@playwright/test';

test.describe('MacBook Configurator - UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/macbook');
  });

  test('loads with default state (MacBook Pro 14")', async ({ page }) => {
    await expect(page.locator('#model-title')).toHaveText('MacBook Pro 14"');
    await expect(page.locator('#color-name')).toHaveText('Gris Espacial');
    await expect(page.locator('#capacity-name')).toHaveText('512 GB');
    // HTML shows base price with default capacity
    await expect(page.locator('#price-display')).toContainText('2.229');
  });

  test('changes model on click', async ({ page }) => {
    await page.click('[data-model="macbookAir13"]');
    await expect(page.locator('#model-title')).toHaveText('MacBook Air 13"');
    // 1299 + 230 (512GB) = 1529
    await expect(page.locator('#price-display')).toContainText('1529');
    await expect(page.locator('[data-model="macbookAir13"]')).toHaveClass(/selected/);
  });

  test('changes color on click', async ({ page }) => {
    await page.click('[data-hex="#F0E4D3"]');
    await expect(page.locator('#color-name')).toHaveText('Estelar');
    await expect(page.locator('[data-hex="#F0E4D3"]')).toHaveClass(/selected/);
    await expect(page.locator('[data-hex="#6E6E73"]')).not.toHaveClass(/selected/);
  });

  test('changes capacity on click', async ({ page }) => {
    await page.click('[data-capacity="2048"]');
    await expect(page.locator('#capacity-name')).toHaveText('2 TB');
    // 1999 + 690 (2TB) = 2689
    await expect(page.locator('#price-display')).toContainText('2689');
    await expect(page.locator('[data-capacity="2048"]')).toHaveClass(/selected/);
  });

  test('price updates correctly with model + capacity combo', async ({ page }) => {
    // MacBook Air 15" (1499€) + 1TB (+460€) = 1959
    await page.click('[data-model="macbookAir15"]');
    await page.click('[data-capacity="1024"]');
    await expect(page.locator('#price-display')).toContainText('1959');
  });

  test('loads with model from query param', async ({ page }) => {
    await page.goto('/macbook?model=macbookPro16');
    await expect(page.locator('#model-title')).toHaveText('MacBook Pro 16"');
    // 2499 + 230 (512GB) = 2729
    await expect(page.locator('#price-display')).toContainText('2729');
    await expect(page.locator('[data-model="macbookPro16"]')).toHaveClass(/selected/);
  });
});
