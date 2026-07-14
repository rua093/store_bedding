import { Component } from '@theme/component';
import { ThemeEvents, QuantitySelectorUpdateEvent } from '@theme/events';
import { morph } from '@theme/morph';
import { onAnimationEnd } from '@theme/utilities';
import { StandardEvents, ProductSelectEvent, CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

/**
 * @typedef {Object} ProductVariant
 * @property {string|number} [id] - Variant ID
 * @property {string} [title] - Variant title
 * @property {string} [name] - Variant name
 * @property {boolean} [available] - Whether variant is available
 * @property {Object} [featured_media] - Featured media object
 * @property {Object} [featured_media.preview_image] - Preview image data
 * @property {string} [featured_media.preview_image.src] - Image source URL
 * @property {string} [featured_media.alt] - Alt text for the image
 */

/**
 * @typedef {HTMLElement & {
 *   source: Element,
 *   destination: Element,
 *   useSourceSize: string | boolean
 * }} FlyToCart
 */

/**
 * @typedef {Object} StickyAddToCartRefs
 * @property {HTMLElement} stickyBar - The floating bar container
 * @property {HTMLButtonElement} addToCartButton - Sticky bar's button
 * @property {HTMLElement | undefined} quantityDisplay - Quantity display container
 * @property {HTMLElement | undefined} quantityNumber - Quantity number element
 * @property {HTMLImageElement} productImage - Product image element
 */

/**
 * A custom element that manages a sticky add-to-cart bar.
 * Shows when the main buy buttons scroll out of view.
 *
 * @extends {Component<StickyAddToCartRefs>}
 */
class StickyAddToCartComponent extends Component {
  requiredRefs = ['stickyBar', 'addToCartButton'];

  /** @type {IntersectionObserver | null} */
  #buyButtonsIntersectionObserver = null;

  /** @type {IntersectionObserver | null} */
  #mainBottomObserver = null;

  /** @type {number | undefined} */
  #resetTimeout;

  /** @type {boolean} */
  #isStuck = false;

  /** @type {number | null} */
  #animationTimeout = null;

  /** @type {number | null} */
  #viewportRafId = null;

  /** @type {AbortController} */
  #abortController = new AbortController();

  /** @type {HTMLButtonElement | null} */
  #targetAddToCartButton = null;

  /** @type {HTMLButtonElement | null} */
  #targetCustomizeButton = null;

  /** @type {MutationObserver | null} */
  #customizeButtonObserver = null;

  /** @type {number} */
  #currentQuantity = 1;

  /** @type {HTMLElement | null} */
  #buyButtonsBlock = null;

  /** @type {HTMLElement | null} */
  #footerElement = null;

  /** @type {boolean} */
  #buyButtonsIntersecting = true;

  /** @type {boolean} */
  #footerIntersecting = false;

  /** @type {ResizeObserver | null} */
  #resizeObserver = null;

  connectedCallback() {
    super.connectedCallback();

    this.#setupIntersectionObserver();

    const { signal } = this.#abortController;
    const target = this.closest('.shopify-section');
    target?.addEventListener(StandardEvents.productSelect, this.#handleProductSelect, { signal });

    document.addEventListener(StandardEvents.cartLinesUpdate, this.#handleCartAddComplete, { signal });
    document.addEventListener(StandardEvents.cartError, this.#handleCartAddComplete, { signal });
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#handleQuantityUpdate, { signal });
    
    window.addEventListener('pageshow', this.#handlePageshow, { signal });

    if ('ResizeObserver' in window && this.refs.stickyBar) {
      this.#resizeObserver = new ResizeObserver(() => {
        this.#syncStickyAddToCartReserve();
      });
      this.#resizeObserver.observe(this.refs.stickyBar);
    }

    this.#getInitialQuantity();
    this.#refreshActionTargets();
    
    // Initial evaluation
    requestAnimationFrame(() => {
      this.#evaluateStickyVisibility();
      this.#syncStickyAddToCartReserve();
    });

    // IntersectionObserver callbacks gate visibility on #isChatActive(), but
    // if the shopper scrolls before the Inbox bundle has upgraded
    // <shopify-chat>, the bar shows and nothing re-runs that check. Hide it
    // once the element is defined so the bar doesn't overlap the chat UI.
    customElements.whenDefined('shopify-chat').then(() => {
      if (signal.aborted) return;
      if (this.#isStuck && this.#isChatActive()) this.#hideStickyBar();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#buyButtonsIntersectionObserver?.disconnect();
    this.#mainBottomObserver?.disconnect();
    this.#customizeButtonObserver?.disconnect();
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#abortController.abort();
    if (this.#animationTimeout) {
      clearTimeout(this.#animationTimeout);
    }
    document.documentElement.style.setProperty('--sticky-add-to-cart-reserve', '0px');
  }

  /**
   * Sets up the IntersectionObserver to watch the buy buttons visibility
   */
  #setupIntersectionObserver() {
    const productForm = this.#getProductForm();
    if (!productForm) return;

    this.#buyButtonsBlock = productForm.closest('.buy-buttons-block');
    if (!this.#buyButtonsBlock) return;

    // In themes migrated from 2.0, the footer element doesn't exist
    this.#footerElement = document.querySelector('footer') ?? document.querySelector('[class*="footer-group"]');
    if (!this.#footerElement) return;

    // Observer for buy buttons visibility
    this.#buyButtonsIntersectionObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;

      this.#buyButtonsIntersecting = entry.isIntersecting;
      this.#evaluateStickyVisibility();
    });

    // Observer for footer visibility - hides sticky bar at page bottom
    this.#mainBottomObserver = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry) return;

        this.#footerIntersecting = entry.isIntersecting;
        this.#evaluateStickyVisibility();
      },
      {
        rootMargin: '200px 0px 0px 0px',
      }
    );

    this.#buyButtonsIntersectionObserver.observe(this.#buyButtonsBlock);
    this.#mainBottomObserver.observe(this.#footerElement);
  }

  #handlePageshow = () => {
    this.#evaluateStickyVisibility();
    this.#syncStickyAddToCartReserve();
  };

  #syncStickyAddToCartReserve() {
    const { stickyBar } = this.refs;
    const isMobile = window.matchMedia('(max-width: 989px)').matches;
    const isAvailable = this.dataset.variantAvailable === 'true';

    // If not stuck or not available, remove reserve spacing
    const isStuck = stickyBar?.getAttribute('data-stuck') === 'true';

    if (!stickyBar || !isMobile || !isAvailable || !isStuck) {
      requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--sticky-add-to-cart-reserve', '0px');
      });
      return;
    }

    // Read Phase
    const stickyBarHeight = stickyBar.offsetHeight || 0;
    const stickyBarStyles = window.getComputedStyle(stickyBar);
    const bottomOffset = parseFloat(stickyBarStyles.bottom || '0') || 0;
    const reserveHeight = Math.ceil(stickyBarHeight + Math.max(bottomOffset, 0));

    // Write Phase
    requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--sticky-add-to-cart-reserve', `${reserveHeight}px`);
    });
  }

  #evaluateStickyVisibility() {
    const isAvailable = this.dataset.variantAvailable === 'true';
    if (!isAvailable) {
      this.#hideStickyBar();
      return;
    }

    if (this.#footerIntersecting) {
      this.#hideStickyBar();
      return;
    }

    if (!this.#buyButtonsIntersecting && !this.#isChatActive()) {
      this.#showStickyBar();
      return;
    }

    this.#hideStickyBar();
  }

  // Public action handlers
  /**
   * Handles the add to cart button click in the sticky bar
   */
  handleAddToCartClick = async () => {
    if (this.#isCustomizerMode() || !this.dataset.variantAvailable || this.dataset.variantAvailable !== 'true') return;

    this.#targetAddToCartButton = this.#getTargetAddToCartButton();
    if (!this.#targetAddToCartButton) return;
    this.#targetAddToCartButton.dataset.puppet = 'true';
    this.#targetAddToCartButton.click();
    const cartIcon = document.querySelector('.header-actions__cart-icon');

    if (this.refs.addToCartButton.dataset.added !== 'true') {
      this.refs.addToCartButton.dataset.added = 'true';
    }

    if (!cartIcon || !this.refs.addToCartButton || !this.refs.productImage) return;
    if (this.#resetTimeout) clearTimeout(this.#resetTimeout);

    const flyToCartElement = /** @type {FlyToCart} */ (document.createElement('fly-to-cart'));
    flyToCartElement.classList.add('fly-to-cart--sticky');
    flyToCartElement.style.setProperty('background-image', `url(${this.refs.productImage.src})`);
    flyToCartElement.useSourceSize = 'true';
    flyToCartElement.source = this.refs.productImage;
    flyToCartElement.destination = cartIcon;

    document.body.appendChild(flyToCartElement);

    await onAnimationEnd([this.refs.addToCartButton, flyToCartElement]);
    this.#resetTimeout = setTimeout(() => {
      this.refs.addToCartButton.removeAttribute('data-added');
    }, 800);
  };

  /**
   * Handles the customize button click in the sticky bar.
   */
  handleCustomizeClick = () => {
    if (!this.#isCustomizerMode() || this.dataset.variantAvailable !== 'true') return;

    const targetCustomizeButton = this.#getTargetCustomizeButton();
    if (!targetCustomizeButton || targetCustomizeButton.disabled) return;

    this.#targetCustomizeButton = targetCustomizeButton;
    targetCustomizeButton.click();
  };

  /**
   * Handles product select events (variant selected and updated)
   * @param {ProductSelectEvent} event - The product select event
   */
  #handleProductSelect = (event) => {
    if (!(event.target instanceof Element) || event.target.closest('product-card')) return;

    // Update variant ID from the event detail (variant:selected part)
    const { optionValueId } = event.detail ?? {};
    if (optionValueId) {
      this.dataset.currentVariantId = optionValueId;
    }

    // Wait for the promise to resolve with variant update data
    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;

        const { html, productId, resource: variant } = detail;

        if (productId && productId !== this.dataset.productId) return;

        // Get the new sticky add to cart HTML from the server response
        const newStickyAddToCart = /** @type {HTMLElement | null} */ (html.querySelector('sticky-add-to-cart'));
        if (!newStickyAddToCart) return;

        const newStickyBar = newStickyAddToCart.querySelector('[ref="stickyBar"]');
        if (!newStickyBar) return;

        // Store current visibility state before morphing
        const currentStuck = this.refs.stickyBar.getAttribute('data-stuck') || 'false';
        const variantAvailable = newStickyAddToCart.dataset.variantAvailable;

        // Morph the entire sticky bar content
        morph(this.refs.stickyBar, newStickyBar, { childrenOnly: true });

        // Restore visibility state after morphing
        this.refs.stickyBar.setAttribute('data-stuck', currentStuck);
        this.dataset.variantAvailable = variantAvailable;
        this.dataset.hasAmazonCustomizer = newStickyAddToCart.dataset.hasAmazonCustomizer ?? 'false';

        // Update the dataset attributes with new variant info
        if (variant && variant.id) {
          this.dataset.currentVariantId = variant.id;
        }

        this.#refreshActionTargets();

        if (variant == null) {
          this.#handleVariantUnavailable();
        }
        // Restore the current quantity display if needed
        this.#updateButtonText();

        // Evaluate visibility and reserve height after variant selection
        this.#evaluateStickyVisibility();
        this.#syncStickyAddToCartReserve();
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[sticky-add-to-cart] Event promise rejected:', error);
      });
  };

  /**
   * Updates the variant title based on selected options when the variant is unavailable
   */
  #handleVariantUnavailable = () => {
    this.dataset.currentVariantId = '';
    const variantTitleElement = this.querySelector('.sticky-add-to-cart__variant');
    const productId = this.dataset.productId;
    const variantPicker = document.querySelector(`variant-picker[data-product-id="${productId}"]`);
    if (!variantTitleElement || !variantPicker) return;

    const selectedOptions = Array.from(variantPicker.querySelectorAll('input:checked'))
      .map((option) => /** @type {HTMLInputElement} */ (option).value)
      .filter((value) => value !== '')
      .join(' / ');
    if (!selectedOptions) return;
    variantTitleElement.textContent = selectedOptions;
  };

  /**
   * Handles cart add complete (success or error) - resets puppet flag
   * @param {CartLinesUpdateEvent | CartErrorEvent} event - The cart event
   */
  #handleCartAddComplete = (event) => {
    // Reset the puppet flag only after the cart operation's promise settles,
    // not when the event is first dispatched (before the HTTP request completes).
    const resetPuppet = () => {
      if (this.#targetAddToCartButton) {
        this.#targetAddToCartButton.dataset.puppet = 'false';
      }
    };

    // CartLinesUpdateEvent has a promise; CartErrorEvent does not (error already happened).
    if ('promise' in event && event.promise instanceof Promise) {
      event.promise.finally(resetPuppet);
    } else {
      resetPuppet();
    }
  };

  /**
   * Handles quantity selector update events
   * @param {QuantitySelectorUpdateEvent} event - The quantity update event
   */
  #handleQuantityUpdate = (event) => {
    // Only respond to product page quantity selector updates, not cart drawer
    if (event.detail.cartLine) return;

    this.#currentQuantity = event.detail.quantity;
    this.#updateButtonText();
  };

  /**
   * Shows the sticky bar with animation
   */
  #showStickyBar() {
    const { stickyBar } = this.refs;
    this.#isStuck = true;
    stickyBar.dataset.stuck = 'true';
    this.#syncStickyAddToCartReserve();
  }

  #hideStickyBar() {
    const { stickyBar } = this.refs;
    this.#isStuck = false;
    stickyBar.dataset.stuck = 'false';
    this.#syncStickyAddToCartReserve();
  }

  // Helper methods
  /**
   * Checks whether the Shopify Chat is active on the page.
   * When active, the sticky bar must stay hidden to avoid overlapping the chat UI.
   *
   * <shopify-chat> is rendered unconditionally by chat-drawer.liquid, but
   * the "Ask anything" button only paints once the Inbox app has installed
   * and upgraded the element. Gate on the registration of the custom element
   * (the same signal chat-drawer.liquid uses via customElements.whenDefined)
   * so the inert placeholder on shops without Inbox doesn't suppress the
   * sticky bar.
   *
   * @returns {boolean}
   */
  #isChatActive() {
    if (!customElements.get('shopify-chat')) return false;
    return Boolean(document.querySelector('shopify-chat'));
  }

  /**
   * Gets the product form element
   * @returns {HTMLElement | null}
   */
  #getProductForm() {
    const productId = this.dataset.productId;
    if (!productId) return null;

    const sectionElement = this.closest('.shopify-section');
    if (!sectionElement) return null;

    const sectionId = sectionElement.id.replace('shopify-section-', '');
    return document.querySelector(
      `#shopify-section-${sectionId} product-form-component[data-product-id="${productId}"]`
    );
  }

  /**
   * @returns {boolean}
   */
  #isCustomizerMode() {
    return this.dataset.hasAmazonCustomizer === 'true';
  }

  /**
   * @returns {HTMLElement | null}
   */
  #getSectionElement() {
    return this.closest('.shopify-section');
  }

  /**
   * @returns {HTMLButtonElement | null}
   */
  #getTargetAddToCartButton() {
    const productForm = this.#getProductForm();
    return productForm?.querySelector('[ref="addToCartButton"]') ?? null;
  }

  /**
   * @returns {HTMLButtonElement | null}
   */
  #getTargetCustomizeButton() {
    const productId = this.dataset.productId;
    const sectionElement = this.#getSectionElement();
    if (!productId || !sectionElement) return null;

    const productForm = sectionElement.querySelector(
      `product-form-component[data-product-id="${productId}"]`
    );
    const targetButton = productForm?.querySelector('[data-customize-trigger-proxy]');

    return targetButton instanceof HTMLButtonElement ? targetButton : null;
  }

  #refreshActionTargets() {
    if (this.#isCustomizerMode()) {
      this.#targetAddToCartButton = null;
      this.#observeCustomizeButton();
      this.#syncCustomizeButtonState();
      return;
    }

    this.#customizeButtonObserver?.disconnect();
    this.#customizeButtonObserver = null;
    this.#targetCustomizeButton = null;
    this.#targetAddToCartButton = this.#getTargetAddToCartButton();
  }

  #syncCustomizeButtonState() {
    if (!this.#isCustomizerMode()) return;

    this.#targetCustomizeButton = this.#getTargetCustomizeButton();

    const isAvailable = this.dataset.variantAvailable === 'true';
    const isReady = Boolean(
      isAvailable &&
        this.#targetCustomizeButton &&
        !this.#targetCustomizeButton.disabled
    );
    const shouldDisable = !isReady;
    const stickyButton = this.refs.addToCartButton;

    if (stickyButton.disabled !== shouldDisable) {
      stickyButton.disabled = shouldDisable;
    }
  }

  #observeCustomizeButton() {
    const sectionElement = this.#getSectionElement();
    if (!sectionElement) return;

    this.#customizeButtonObserver?.disconnect();
    this.#customizeButtonObserver = new MutationObserver((mutations) => {
      const shouldSync = mutations.some((mutation) => {
        if (mutation.type === 'attributes') {
          return (
            mutation.attributeName === 'disabled' &&
            mutation.target instanceof Element &&
            mutation.target.matches('[data-customize-trigger-proxy]')
          );
        }

        if (mutation.type !== 'childList') return false;

        return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
          if (!(node instanceof Element)) return false;

          return (
            node.matches('[data-customize-trigger-proxy], product-form-component') ||
            node.querySelector('[data-customize-trigger-proxy]') !== null
          );
        });
      });

      if (shouldSync) {
        this.#syncCustomizeButtonState();
      }
    });

    this.#customizeButtonObserver.observe(sectionElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
  }

  /**
   * Gets the initial quantity from the data attribute
   */
  #getInitialQuantity() {
    this.#currentQuantity = parseInt(this.dataset.initialQuantity || '1') || 1;
    this.#updateButtonText();
  }

  /**
   * Updates the button text to include quantity
   */
  #updateButtonText() {
    const { addToCartButton, quantityDisplay, quantityNumber } = this.refs;
    if (this.#isCustomizerMode()) return;
    if (!quantityDisplay || !quantityNumber) return;

    const available = !addToCartButton.disabled;

    // Update the quantity number
    quantityNumber.textContent = this.#currentQuantity.toString();

    // Show/hide the quantity display based on availability and quantity
    if (available && this.#currentQuantity > 1) {
      quantityDisplay.style.display = 'inline';
    } else {
      quantityDisplay.style.display = 'none';
    }
  }
}

if (!customElements.get('sticky-add-to-cart')) {
  customElements.define('sticky-add-to-cart', StickyAddToCartComponent);
}
