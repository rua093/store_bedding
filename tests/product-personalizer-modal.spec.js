import { test, expect } from '@playwright/test';

const PRODUCT_URL = 'http://127.0.0.1:9292/products/personalized-blanket-test';

test.describe('Product personalizer modal', () => {
  test('stays usable after file and color interactions', async ({ page }) => {
    await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const trigger = page.locator('[data-personalizer-trigger]');
    const modal = page.locator('[data-personalizer-modal]');
    const panel = modal.locator('[data-personalizer-panel]');
    const header = modal.locator('.product-personalizer-popup__header');
    const footer = modal.locator('.product-personalizer-popup__footer');
    const form = modal.locator('.product-personalizer-popup__form');

    await expect(trigger).toBeVisible();
    await trigger.click();

    await expect(modal).toBeVisible();
    await expect(panel).toBeVisible();
    await expect(header).toBeVisible();
    await expect(form).toBeVisible();
    await expect(footer).toBeVisible();
    await expect(modal.getByText('Customize your order')).toBeVisible();
    await expect(modal.getByText('Text color')).toBeVisible();
    await expect(modal.getByText('Design file')).toBeVisible();

    await modal.locator('input[name="properties[Photo]"]').setInputFiles({
      name: 'preview-image.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake-image-content')
    });

    await modal.locator('input[name="properties[Design file]"]').setInputFiles({
      name: 'artwork.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fake pdf content')
    });

    await modal.locator('input[name="properties[Text color]"]').evaluate((input) => {
      input.value = '#112233';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await modal.locator('input[name="properties[Name]"]').fill('Codex Test');
    await modal.locator('textarea[name="properties[Message]"]').fill('Playwright regression check');
    await modal.locator('select[name="properties[Background]"]').selectOption({ index: 1 });

    await expect(modal).toBeVisible();
    await expect(header).toBeVisible();
    await expect(form).toBeVisible();
    await expect(footer).toBeVisible();
    await expect(modal.getByText('preview-image.png')).toBeVisible();
    await expect(modal.getByText('artwork.pdf')).toBeVisible();
    await expect(modal.getByText('#112233')).toBeVisible();

    const layout = await panel.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const inner = node.querySelector('.product-personalizer-popup__inner');
      const visibleFields = [...node.querySelectorAll('[data-personalizer-field]')].filter((field) => {
        const fieldRect = field.getBoundingClientRect();
        return fieldRect.width > 0 && fieldRect.height > 0;
      }).length;

      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        innerScrollHeight: inner ? inner.scrollHeight : 0,
        innerClientHeight: inner ? inner.clientHeight : 0,
        visibleFields
      };
    });

    expect(layout.width).toBeGreaterThan(400);
    expect(layout.height).toBeGreaterThan(300);
    expect(layout.visibleFields).toBeGreaterThanOrEqual(8);
    expect(layout.innerScrollHeight).toBeGreaterThan(0);
    expect(layout.innerClientHeight).toBeGreaterThan(0);

    await page.screenshot({
      path: 'playwright-artifacts/product-personalizer-modal-after-interactions.png',
      fullPage: false
    });

    await modal.locator('[data-personalizer-close]').last().click();
    await expect(modal).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('supports backdrop, escape, and validation reopening', async ({ page }) => {
    await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const trigger = page.locator('[data-personalizer-trigger]');
    const modal = page.locator('[data-personalizer-modal]');
    const panel = modal.locator('[data-personalizer-panel]');

    await trigger.click();
    await expect(modal).toBeVisible();

    const layout = await panel.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        panelZ: getComputedStyle(node).zIndex,
        modalZ: getComputedStyle(node.closest('[data-personalizer-modal]')).zIndex,
        headerZ: getComputedStyle(document.querySelector('header') || document.body).zIndex
      };
    });

    expect(layout.width).toBeGreaterThan(400);
    expect(layout.height).toBeGreaterThan(300);
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(Number(layout.modalZ) || 0).toBeGreaterThan(99900);

    await modal.locator('.product-personalizer-popup__close').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(modal.locator('.product-personalizer-popup__done')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(modal.locator('.product-personalizer-popup__close')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    await trigger.click();
    await expect(modal).toBeVisible();
    await modal.locator('.product-personalizer-popup__backdrop').evaluate((element) => {
      element.click();
    });
    await expect(modal).toBeHidden();

    await page.getByTestId('standalone-add-to-cart').click();
    await expect(modal).toBeVisible();
    await expect(modal.locator('[data-personalizer-errors]')).toBeVisible();
    await expect(modal.locator('[data-personalizer-errors]')).toContainText('Please complete the required personalization fields');
  });
});
