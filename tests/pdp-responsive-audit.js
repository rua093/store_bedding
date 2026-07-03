const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PRODUCT_PATH = '/products/jeminise-customized-reading-blanket-and-throw-book-lovers-daughter-b0bb96k6h8';
const BASE_URL = 'http://127.0.0.1:9292';

const viewports = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'mobile-390', width: 390, height: 844 },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function auditViewport(browser, viewport, outputDir) {
  const page = await browser.newPage({ viewport });
  const url = `${BASE_URL}${PRODUCT_PATH}`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  const initial = await page.evaluate(() => {
    const root = document.documentElement;
    const pageWrapper = document.querySelector('.page-wrapper');
    const pdp = document.querySelector('.product-information--main-product');
    const media = document.querySelector('[data-testid="product-information-media"]');
    const details = document.querySelector('[data-testid="product-information-details"]');
    const detailsBelow = document.querySelector('[data-product-details-below]');
    const buyButtons = document.querySelector('.buy-buttons-block .product-form-buttons');
    const stickyRoot = document.querySelector('sticky-add-to-cart');
    const stickyBar = stickyRoot?.querySelector('.sticky-add-to-cart__bar');

    const candidates = [...document.querySelectorAll('body *')];
    const overflowElements = candidates
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          className: typeof el.className === 'string' ? el.className.trim().slice(0, 120) : '',
          width: Math.round(rect.width),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        };
      })
      .filter((item) => item.width > 0 && (item.left < -1 || item.right > window.innerWidth + 1))
      .slice(0, 20);

    const rectFor = (el) =>
      el
        ? {
            top: Math.round(el.getBoundingClientRect().top),
            bottom: Math.round(el.getBoundingClientRect().bottom),
            left: Math.round(el.getBoundingClientRect().left),
            right: Math.round(el.getBoundingClientRect().right),
            width: Math.round(el.getBoundingClientRect().width),
            height: Math.round(el.getBoundingClientRect().height),
          }
        : null;

    return {
      title: document.title,
      viewportWidth: window.innerWidth,
      htmlScrollWidth: root.scrollWidth,
      pageWrapperScrollWidth: pageWrapper ? pageWrapper.scrollWidth : null,
      bodyScrollWidth: document.body.scrollWidth,
      stickyReserve: getComputedStyle(document.documentElement).getPropertyValue('--sticky-add-to-cart-reserve').trim(),
      hasSticky: !!stickyRoot,
      stickyVisible: stickyBar ? stickyBar.dataset.stuck === 'true' && getComputedStyle(stickyBar).display !== 'none' : false,
      pdpRect: rectFor(pdp),
      mediaRect: rectFor(media),
      detailsRect: rectFor(details),
      detailsBelowRect: rectFor(detailsBelow),
      buyButtonsRect: rectFor(buyButtons),
      overflowElements,
    };
  });

  await page.screenshot({ path: path.join(outputDir, `${viewport.name}-top.png`), fullPage: true });

  await page.evaluate(() => {
    const scrollRoot = document.querySelector('.page-wrapper') || document.scrollingElement || document.documentElement;
    scrollRoot.scrollTo({ top: 1400, behavior: 'auto' });
  });
  await page.waitForTimeout(1200);

  const midScroll = await page.evaluate(() => {
    const stickyRoot = document.querySelector('sticky-add-to-cart');
    const stickyBar = stickyRoot?.querySelector('.sticky-add-to-cart__bar');
    const pageWrapper = document.querySelector('.page-wrapper');
    return {
      scrollTop: pageWrapper ? pageWrapper.scrollTop : (document.scrollingElement?.scrollTop || window.scrollY || 0),
      stickyVisible: stickyBar ? stickyBar.dataset.stuck === 'true' && getComputedStyle(stickyBar).display !== 'none' : false,
      stickyRect: stickyBar
        ? {
            top: Math.round(stickyBar.getBoundingClientRect().top),
            bottom: Math.round(stickyBar.getBoundingClientRect().bottom),
            height: Math.round(stickyBar.getBoundingClientRect().height),
          }
        : null,
      reserve: getComputedStyle(document.documentElement).getPropertyValue('--sticky-add-to-cart-reserve').trim(),
    };
  });

  await page.screenshot({ path: path.join(outputDir, `${viewport.name}-mid.png`), fullPage: false });

  await page.evaluate(() => {
    const scrollRoot = document.querySelector('.page-wrapper') || document.scrollingElement || document.documentElement;
    scrollRoot.scrollTo({ top: scrollRoot.scrollHeight, behavior: 'auto' });
  });
  await page.waitForTimeout(1200);

  const bottomScroll = await page.evaluate(() => {
    const stickyRoot = document.querySelector('sticky-add-to-cart');
    const stickyBar = stickyRoot?.querySelector('.sticky-add-to-cart__bar');
    const pageWrapper = document.querySelector('.page-wrapper');
    const pdp = document.querySelector('.product-information--main-product');
    const footer = document.querySelector('.footer-wrapper, footer');
    return {
      scrollTop: pageWrapper ? pageWrapper.scrollTop : (document.scrollingElement?.scrollTop || window.scrollY || 0),
      stickyVisible: stickyBar ? stickyBar.dataset.stuck === 'true' && getComputedStyle(stickyBar).display !== 'none' : false,
      stickyRect: stickyBar
        ? {
            top: Math.round(stickyBar.getBoundingClientRect().top),
            bottom: Math.round(stickyBar.getBoundingClientRect().bottom),
            height: Math.round(stickyBar.getBoundingClientRect().height),
          }
        : null,
      pdpRect: pdp
        ? {
            top: Math.round(pdp.getBoundingClientRect().top),
            bottom: Math.round(pdp.getBoundingClientRect().bottom),
          }
        : null,
      footerRect: footer
        ? {
            top: Math.round(footer.getBoundingClientRect().top),
            bottom: Math.round(footer.getBoundingClientRect().bottom),
          }
        : null,
    };
  });

  await page.screenshot({ path: path.join(outputDir, `${viewport.name}-bottom.png`), fullPage: false });
  await page.close();

  return { viewport, initial, midScroll, bottomScroll };
}

(async () => {
  const outputDir = path.join(process.cwd(), 'playwright-artifacts', 'pdp-responsive-audit');
  ensureDir(outputDir);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const viewport of viewports) {
      results.push(await auditViewport(browser, viewport, outputDir));
    }
  } finally {
    await browser.close();
  }

  const reportPath = path.join(outputDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`Wrote ${reportPath}`);
  console.log(JSON.stringify(results, null, 2));
})();
