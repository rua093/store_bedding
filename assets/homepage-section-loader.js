const MODULE_SELECTOR = 'script[data-homepage-module][data-src][data-observe-selector]';
const observedModules = new Map();

function loadModule(script) {
  if (!(script instanceof HTMLScriptElement)) return;
  if (script.dataset.moduleState === 'loading' || script.dataset.moduleState === 'loaded') return;

  const src = script.dataset.src;
  if (!src) return;

  script.dataset.moduleState = 'loading';
  script.addEventListener('load', () => {
    script.dataset.moduleState = 'loaded';
  }, { once: true });
  script.addEventListener('error', () => {
    script.dataset.moduleState = 'error';
    script.removeAttribute('src');
  }, { once: true });
  script.src = src;
}

function getTarget(script) {
  const selector = script.dataset.observeSelector;
  if (!selector) return null;

  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function observeModule(script) {
  if (!(script instanceof HTMLScriptElement)) return;
  if (script.dataset.moduleState === 'loading' || script.dataset.moduleState === 'loaded') return;

  const target = getTarget(script);
  if (!target) return;

  if (window.Shopify?.designMode || !('IntersectionObserver' in window)) {
    loadModule(script);
    return;
  }

  observedModules.get(script)?.disconnect();

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    observedModules.delete(script);
    loadModule(script);
  }, { rootMargin: '1000px 0px' });

  observer.observe(target);
  observedModules.set(script, observer);
}

function observeModules() {
  document.querySelectorAll(MODULE_SELECTOR).forEach(observeModule);
}

function loadModuleForInteraction(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  document.querySelectorAll(MODULE_SELECTOR).forEach((script) => {
    const moduleTarget = getTarget(script);
    if (moduleTarget?.contains(target)) loadModule(script);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observeModules, { once: true });
} else {
  observeModules();
}

document.addEventListener('pointerdown', loadModuleForInteraction, true);
document.addEventListener('focusin', loadModuleForInteraction, true);
document.addEventListener('shopify:section:load', observeModules);
document.addEventListener('shopify:section:reorder', observeModules);
