import { test, expect } from '@playwright/test';

test.describe('iPhone Configurator - UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/iphone');
  });

  test('loads with default state (iPhone 15 Pro)', async ({ page }) => {
    await expect(page.locator('#model-title')).toHaveText('iPhone 15 Pro');
    await expect(page.locator('#color-name')).toHaveText('Titanio Natural');
    await expect(page.locator('#capacity-name')).toHaveText('256 GB');
    // HTML shows base price; JS doesn't call updatePrice on default init
    await expect(page.locator('#price-display')).toContainText('1.219');
  });

  test('changes model on click', async ({ page }) => {
    await page.click('[data-model="iphone15promax"]');
    await expect(page.locator('#model-title')).toHaveText('iPhone 15 Pro Max');
    // 1469 + 120 (256GB) = 1589
    await expect(page.locator('#price-display')).toContainText('1589');
    await expect(page.locator('[data-model="iphone15promax"]')).toHaveClass(/selected/);
  });

  test('changes color on click', async ({ page }) => {
    await page.click('[data-hex="#2F333A"]');
    await expect(page.locator('#color-name')).toHaveText('Titanio Azul');
    await expect(page.locator('[data-hex="#2F333A"]')).toHaveClass(/selected/);
    await expect(page.locator('[data-hex="#5C5B57"]')).not.toHaveClass(/selected/);
  });

  test('changes capacity on click', async ({ page }) => {
    await page.click('[data-capacity="512"]');
    await expect(page.locator('#capacity-name')).toHaveText('512 GB');
    // 1219 + 350 (512GB) = 1569
    await expect(page.locator('#price-display')).toContainText('1569');
    await expect(page.locator('[data-capacity="512"]')).toHaveClass(/selected/);
  });

  test('price updates correctly with model + capacity combo', async ({ page }) => {
    // iPhone 15 (959€) + 1TB (+580€) = 1539
    await page.click('[data-model="iphone15"]');
    await page.click('[data-capacity="1024"]');
    await expect(page.locator('#price-display')).toContainText('1539');
  });

  test('image updates on model change', async ({ page }) => {
    await page.click('[data-model="iphone15promax"]');
    const src = await page.locator('#iphone-img').getAttribute('src');
    expect(src).toContain('15%20Pro%20Max');
  });

  test('image updates on color change', async ({ page }) => {
    await page.click('[data-hex="#181819"]');
    const src = await page.locator('#iphone-img').getAttribute('src');
    expect(src).toContain('181819');
  });

  test('loads with model from query param', async ({ page }) => {
    await page.goto('/iphone?model=iphone15');
    await expect(page.locator('#model-title')).toHaveText('iPhone 15');
    // 959 + 120 (256GB) = 1079
    await expect(page.locator('#price-display')).toContainText('1079');
    await expect(page.locator('[data-model="iphone15"]')).toHaveClass(/selected/);
  });
});
