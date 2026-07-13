import { Component } from '@theme/component';
import { debounce, setHeaderMenuStyle } from '@theme/utilities';
import { MegaMenuHoverEvent } from '@theme/events';

/** Skim filter: pointer must dwell this long before MegaMenuHoverEvent fires. */
const HOVER_COMMIT_DELAY_MS = 50;
const CLOSE_INTENT_DELAY_MS = 90;

/**
 * A custom element that manages a header menu.
 *
 * @typedef {Object} State
 * @property {HTMLElement | null} activeItem - The currently active menu item.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} overflowMenu - The overflow menu.
 * @property {HTMLElement[]} [submenu] - The submenu in each respective menu item.
 *
 * @extends {Component<Refs>}
 */
class HeaderMenu extends Component {
  requiredRefs = ['overflowMenu'];

  /**
   * @type {MutationObserver | null}
   */
  #submenuMutationObserver = null;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #hoverDispatchTimer;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #closeIntentTimer;

  connectedCallback() {
    super.connectedCallback();

    window.addEventListener('resize', this.#resizeListener);
    this.overflowMenu?.addEventListener('pointerleave', this.#overflowSubmenuListener);
    this.addEventListener('mouseenter', this.#handleMenuEnter);
    this.addEventListener('mouseleave', this.#handleMenuLeave);
    this.addEventListener('focusin', this.#handleMenuEnter);
    this.addEventListener('focusout', this.#handleMenuFocusOut);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.#resizeListener);
    document.body.removeEventListener('pointermove', this.#onPointerMove);
    if (this.#state.activeItem) {
      this.#stopPointerTracking(this.#state.activeItem);
    }
    this.overflowMenu?.removeEventListener('pointerleave', this.#overflowSubmenuListener);
    this.removeEventListener('mouseenter', this.#handleMenuEnter);
    this.removeEventListener('mouseleave', this.#handleMenuLeave);
    this.removeEventListener('focusin', this.#handleMenuEnter);
    this.removeEventListener('focusout', this.#handleMenuFocusOut);
    this.#cleanupMutationObserver();
    clearTimeout(this.#hoverDispatchTimer);
    this.#hoverDispatchTimer = undefined;
    clearTimeout(this.#closeIntentTimer);
    this.#closeIntentTimer = undefined;
    this.#setHeaderMenuHover(false);
  }

  /**
   * Debounced resize event listener to recalculate menu style
   */
  #resizeListener = debounce(() => {
    setHeaderMenuStyle();
  }, 100);

  #overflowSubmenuListener = () => {
    this.#queueCloseIntent();
  };

  /**
   * @type {State}
   */
  #state = {
    activeItem: null,
  };

  /**
   * @type {ReturnType<typeof setTimeout> | undefined}
   */
  #pointerIdleTimer;

  /**
   * Last known pointer position for Safari hit-test reconciliation.
   * @type {{ x: number, y: number }}
   */
  #lastPointer = { x: 0, y: 0 };

  /**
   * Update the safety box idle state on the active menu item.
   * @param {PointerEvent} event
   */
  #onPointerMove = (event) => {
    const activeLink = this.#state.activeItem;
    if (!activeLink) return;

    this.#lastPointer.x = event.clientX;
    this.#lastPointer.y = event.clientY;

    if (this.#switchToHoveredTopLevelItem()) {
      return;
    }

    const moving = Math.abs(event.movementX) >= 1 || event.movementY >= 1;
    activeLink.dataset.safetyBox = `${moving}`;

    clearTimeout(this.#pointerIdleTimer);
    if (moving) {
      this.#pointerIdleTimer = setTimeout(() => {
        if (this.#state.activeItem) {
          this.#state.activeItem.dataset.safetyBox = 'false';
          this.#reconcilePointerTarget();
        }
      }, 50);
    } else {
      this.#reconcilePointerTarget();
    }
  };

  /**
   * Check if the pointer is over a different menu item and trigger activation if so.
   * Works around Safari not re-evaluating hit targets after pseudo-element changes.
   */
  #reconcilePointerTarget() {
    const { x, y } = this.#lastPointer;
    requestAnimationFrame(() => {
      const target = document.elementFromPoint(x, y);
      const targetState = resolveTopLevelTarget(target);
      if (!targetState || !this.contains(targetState.listItem) || targetState.nextItem === this.#state.activeItem) return;

      if (!targetState.hasSubmenu && !targetState.isOverflowItem) {
        this.#deactivate(this.#state.activeItem);
        return;
      }

      targetState.listItem.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
    });
  }

  #switchToHoveredTopLevelItem() {
    const activeItem = this.#state.activeItem;
    if (!activeItem) return false;

    const previousSafetyBox = activeItem.dataset.safetyBox;
    delete activeItem.dataset.safetyBox;

    const target = document.elementFromPoint(this.#lastPointer.x, this.#lastPointer.y);

    if (previousSafetyBox !== undefined) {
      activeItem.dataset.safetyBox = previousSafetyBox;
    }

    const targetState = resolveTopLevelTarget(target);
    if (!targetState || !this.contains(targetState.listItem) || targetState.nextItem === activeItem) return false;

    if (!targetState.hasSubmenu && !targetState.isOverflowItem) {
      this.#deactivate(activeItem);
      return true;
    }

    targetState.listItem.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
    return true;
  }

  /**
   * Begin pointer tracking for the safety box on the newly active item.
   * @param {HTMLElement} item
   * @param {HTMLElement | null} previousItem
   */
  #startPointerTracking(item, previousItem) {
    if (previousItem) {
      this.#stopPointerTracking(previousItem);
    } else {
      document.body.addEventListener('pointermove', this.#onPointerMove);
    }

    const rect = item.getBoundingClientRect();
    const isOverlap = this.headerComponent?.hasAttribute('data-submenu-overlap-bottom-row');
    const boundary = isOverlap ? this.headerComponent?.querySelector('.header__row--top') : this.headerComponent;
    item.style.setProperty('--box-height', `${(boundary?.getBoundingClientRect().bottom ?? 0) - rect.top}px`);
  }

  /**
   * Stop pointer tracking and remove all safety box properties from an item.
   * @param {HTMLElement} item
   */
  #stopPointerTracking(item) {
    window.clearTimeout(this.#pointerIdleTimer);
    this.#pointerIdleTimer = undefined;
    item.style.removeProperty('--box-height');
    delete item.dataset.safetyBox;
  }

  #clearCloseIntentTimer() {
    clearTimeout(this.#closeIntentTimer);
    this.#closeIntentTimer = undefined;
  }

  #shouldKeepMenuOpen(item = this.#state.activeItem) {
    if (!item) return false;

    const submenu = findSubmenu(item);
    const listItem = item.closest('.menu-list__list-item');
    const activeElement = document.activeElement;

    const stillHoveringActiveItem = item.matches(':hover') || listItem?.matches(':hover');
    const stillHoveringSubmenu = submenu?.matches(':hover');
    const stillHoveringOverflow = this.overflowListHovered || this.overflowMenu?.matches(':hover');
    const focusInsideSubmenu = activeElement instanceof Node && submenu?.contains(activeElement);
    const focusInsideOverflow = activeElement instanceof Node && this.overflowMenu?.contains(activeElement);

    return Boolean(
      stillHoveringActiveItem ||
        stillHoveringSubmenu ||
        stillHoveringOverflow ||
        focusInsideSubmenu ||
        focusInsideOverflow
    );
  }

  #queueCloseIntent() {
    this.#clearCloseIntentTimer();

    this.#closeIntentTimer = setTimeout(() => {
      this.#closeIntentTimer = undefined;

      const activeItem = this.#state.activeItem;
      if (!activeItem || this.#shouldKeepMenuOpen(activeItem)) return;

      this.#deactivate(activeItem);
    }, CLOSE_INTENT_DELAY_MS);
  }

  /**
   * Whether the last known pointer position still lands inside the provided submenu.
   * This guards against blur caused by clicking non-focusable whitespace inside an open submenu.
   * @param {HTMLElement | null} submenu
   * @returns {boolean}
   */
  #isPointerWithinSubmenu(submenu) {
    if (!submenu) return false;

    const pointerTarget = document.elementFromPoint(this.#lastPointer.x, this.#lastPointer.y);
    return pointerTarget instanceof Node && submenu.contains(pointerTarget);
  }

  /**
   * Get the submenu's natural content height without trusting the clipped wrapper height.
   * @param {HTMLElement} submenu
   * @returns {number}
   */
  #getSubmenuContentHeight(submenu) {
    const submenuInner = submenu.querySelector('.menu-list__submenu-inner');

    if (submenuInner instanceof HTMLElement) {
      return Math.ceil(Math.max(submenuInner.scrollHeight, submenuInner.getBoundingClientRect().height));
    }

    return Math.ceil(Math.max(submenu.scrollHeight, submenu.offsetHeight));
  }

  /**
   * Measure submenu height and sync the header CSS vars once layout is stable.
   * @param {HTMLElement} submenu
   * @param {HTMLElement} item
   * @param {boolean} isDefaultSlot
   * @param {boolean} hasSubmenu
   */
  #syncSubmenuHeight(submenu, item, isDefaultSlot, hasSubmenu) {
    if (this.#state.activeItem !== item) return;

    const activeSubmenu = findSubmenu(item);
    if (!activeSubmenu || activeSubmenu !== submenu) return;

    let finalHeight = this.#getSubmenuContentHeight(submenu);

    if (!isDefaultSlot) {
      const overflowListHeight = this.#getOverflowListLinksHeight();
      if (hasSubmenu) {
        const overflowHeight = this.overflowMenu?.offsetHeight || 0;
        finalHeight = Math.max(overflowHeight, overflowListHeight);
      } else {
        finalHeight = overflowListHeight;
      }
    }

    const headerVisibleHeight = this.#getHeaderVisibleHeight();
    this.headerComponent?.style.setProperty('--submenu-height', `${finalHeight}px`);
    this.#setFullOpenHeaderHeight(finalHeight, headerVisibleHeight);
  }

  /**
   * Wait until submenu layout settles after content-visibility changes, then re-measure.
   * @param {HTMLElement} submenu
   * @param {HTMLElement} item
   * @param {boolean} isDefaultSlot
   * @param {boolean} hasSubmenu
   */
  #scheduleSubmenuHeightSync(submenu, item, isDefaultSlot, hasSubmenu) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.#syncSubmenuHeight(submenu, item, isDefaultSlot, hasSubmenu);
      });
    });
  }

  /**
   * Get the overflow menu
   */
  get overflowMenu() {
    return /** @type {HTMLElement | null} */ (this.refs.overflowMenu?.shadowRoot?.querySelector('[part="overflow"]'));
  }

  /**
   * Whether the overflow list is hovered
   * @returns {boolean}
   */
  get overflowListHovered() {
    return this.refs.overflowMenu?.shadowRoot?.querySelector('[part="overflow-list"]')?.matches(':hover') ?? false;
  }

  get headerComponent() {
    return /** @type {HTMLElement | null} */ (this.closest('header-component'));
  }

  #handleMenuEnter = () => {
    this.#setHeaderMenuHover(true);
  };

  #handleMenuLeave = () => {
    this.#setHeaderMenuHover(false);
  };

  #handleMenuFocusOut = () => {
    queueMicrotask(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof Node && this.contains(activeElement)) return;
      if (this.matches(':hover')) return;
      this.#setHeaderMenuHover(false);
    });
  };

  /**
   * Mirrors expensive CSS hover ancestry checks with a cheap dataset flag.
   * @param {boolean} isHovering
   */
  #setHeaderMenuHover(isHovering) {
    this.headerComponent?.toggleAttribute('data-menu-hover', isHovering);
  }

  /**
   * Activate the selected menu item immediately
   * @param {PointerEvent | FocusEvent} event
   */
  activate = (event) => {
    if (!(event.target instanceof Element) || !this.headerComponent) return;

    this.#clearCloseIntentTimer();

    let item = findMenuItem(event.target);

    if (!item || item == this.#state.activeItem) return;

    const itemListItem = findListItem(item);
    const isDefaultSlot = isDefaultSlotListItem(itemListItem);
    let submenu = findSubmenu(item);
    const hasSubmenu = Boolean(submenu);

    this.dataset.overflowExpanded = (!isDefaultSlot).toString();

    const previouslyActiveItem = this.#state.activeItem;

    if (isDefaultSlot && !hasSubmenu) {
      if (previouslyActiveItem) {
        this.#deactivate(previouslyActiveItem);
      }
      return;
    }

    if (previouslyActiveItem) {
      previouslyActiveItem.ariaExpanded = 'false';
    }

    this.#state.activeItem = item;
    this.ariaExpanded = 'true';
    item.ariaExpanded = 'true';

    if (!hasSubmenu && !isDefaultSlot) {
      submenu = this.overflowMenu;
    }

    if (previouslyActiveItem) {
      const previousSubmenu = findSubmenu(previouslyActiveItem);
      if (previousSubmenu && previousSubmenu !== submenu) {
        delete previousSubmenu.dataset.active;
      }
    }

    if (submenu) {
      clearTimeout(this.#hoverDispatchTimer);
      this.#hoverDispatchTimer = undefined;
      const committedItem = item;
      const isSwitchingTopLevelItem = Boolean(previouslyActiveItem && previouslyActiveItem !== item);
      if (event instanceof FocusEvent || isSwitchingTopLevelItem) {
        this.dispatchEvent(new MegaMenuHoverEvent());
      } else {
        this.#hoverDispatchTimer = setTimeout(() => {
          this.#hoverDispatchTimer = undefined;
          if (this.#state.activeItem === committedItem) {
            this.dispatchEvent(new MegaMenuHoverEvent());
          }
        }, HOVER_COMMIT_DELAY_MS);
      }

      // Mark submenu as active for content-visibility optimization
      submenu.dataset.active = '';
      this.#preloadImagesIn(submenu);
      this.#scheduleSubmenuHeightSync(submenu, item, isDefaultSlot, hasSubmenu);

      // Cleanup any existing mutation observer from previous menu activations
      this.#cleanupMutationObserver();

      // Monitor DOM mutations to catch deferred content injection (from section hydration)
      this.#submenuMutationObserver = new MutationObserver(() => {
        this.#scheduleSubmenuHeightSync(submenu, item, isDefaultSlot, hasSubmenu);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (submenu.offsetHeight > 0) {
              this.#cleanupMutationObserver();
            }
          });
        });
      });
      this.#submenuMutationObserver.observe(submenu, { childList: true, subtree: true });

      // Auto-disconnect after 500ms to prevent memory leaks
      setTimeout(() => {
        this.#cleanupMutationObserver();
      }, 500);
    }

    if (submenu) {
      this.#syncSubmenuHeight(submenu, item, isDefaultSlot, hasSubmenu);
    } else {
      this.headerComponent.style.setProperty('--submenu-height', '0px');
      this.#setFullOpenHeaderHeight(0, 0);
    }
    this.style.setProperty('--submenu-opacity', '1');
    this.#startPointerTracking(item, previouslyActiveItem);
  };

  /**
   * Deactivate the active item after a delay
   * @param {PointerEvent | FocusEvent} event
   */
  deactivate(event) {
    if (!(event.target instanceof Element)) return;

    const activeItem = this.#state.activeItem;
    const menu = findSubmenu(activeItem);
    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    const isPointerLeave = event instanceof PointerEvent || event.type === 'pointerleave';
    const isBlurEvent = event instanceof FocusEvent || event.type === 'blur' || event.type === 'focusout';
    const isMovingWithinMenu = document.activeElement instanceof Node && menu?.contains(document.activeElement);
    const isMovingToSubmenu =
      relatedTarget instanceof Node && event.type === 'blur' && menu?.contains(relatedTarget);
    const isMovingToOverflowMenu =
      relatedTarget instanceof Node &&
      (relatedTarget.parentElement?.matches('[slot="overflow"]') || this.overflowMenu?.contains(relatedTarget));
    const isPointerInsideActiveSubmenu = isBlurEvent && this.#isPointerWithinSubmenu(menu);

    if (isMovingWithinMenu || isMovingToOverflowMenu || isMovingToSubmenu || isPointerInsideActiveSubmenu) {
      if (activeItem) {
        this.#stopPointerTracking(activeItem);
      }
      return;
    }

    if (isPointerLeave) {
      this.#queueCloseIntent();
      return;
    }

    this.#deactivate();
  }

  /**
   * Deactivate the active item immediately
   * @param {HTMLElement | null} [item]
   */
  #deactivate = (item = this.#state.activeItem) => {
    if (!item || item != this.#state.activeItem) return;

    this.#clearCloseIntentTimer();

    // Don't deactivate if the overflow menu or overflow list is still being hovered
    if (this.overflowListHovered || this.overflowMenu?.matches(':hover')) return;

    clearTimeout(this.#hoverDispatchTimer);
    this.#hoverDispatchTimer = undefined;

    this.headerComponent?.style.setProperty('--submenu-height', '0px');
    this.#setFullOpenHeaderHeight(0, 0);
    this.style.setProperty('--submenu-opacity', '0');
    this.dataset.overflowExpanded = 'false';

    const submenu = findSubmenu(item);

    document.body.removeEventListener('pointermove', this.#onPointerMove);
    this.#stopPointerTracking(item);

    this.#state.activeItem = null;
    this.ariaExpanded = 'false';
    item.ariaExpanded = 'false';

    // Remove active state from submenu after animation completes
    if (submenu) {
      delete submenu.dataset.active;
    }
  };

  #getOverflowListLinksHeight() {
    const slottedMenuLinks = this.overflowMenu?.querySelector('slot')?.assignedElements();
    if (!slottedMenuLinks) return this.overflowMenu?.offsetHeight || 0;

    /**
     * @param {(submenu: HTMLElement) => void} cb
     */
    const mapSubmenus = (cb) => {
      slottedMenuLinks.forEach((link) => {
        const submenu = /** @type {HTMLElement | null} */ (link.querySelector('[ref="submenu[]"]'));
        if (submenu) {
          cb(submenu);
        }
      });
    };

    mapSubmenus((submenu) => {
      submenu.style.setProperty('display', 'none');
    });
    const height = this.overflowMenu?.offsetHeight || 0;
    mapSubmenus((submenu) => {
      submenu.style.removeProperty('display');
    });
    return height;
  }

  /**
   * Read the visible header height before submenu height writes invalidate layout.
   * @returns {number}
   */
  #getHeaderVisibleHeight() {
    if (!this.headerComponent) return 0;

    const isOverlapSituation = this.headerComponent.hasAttribute('data-submenu-overlap-bottom-row');

    return isOverlapSituation && this.headerComponent.offsetHeight > 0
      ? /** @type {HTMLElement | null} */ (this.headerComponent.querySelector('.header__row--top'))?.offsetHeight ?? 0
      : this.headerComponent.offsetHeight;
  }

  /**
   * Calculate and set the full open header height. If the submenu is not open, the full open header height is 0.
   * @param {number} submenuHeight
   * @param {number} headerVisibleHeight
   */
  #setFullOpenHeaderHeight(submenuHeight, headerVisibleHeight) {
    if (!this.headerComponent) return;

    const nothingToOpen = submenuHeight === 0;
    const fullOpenHeaderHeight = nothingToOpen ? 0 : submenuHeight + headerVisibleHeight;

    this.headerComponent?.style.setProperty('--full-open-header-height', `${fullOpenHeaderHeight}px`);
  }

  /**
   * Promote submenu images from lazy-loading only when the shopper opens that menu.
   * This avoids decoding hidden menu media during the initial page load.
   * @param {HTMLElement} submenu
   */
  #preloadImagesIn(submenu) {
    if (submenu.dataset.imagesPreloaded === 'true') return;

    const images = submenu.querySelectorAll('img[loading="lazy"]');
    images.forEach((image) => image.removeAttribute('loading'));
    submenu.dataset.imagesPreloaded = 'true';
  }

  #cleanupMutationObserver() {
    this.#submenuMutationObserver?.disconnect();
    this.#submenuMutationObserver = null;
  }
}

