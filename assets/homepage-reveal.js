import { getIntersectionRoot, scrollContainerMediaQuery } from '@theme/scroll-container';

const REVEAL_SELECTOR = '.homepage-reveal';
const STAGGER_PARENT_SELECTOR = '[data-homepage-reveal-children]';
const STAGGER_STEP_MS = 55;
const REVEAL_DURATION_MS = 480;

/** @type {IntersectionObserver | null} */
let observer = null;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

/** @type {Map<Element, number>} */
const cleanupTimeouts = new Map();

function getHomepageMain() {
  return document.querySelector('main[data-template*="index"]');
}

/**
 * @param {Element} element
 */
function startReveal(element) {
  const existingTimeout = cleanupTimeouts.get(element);
  if (existingTimeout) {
    window.clearTimeout(existingTimeout);
    cleanupTimeouts.delete(element);
  }

  element.classList.add('homepage-reveal--pending');
  element.classList.remove('is-visible');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (element.classList.contains('homepage-reveal--pending')) {
        markVisible(element);
      }
    });
  });
}

/**
 * @param {Element} element
 */
function resetReveal(element) {
  const existingTimeout = cleanupTimeouts.get(element);
  if (existingTimeout) {
    window.clearTimeout(existingTimeout);
    cleanupTimeouts.delete(element);
  }

  element.classList.remove('is-visible');
  element.classList.add('homepage-reveal--pending');
}

/**
 * @param {Element} element
 */
function markVisible(element) {
  element.classList.add('is-visible');
  if (!element.classList.contains('homepage-reveal--pending')) return;

  finalizeVisibleState(element);
}

/**
 * @param {Element[]} elements
 */
function markVisibleImmediately(elements) {
  elements.forEach((element) => {
    element.classList.remove('homepage-reveal--pending');
    markVisible(element);
  });
}

/**
 * @param {string} timeStr
 * @returns {number}
 */
function parseTimeMs(timeStr) {
  const trimmed = timeStr.trim();
  if (trimmed.endsWith('ms')) {
    return parseFloat(trimmed) || 0;
  }
  if (trimmed.endsWith('s')) {
    return (parseFloat(trimmed) || 0) * 1000;
  }
  return 0;
}

/**
 * @param {Element} element
 * @returns {number}
 */
function getTransitionTimeoutMs(element) {
  try {
    const style = window.getComputedStyle(element);
    const durations = style.transitionDuration.split(',').map((d) => parseTimeMs(d));
    const delays = style.transitionDelay.split(',').map((d) => parseTimeMs(d));

    let maxTime = 0;
    const count = Math.max(durations.length, delays.length);
    for (let i = 0; i < count; i++) {
      const duration = durations[i % durations.length] || 0;
      const delay = delays[i % delays.length] || 0;
      maxTime = Math.max(maxTime, duration + delay);
    }
    return maxTime || REVEAL_DURATION_MS;
  } catch (e) {
    return REVEAL_DURATION_MS;
  }
}

/**
 * @param {Element} element
 */
function finalizeVisibleState(element) {
  const existingTimeout = cleanupTimeouts.get(element);
  if (existingTimeout) {
    window.clearTimeout(existingTimeout);
    cleanupTimeouts.delete(element);
  }

  if (!element.classList.contains('homepage-reveal--pending')) return;

  const cleanup = () => {
    if (element.classList.contains('is-visible')) {
      element.classList.remove('homepage-reveal--pending');
    }
    cleanupTimeouts.delete(element);
  };

  const timeout = getTransitionTimeoutMs(element);
  const timeoutId = window.setTimeout(cleanup, timeout + 200);
  cleanupTimeouts.set(element, timeoutId);
}

/**
 * @param {ParentNode} scope
 */
function applyStaggerTargets(scope) {
  scope.querySelectorAll(STAGGER_PARENT_SELECTOR).forEach((/** @type {Element} */ parent) => {
    const selector = parent.getAttribute('data-homepage-reveal-children');
    if (!selector) return;

    const baseDelay = parseInt(parent.getAttribute('data-homepage-reveal-base-delay') || '0', 10) || 0;
    const staggerStep = parseInt(parent.getAttribute('data-homepage-reveal-stagger') || '', 10) || STAGGER_STEP_MS;
    const revealPreset = parent.getAttribute('data-homepage-reveal-preset');

    parent.querySelectorAll(selector).forEach((/** @type {HTMLElement} */ child, /** @type {number} */ index) => {
      child.classList.add('homepage-reveal');

      if (revealPreset && !child.dataset.revealPreset) {
        child.dataset.revealPreset = revealPreset;
      }

      if (!child.style.getPropertyValue('--reveal-delay')) {
        child.style.setProperty('--reveal-delay', `${baseDelay + index * staggerStep}ms`);
      }
    });
  });
}

/**
 * @param {ParentNode} scope
 * @returns {HTMLElement[]}
 */
function getRevealElements(scope = document) {
  applyStaggerTargets(scope);
  return Array.from(scope.querySelectorAll(REVEAL_SELECTOR));
}

function cleanupObserver() {
  observer?.disconnect();
  observer = null;

  cleanupTimeouts.forEach((timeoutId) => {
    window.clearTimeout(timeoutId);
  });
  cleanupTimeouts.clear();
}

function createObserver() {
  const root = getIntersectionRoot();

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const element = entry.target;
        if (!entry.isIntersecting) return;

        startReveal(element);
        observer?.unobserve(element);
      });
    },
    {
      root,
      rootMargin: '-12% 0px -12% 0px',
      threshold: 0,
    }
  );
}

function observeReveals() {
  const homepageMain = getHomepageMain();
  if (!homepageMain) {
    document.documentElement.classList.remove('homepage-motion-booting');
    return;
  }

  const revealElements = getRevealElements(document).filter((element) => homepageMain.contains(element));
  if (!revealElements.length) {
    document.documentElement.classList.remove('homepage-motion-booting');
    return;
  }

  if (reducedMotionQuery.matches || !('IntersectionObserver' in window)) {
    document.documentElement.classList.remove('homepage-motion-booting');
    markVisibleImmediately(revealElements);
    return;
  }

  revealElements.forEach((element) => {
    element.classList.add('homepage-reveal--pending');
  });

  homepageMain.classList.add('homepage-motion-ready');
  document.documentElement.classList.remove('homepage-motion-booting');

  cleanupObserver();
  createObserver();

  revealElements.forEach((element) => {
    observer?.observe(element);
  });
}

function refreshReveals() {
  cleanupObserver();
  observeReveals();
}

document.addEventListener('DOMContentLoaded', () => {
  observeReveals();
});

document.addEventListener('shopify:section:load', () => {
  refreshReveals();
});

document.addEventListener('shopify:section:reorder', () => {
  refreshReveals();
});

reducedMotionQuery.addEventListener('change', () => {
  refreshReveals();
});

scrollContainerMediaQuery.addEventListener('change', () => {
  refreshReveals();
});




