const PAGE_WRAPPER_SELECTOR = '.page-wrapper';
const SQUEEZE_QUERY = window.matchMedia('(min-width: 990px)');

/**
 * Returns the current page scroll container.
 * In the squeeze layout (desktop ≥990px), `.page-wrapper` is the scroll container instead of
 * `document.scrollingElement`. On mobile, the document root scrolls natively so the address bar
 * can hide/show.
 *
 * @returns {Element} The scroll container element
 */
function getScrollContainer() {
  if (SQUEEZE_QUERY.matches) {
    return document.querySelector(PAGE_WRAPPER_SELECTOR) ?? document.scrollingElement ?? document.documentElement;
  }
  return document.scrollingElement ?? document.documentElement;
}

/**
 * Returns the current page navigation type, when supported.
 *
 * @returns {string | undefined}
 */
function getNavigationType() {
  const [navigationEntry] = performance.getEntriesByType?.('navigation') ?? [];
  return navigationEntry?.type;
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
 * Manual scroll restoration for `.page-wrapper` as scroll container.
 *
 * On desktop (≥990px), the browser restores scroll on `document.scrollingElement`, which
 * has `overflow: hidden` in the squeeze layout and can never scroll. We disable native
 * restoration and handle it via `history.state` instead.
 *
 * On mobile (<990px), `document.scrollingElement` IS the scroll container, so native
 * restoration works perfectly — leave it enabled to avoid a one-frame flash from rAF.
 *
 * Save: `pagehide` — fires exactly once per navigation, captures the exact scroll position
 * at the moment the user leaves. More accurate than debounced scroll (which can be stale
 * if the user scrolls and immediately clicks a link).
 *
 * Restore: only for back/forward navigation. Reloads intentionally reset to top so a
 * refresh never clamps an old `scrollTop` against an incomplete page height and jumps to
 * the first tall section.
 */
if (SQUEEZE_QUERY.matches) {
  history.scrollRestoration = 'manual';
}

SQUEEZE_QUERY.addEventListener('change', () => {
  history.scrollRestoration = SQUEEZE_QUERY.matches ? 'manual' : 'auto';
});

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

window.addEventListener('pagehide', saveScrollPosition);

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

  // Use scrollTo with 'instant' to override CSS scroll-behavior: smooth on .page-wrapper
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
 * Scrolls the active page container back to the top.
 */
function resetScrollTop() {
  getScrollContainer().scrollTo({ top: 0, behavior: 'instant' });
}

window.addEventListener('pageshow', (event) => {
  // Let anchor navigation behave natively.
  if (location.hash) return;

  const navigationType = getNavigationType();

  if (navigationType === 'reload') {
    requestAnimationFrame(resetScrollTop);
    return;
  }

  const shouldRestore = navigationType === 'back_forward' || event.persisted;
  if (!shouldRestore) return;

  const scrollTop = history.state?.scrollTop;
  if (scrollTop == null) return;

  requestAnimationFrame(() => {
    restoreSavedScrollTopWhenReady(scrollTop);
  });
});

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
 * Returns the appropriate target for listening to scroll events.
 * On desktop (≥990px), `.page-wrapper` emits scroll events directly.
 * On mobile, the document root scrolls natively and scroll events bubble to `document`.
 *
 * @returns {EventTarget} The target to call addEventListener('scroll', ...) on
 */
function getScrollEventTarget() {
  if (SQUEEZE_QUERY.matches) {
    return document.querySelector(PAGE_WRAPPER_SELECTOR) ?? document;
  }
  return document;
}

/**
 * Returns the appropriate root for an IntersectionObserver monitoring the scroll container.
 * On desktop (≥990px), `.page-wrapper` must be set as the explicit root.
 * On mobile, `null` uses the viewport root (the IntersectionObserver default).
 *
 * @returns {Element | null} The root option for IntersectionObserver
 */
function getIntersectionRoot() {
  if (SQUEEZE_QUERY.matches) {
    return document.querySelector(PAGE_WRAPPER_SELECTOR) ?? null;
  }
  return null;
}

export {
  getScrollContainer,
  getScrollTop,
  scrollTo,
  getScrollEventTarget,
  getIntersectionRoot,
  SQUEEZE_QUERY as scrollContainerMediaQuery,
};
