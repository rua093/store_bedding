/**
 * Horizon overrides for Shopify.actions:
 * - updateCart: emit events from the cart drawer scope.
 * - openCart: open the cart drawer (fall back to /cart when absent).
 * - bridge Amazon Customizer's direct `/cart/add.js` calls into Horizon's
 *   cart event flow so the drawer refreshes and auto-opens like native adds.
 */

import { CartLinesUpdateEvent } from '@shopify/events';

let amazonCustomizerCartBridgeInstalled = false;

function parseJsonBody(body) {
  if (!body) return null;

  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (_error) {
      return null;
    }
  }

  if (body instanceof URLSearchParams) {
    const items = [];
    const grouped = new Map();

    for (const [key, value] of body.entries()) {
      const match = key.match(/^items\[(\d+)\]\[(.+)\]$/);
      if (!match) continue;

      const [, index, field] = match;
      const item = grouped.get(index) || {};
      item[field] = value;
      grouped.set(index, item);
    }

    grouped.forEach((item) => items.push(item));
    return items.length ? { items } : null;
  }

  if (body instanceof FormData) {
    const id = body.get('id');
    if (!id) return null;

    return {
      items: [
        {
          id,
          quantity: body.get('quantity') || 1,
          properties: {},
        },
      ],
    };
  }

  return null;
}

function isCartAddRequest(input) {
  const url = input instanceof Request ? input.url : String(input);

  try {
    const pathname = new URL(url, window.location.origin).pathname.replace(/\/+$/, '');
    return pathname.endsWith('/cart/add') || pathname.endsWith('/cart/add.js');
  } catch (_error) {
    return false;
  }
}

function isAmazonCustomizerPayload(payload) {
  return Boolean(
    payload?.items?.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        item.properties &&
        typeof item.properties === 'object' &&
        '_customization_id' in item.properties
    )
  );
}

function getCartSectionIds() {
  const sectionIds = new Set(['cart-icon-bubble']);

  document.querySelectorAll('cart-items-component[data-section-id]').forEach((component) => {
    const sectionId = component.getAttribute('data-section-id');
    if (sectionId) sectionIds.add(sectionId);
  });

  document
    .querySelectorAll('[data-cart-dependent-section][data-cart-recommendations-section-id]')
    .forEach((element) => {
      const sectionId = element.getAttribute('data-cart-recommendations-section-id');
      if (sectionId) sectionIds.add(sectionId);
    });

  return Array.from(sectionIds);
}

async function fetchCartStateForTheme() {
  const sectionIds = getCartSectionIds();
  const [cartResponse, sectionsResponse] = await Promise.all([
    fetch(`${window.Shopify.routes.root}cart.js`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    }),
    fetch(
      `${window.Shopify.routes.root}cart?sections=${encodeURIComponent(sectionIds.join(','))}&_=${Date.now()}`,
      {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
      }
    ),
  ]);

  if (!cartResponse.ok) {
    throw new Error(`Cart state refresh failed (${cartResponse.status})`);
  }

  if (!sectionsResponse.ok) {
    throw new Error(`Cart sections refresh failed (${sectionsResponse.status})`);
  }

  const [cart, sections] = await Promise.all([cartResponse.json(), sectionsResponse.json()]);
  return { cart, sections };
}

function installAmazonCustomizerCartBridge() {
  if (amazonCustomizerCartBridgeInstalled) return;
  amazonCustomizerCartBridgeInstalled = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);

    try {
      if (!isCartAddRequest(input) || !response.ok) {
        return response;
      }

      const payload = parseJsonBody(init?.body);
      if (!isAmazonCustomizerPayload(payload)) {
        return response;
      }

      const deferredCartUpdate = CartLinesUpdateEvent.createPromise();

      document.dispatchEvent(
        new CartLinesUpdateEvent({
          action: 'add',
          context: 'product',
          lines: (payload.items || []).map((item) => ({
            merchandiseId: String(item.id || ''),
            quantity: Number(item.quantity) || 1,
          })),
          promise: deferredCartUpdate.promise,
        })
      );

      fetchCartStateForTheme()
        .then(({ cart, sections }) => {
          deferredCartUpdate.resolve({
            cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
            detail: {
              sections,
              items: cart.items,
              itemCount: cart.item_count,
              source: 'amazon-customizer-theme-bridge',
              didError: false,
            },
          });
        })
        .catch((error) => {
          deferredCartUpdate.reject(error);
          console.warn('[theme-cart] Amazon customizer bridge failed to refresh cart UI:', error);
        });
    } catch (error) {
      console.warn('[theme-cart] Amazon customizer bridge failed:', error);
    }

    return response;
  };
}

function init() {
  const actions = window.Shopify?.actions;

  const getDrawer = () => document.querySelector('theme-drawer#cart-drawer');
  const openCartDrawer = () => {
    /** @type {HTMLElement & {open?: () => void} | null} */
    const drawer = getDrawer();

    if (drawer?.open) {
      drawer.open();
      return true;
    }

    window.location.href = Theme.routes.cart_url || '/cart';
    return false;
  };
  const closeCartDrawer = () => {
    /** @type {HTMLElement & {close?: () => void} | null} */
    const drawer = getDrawer();
    drawer?.close?.();
  };
  const toggleCartDrawer = () => {
    /** @type {HTMLElement & {toggle?: () => void} | null} */
    const drawer = getDrawer();

    if (drawer?.toggle) {
      drawer.toggle();
      return true;
    }

    return openCartDrawer();
  };

  window.ThemeCart = Object.assign(window.ThemeCart || {}, {
    drawerSelector: 'theme-drawer#cart-drawer',
    open: openCartDrawer,
    close: closeCartDrawer,
    toggle: toggleCartDrawer,
  });

  document.addEventListener('theme:cart:open', openCartDrawer);
  document.addEventListener('theme:cart:close', closeCartDrawer);
  document.addEventListener('theme:cart:toggle', toggleCartDrawer);
  installAmazonCustomizerCartBridge();

  if (!actions) return;

  actions.updateCart.configure({
    eventTarget: () => getDrawer() ?? document,
  });

  actions.openCart.configure({
    async handler() {
      openCartDrawer();
    },
  });
}

// Run immediately if the standard-actions bundle has already attached
// `Shopify.actions`; otherwise wait for DOMContentLoaded, which fires after
// all module scripts have executed regardless of document order.
if (window.Shopify?.actions) {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init, { once: true });
}
