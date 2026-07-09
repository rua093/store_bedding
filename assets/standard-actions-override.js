/**
 * Horizon overrides for Shopify.actions:
 * - updateCart: emit events from the cart drawer scope.
 * - openCart: open the cart drawer (fall back to /cart when absent).
 */

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
