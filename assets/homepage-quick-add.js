const configNode = document.getElementById('homepage-quick-add-config');

if (configNode) {
  let homepageQuickAddModules = [];

  try {
    homepageQuickAddModules = JSON.parse(configNode.textContent || '[]');
  } catch (error) {
    console.warn('[homepage quick-add] Failed to parse config:', error);
  }

  let homepageQuickAddSupportPromise = null;

  const loadModuleScript = (src) =>
    new Promise((resolve, reject) => {
      if (!src) {
        resolve();
        return;
      }

      if (document.querySelector(`script[type="module"][src="${src}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.type = 'module';
      script.src = src;
      script.fetchPriority = 'low';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });

  const ensureHomepageQuickAddSupport = () => {
    if (!homepageQuickAddSupportPromise) {
      homepageQuickAddSupportPromise = Promise.all(homepageQuickAddModules.map(loadModuleScript)).catch((error) => {
        homepageQuickAddSupportPromise = null;
        throw error;
      });
    }

    return homepageQuickAddSupportPromise;
  };

  window.__ensureHomepageQuickAddSupport = ensureHomepageQuickAddSupport;

  const quickAddSelectors = ['quick-add-component', '.quick-add__button', '#quick-add-dialog'].join(',');

  const primeQuickAddSupport = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest(quickAddSelectors)) return;

    ensureHomepageQuickAddSupport().catch((error) => {
      console.warn('[homepage quick-add] Failed to prime quick add support:', error);
    });
  };

  document.addEventListener('pointerenter', primeQuickAddSupport, true);
  document.addEventListener('focusin', primeQuickAddSupport, true);
  document.addEventListener('pointerdown', primeQuickAddSupport, true);
}
