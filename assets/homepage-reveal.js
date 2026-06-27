import { getIntersectionRoot, scrollContainerMediaQuery } from '@theme/scroll-container';

const REVEAL_SELECTOR = '.homepage-reveal';
const STAGGER_PARENT_SELECTOR = '[data-homepage-reveal-children]';
const STAGGER_STEP_MS = 55;
const REVEAL_DURATION_MS = 480;
const NEAR_VIEWPORT_OFFSET_PX = 120;

let observer = null;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function getHomepageMain() {
  return document.querySelector('main[data-template*="index"]');
}

function markVisible(element) {
  element.classList.add('is-visible');
  if (!element.classList.contains('homepage-reveal--pending')) return;

  finalizeVisibleState(element);
}

function markVisibleImmediately(elements) {
  elements.forEach((element) => {
    element.classList.remove('homepage-reveal--pending');
    markVisible(element);
  });
}

function finalizeVisibleState(element) {
  if (!element.classList.contains('homepage-reveal--pending')) return;

  const cleanup = () => {
    element.classList.remove('homepage-reveal--pending');
    element.removeEventListener('transitionend', handleTransitionEnd);
  };

  const handleTransitionEnd = (event) => {
    if (event.target !== element || event.propertyName !== 'opacity') return;
    cleanup();
  };

  element.addEventListener('transitionend', handleTransitionEnd);

  window.setTimeout(cleanup, REVEAL_DURATION_MS + 80);
}

function applyStaggerTargets(scope) {
  scope.querySelectorAll(STAGGER_PARENT_SELECTOR).forEach((parent) => {
    const selector = parent.getAttribute('data-homepage-reveal-children');
    if (!selector) return;

    parent.querySelectorAll(selector).forEach((child, index) => {
      child.classList.add('homepage-reveal');

      if (!child.style.getPropertyValue('--reveal-delay')) {
        child.style.setProperty('--reveal-delay', `${index * STAGGER_STEP_MS}ms`);
      }
    });
  });
}

function getRevealElements(scope = document) {
  applyStaggerTargets(scope);
  return Array.from(scope.querySelectorAll(REVEAL_SELECTOR));
}

function cleanupObserver() {
  observer?.disconnect();
  observer = null;
}

function createObserver() {
  const root = getIntersectionRoot();

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        markVisible(entry.target);
        observer?.unobserve(entry.target);
      });
    },
    {
      root,
      rootMargin: '0px 0px -10% 0px',
      threshold: 0.16,
    }
  );
}

function isNearViewport(element) {
  const root = getIntersectionRoot();
  const elementRect = element.getBoundingClientRect();

  if (root instanceof Element) {
    const rootRect = root.getBoundingClientRect();

    return (
      elementRect.bottom >= rootRect.top - NEAR_VIEWPORT_OFFSET_PX &&
      elementRect.top <= rootRect.bottom + NEAR_VIEWPORT_OFFSET_PX
    );
  }

  return (
    elementRect.bottom >= -NEAR_VIEWPORT_OFFSET_PX &&
    elementRect.top <= window.innerHeight + NEAR_VIEWPORT_OFFSET_PX
  );
}

function observeReveals() {
  const homepageMain = getHomepageMain();
  if (!homepageMain) return;

  const revealElements = getRevealElements(document).filter((element) => homepageMain.contains(element));
  if (!revealElements.length) return;

  if (reducedMotionQuery.matches || !('IntersectionObserver' in window)) {
    markVisibleImmediately(revealElements);
    return;
  }

  homepageMain.classList.add('homepage-motion-ready');

  cleanupObserver();
  createObserver();

  revealElements.forEach((element) => {
    if (element.classList.contains('is-visible')) return;
    if (isNearViewport(element)) {
      markVisible(element);
      return;
    }

    element.classList.add('homepage-reveal--pending');
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
