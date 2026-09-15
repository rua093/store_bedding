const { test, expect } = require('@playwright/test');

const BLANKET_PATH =
  '/products/personalized-basketball-with-reflection-blanket-with-name-and-number-266702782c-266702782c';

const VARIANTS = [
  { id: 101, options: ['Quilt', 'Throw', 'No Pillowcases'], available: true },
  { id: 102, options: ['Quilt', 'Throw', '1 Pillowcase'], available: true },
  { id: 103, options: ['Quilt', 'Throw', '2 Pillowcases'], available: true },
  { id: 104, options: ['Quilt', 'Twin', 'No Pillowcases'], available: true },
  { id: 105, options: ['Quilt', 'Twin', '1 Pillowcase'], available: true },
  { id: 106, options: ['Quilt', 'Twin', '2 Pillowcases'], available: true },
  { id: 201, options: ['Comforter', 'Twin', 'No Pillowcases'], available: true },
  { id: 202, options: ['Comforter', 'Twin', '2 Pillowcases'], available: true },
  { id: 203, options: ['Comforter', 'Twin', '4 Pillowcases'], available: true },
  { id: 204, options: ['Comforter', 'Twin', '2 Pillowcases + 1 Sheet'], available: true },
  { id: 205, options: ['Comforter', 'Queen', '2 Pillowcases + 1 Sheet'], available: true },
  { id: 301, options: ['Duvet Cover', 'Twin Duvet', 'No Pillowcases'], available: true },
  { id: 302, options: ['Duvet Cover', 'Queen Duvet', '2 Pillowcases'], available: true },
];

function fieldset(name, values, checkedValue) {
  const indexByName = { 'Bedding Type': 0, Size: 1, 'Set Options': 2 };
  const optionIndex = indexByName[name];
  return `
    <fieldset ref="fieldsets[]" class="variant-option" data-fieldset-index="${optionIndex}">
      <legend>${name}</legend>
      ${values
        .map(
          (value, inputIndex) => `
            <label>
              <input
                type="radio"
                name="${name}"
                value="${value}"
                data-option-name="${name}"
                data-option-value-id="${optionIndex + 1}-${inputIndex + 1}"
                data-fieldset-index="${optionIndex}"
                data-input-index="${inputIndex}"
                data-current-checked="${value === checkedValue ? 'true' : 'false'}"
                ${value === checkedValue ? 'checked' : ''}
              >
              <span>${value}</span>
            </label>
          `
        )
        .join('')}
    </fieldset>
  `;
}

async function mountSyntheticBeddingPicker(page) {
  const syntheticPickerHtml = `
    <variant-picker
      data-product-type="Bedding"
      data-product-url="/products/synthetic-bedding"
      data-option-names='["Bedding Type","Size","Set Options"]'
      data-template-product-match="true"
    >
      <form>
        ${fieldset('Bedding Type', ['Quilt', 'Comforter', 'Duvet Cover'], 'Quilt')}
        ${fieldset('Size', ['Throw', 'Twin', 'Queen', 'Twin Duvet', 'Queen Duvet'], 'Throw')}
        ${fieldset(
          'Set Options',
          ['No Pillowcases', '1 Pillowcase', '2 Pillowcases', '4 Pillowcases', '2 Pillowcases + 1 Sheet'],
          'No Pillowcases'
        )}
        <script type="application/json">${JSON.stringify(VARIANTS[0])}</script>
        <script type="application/json" data-product-variants>${JSON.stringify(VARIANTS)}</script>
      </form>
    </variant-picker>
  `;

  await page.evaluate(({ variants, html }) => {
    window.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '<main></main>',
    });

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    document.body.append(wrapper);
  }, { variants: VARIANTS, html: syntheticPickerHtml });

  await page.waitForSelector('variant-picker[data-product-type="Bedding"]');
}

async function visibleValues(page, optionName) {
  return page.$$eval(`input[data-option-name="${optionName}"]`, (inputs) =>
    inputs
      .filter((input) => !input.closest('label').hidden)
      .map((input) => input.value)
  );
}

async function checkedValue(page, optionName) {
  return page.$eval(`input[data-option-name="${optionName}"]:checked`, (input) => input.value);
}

async function labelHidden(page, value) {
  return page.$eval(`input[value="${value}"]`, (input) => input.closest('label').hidden);
}

async function choose(page, optionName, value) {
  await page.locator(`input[data-option-name="${optionName}"][value="${value}"]`).evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`Bedding dependent variant picker ${viewport.name}`, () => {
    test.use({ viewport });

    test('filters and resets Size / Set Options from real variant combinations', async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.goto(`http://127.0.0.1:9293${BLANKET_PATH}`);
      await mountSyntheticBeddingPicker(page);

      await choose(page, 'Bedding Type', 'Quilt');
      await choose(page, 'Size', 'Throw');
      await choose(page, 'Set Options', '2 Pillowcases');
      await expect.poll(() => checkedValue(page, 'Set Options')).toBe('2 Pillowcases');
      await expect.poll(() => visibleValues(page, 'Size')).toEqual(['Throw', 'Twin']);
      await expect.poll(() => visibleValues(page, 'Set Options')).toEqual([
        'No Pillowcases',
        '1 Pillowcase',
        '2 Pillowcases',
      ]);

      await choose(page, 'Bedding Type', 'Comforter');
      await expect.poll(() => checkedValue(page, 'Size')).toBe('Twin');
      await expect.poll(() => checkedValue(page, 'Set Options')).toBe('2 Pillowcases');
      await expect.poll(() => visibleValues(page, 'Size')).toEqual(['Twin', 'Queen']);
      await expect.poll(() => visibleValues(page, 'Set Options')).toEqual([
        'No Pillowcases',
        '2 Pillowcases',
        '4 Pillowcases',
        '2 Pillowcases + 1 Sheet',
      ]);

      await choose(page, 'Set Options', '2 Pillowcases + 1 Sheet');
      await expect.poll(() => checkedValue(page, 'Set Options')).toBe('2 Pillowcases + 1 Sheet');

      await choose(page, 'Bedding Type', 'Duvet Cover');
      await expect.poll(() => checkedValue(page, 'Size')).toBe('Twin Duvet');
      await expect.poll(() => checkedValue(page, 'Set Options')).toBe('No Pillowcases');
      await expect.poll(() => visibleValues(page, 'Set Options')).toEqual(['No Pillowcases']);
      await expect.poll(() => labelHidden(page, '2 Pillowcases + 1 Sheet')).toBe(true);
      await expect.poll(() => labelHidden(page, '4 Pillowcases')).toBe(true);
      await expect(page).toHaveURL(/variant=301/);
      expect(pageErrors.filter((message) => message !== 'No empty section markup found')).toEqual([]);
    });
  });
}

test('Blanket PDP is not treated as a Bedding dependent picker', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`http://127.0.0.1:9293${BLANKET_PATH}`);
  const productType = await page.locator('variant-picker').first().getAttribute('data-product-type');
  const hiddenOptionCount = await page.locator('variant-picker fieldset label[hidden]').count();

  expect(productType).toBe('Blanket');
  expect(hiddenOptionCount).toBe(0);
  expect(pageErrors).toEqual([]);
});
