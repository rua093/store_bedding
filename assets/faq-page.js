(() => {
  const initFaqPage = (root) => {
    if (!root || root.dataset.faqInitialized === 'true') return;
    root.dataset.faqInitialized = 'true';

    const closeOtherItems = root.dataset.closeOtherItems === 'true';
    const items = Array.from(root.querySelectorAll('[data-faq-item]'));

    if (!closeOtherItems) return;

    items.forEach((item) => {
      item.addEventListener('toggle', () => {
        if (!item.open) return;
        items.forEach((otherItem) => {
          if (otherItem !== item) otherItem.removeAttribute('open');
        });
      });
    });
  };

  const initAllFaqPages = () => {
    document.querySelectorAll('[data-faq-page]').forEach(initFaqPage);
  };

  document.addEventListener('DOMContentLoaded', initAllFaqPages);
  document.addEventListener('shopify:section:load', (event) => {
    initFaqPage(event.target.querySelector('[data-faq-page]'));
  });
})();
