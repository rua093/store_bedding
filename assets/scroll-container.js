/**
 * Returns the current page scroll container.
 *
 * @returns {Element} The scroll container element
 */
function getScrollContainer() {
  return document.scrollingElement ?? document.documentElement;
}

/**
 * Returns the current scroll position of the page scroll container.
 *
 * @returns {number} The scrollTop value
 */
function getScrollTop() {
  return getScrollContainer().scrollTop;
}

/**
 * Scrolls the page scroll container to the specified position.
 *
 * @param {ScrollToOptions} options - The scroll options (top, left, behavior)
 */
function scrollTo(options) {
  getScrollContainer().scrollTo(options);
}

/**
 * Saves the current scroll position into the current history entry.
 */
function saveScrollPosition() {
  try {
    const currentState = typeof history.state === 'object' && history.state !== null ? history.state : {};
    history.replaceState({ ...currentState, scrollTop: getScrollContainer().scrollTop }, '');
  } catch (_) {
    // replaceState can throw if the state object exceeds the browser's size limit
  }
}

/**
 * Restores a saved scroll position onto the current scroll container.
 *
 * @param {number} savedScrollTop
 */
function restoreSavedScrollTop(savedScrollTop) {
  if (!Number.isFinite(savedScrollTop) || savedScrollTop < 0) return;

  const container = getScrollContainer();
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const targetScrollTop = Math.min(savedScrollTop, maxScrollTop);

  container.scrollTo({ top: targetScrollTop, behavior: 'instant' });
}

/**
 * Retries scroll restoration briefly so back/forward navigation does not clamp to an
 * incomplete scrollHeight while images/sections are still settling.
 *
 * @param {number} savedScrollTop
 * @param {number} [attempt]
 */
function restoreSavedScrollTopWhenReady(savedScrollTop, attempt = 0) {
  if (!Number.isFinite(savedScrollTop) || savedScrollTop < 0) return;

  const container = getScrollContainer();
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const canReachSavedPosition = savedScrollTop <= maxScrollTop;
  const maxAttempts = 8;

  if (canReachSavedPosition || attempt >= maxAttempts || document.readyState === 'complete') {
    restoreSavedScrollTop(savedScrollTop);
    return;
  }

  requestAnimationFrame(() => restoreSavedScrollTopWhenReady(savedScrollTop, attempt + 1));
}

/**
 * Same-document scroll restoration for pushState navigation.
 *
 * `pagehide`/`pageshow` only fire for cross-document navigations. For same-document
 * pushState navigation (filters, pagination), we patch pushState to auto-save scroll
 * position before each new entry, and restore on popstate (back/forward).
 */
const originalPushState = history.pushState.bind(history);
history.pushState = function (state, title, url) {
  saveScrollPosition();
  originalPushState(state, title, url);
};

window.addEventListener('popstate', () => {
  const scrollTop = history.state?.scrollTop;
  if (scrollTop == null) return;

  requestAnimationFrame(() => {
    restoreSavedScrollTopWhenReady(scrollTop);
  });
});

/**
 * Returns the target for listening to page scroll events.
 *
 * @returns {EventTarget} The target to call addEventListener('scroll', ...) on
 */
function getScrollEventTarget() {
  return document;
}

/**
 * Returns the viewport root for page-level IntersectionObservers.
 *
 * @returns {Element | null} The root option for IntersectionObserver
 */
function getIntersectionRoot() {
  return null;
}

export {
  getScrollContainer,
  getScrollTop,
  scrollTo,
  getScrollEventTarget,
  getIntersectionRoot,
};
