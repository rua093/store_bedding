(() => {
  const initFaqPage = (root) => {
    if (!root || root.dataset.faqInitialized === 'true') return;
    root.dataset.faqInitialized = 'true';

    const closeOtherItems = root.dataset.closeOtherItems === 'true';
    const items = Array.from(root.querySelectorAll('[data-faq-item]'));
    const syncItemState = (item) => {
      const summary = item.querySelector('summary');
      const answer = item.querySelector('.faq-page__answer');
      const isOpen = item.hasAttribute('open');

      if (summary instanceof HTMLElement) {
        summary.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }

      if (answer instanceof HTMLElement) {
        answer.hidden = !isOpen;
      }
    };

    items.forEach((item) => {
      item.removeAttribute('open');
      syncItemState(item);
    });

    items.forEach((item) => {
      item.addEventListener('toggle', () => {
        if (item.open && closeOtherItems) {
          items.forEach((otherItem) => {
            if (otherItem !== item) {
              otherItem.removeAttribute('open');
              syncItemState(otherItem);
            }
          });
        }

        syncItemState(item);
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