if (!customElements.get('header-menu')) {
  customElements.define('header-menu', HeaderMenu);
}

/**
 * Find the closest menu item.
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | null}
 */
function findMenuItem(element) {
  if (!(element instanceof Element)) return null;

  const listItem = findListItem(element);

  if (listItem?.matches('[slot="more"]')) {
    return findMenuItem(listItem.parentElement?.querySelector('[slot="overflow"]'));
  }

  return /** @type {HTMLElement | null} */ (listItem?.querySelector('[ref="menuitem"]') ?? null);
}

/**
 * Find the closest submenu.
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | null}
 */
function findSubmenu(element) {
  const submenu = element?.parentElement?.querySelector('[ref="submenu[]"]');
  return submenu instanceof HTMLElement ? submenu : null;
}

/**
 * Find the closest menu list item.
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | null}
 */
function findListItem(element) {
  return /** @type {HTMLElement | null} */ (element?.closest('.menu-list__list-item') ?? null);
}

/**
 * Whether a menu list item is in the default slot.
 * @param {HTMLElement | null | undefined} listItem
 * @returns {boolean}
 */
function isDefaultSlotListItem(listItem) {
  return (listItem?.slot ?? '') === '';
}

/**
 * Whether a menu list item represents overflow content.
 * @param {HTMLElement | null | undefined} listItem
 * @returns {boolean}
 */
function isOverflowListItem(listItem) {
  return Boolean(listItem && (listItem.matches('[slot="more"]') || !isDefaultSlotListItem(listItem)));
}

/**
 * Resolve a top-level menu target and whether it can open submenu content.
 * @param {Element | null | undefined} element
 * @returns {{ listItem: HTMLElement, nextItem: HTMLElement, hasSubmenu: boolean, isOverflowItem: boolean } | null}
 */
function resolveTopLevelTarget(element) {
  const listItem = findListItem(element);
  if (!listItem) return null;

  const nextItem = /** @type {HTMLElement | null} */ (listItem.querySelector('[ref="menuitem"]'));
  if (!(nextItem instanceof HTMLElement)) return null;

  return {
    listItem,
    nextItem,
    hasSubmenu: Boolean(findSubmenu(nextItem)),
    isOverflowItem: isOverflowListItem(listItem),
  };
}
