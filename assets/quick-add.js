import { Component } from '@theme/component';
import { morph } from '@theme/morph';
import { SlideshowSelectEvent } from '@theme/events';
import { DialogComponent, DialogCloseEvent } from '@theme/dialog';
import { mediaQueryLarge, isMobileBreakpoint, getIOSVersion } from '@theme/utilities';
import VariantPicker from '@theme/variant-picker';
import { StandardEvents, ProductSelectEvent, CartLinesUpdateEvent } from '@shopify/events';

export class QuickAddComponent extends Component {
  /** @type {AbortController | null} */
  #abortController = null;
  /** @type {Map<string, Element>} */
  #cachedContent = new Map();
  /** @type {AbortController} */
  #cartUpdateAbortController = new AbortController();
  /** @type {AbortController | null} */
  #modalBindingsAbortController = null;
  /** @type {number} */
  #quickAddRequestId = 0;
  /** @type {Map<string, Promise<Element | null>>} */
  #prefetchPromises = new Map();

  get productPageUrl() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest('product-card'));
    const hotspotProduct = /** @type {import('./product-hotspot').ProductHotspotComponent | null} */ (
      this.closest('product-hotspot-component')
    );
    const productLink = productCard?.getProductCardLink() || hotspotProduct?.getHotspotProductLink();

    if (!productLink?.href) return '';

    const url = new URL(productLink.href);

    if (url.searchParams.has('variant')) {
      return url.toString();
    }

    const selectedVariantId = this.#getSelectedVariantId();
    if (selectedVariantId) {
      url.searchParams.set('variant', selectedVariantId);
    }

    return url.toString();
  }

  /**
   * Gets the currently selected variant ID from the product card
   * @returns {string | null} The variant ID or null
   */
  #getSelectedVariantId() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest('product-card'));
    return productCard?.getSelectedVariantId() || null;
  }

  connectedCallback() {
    super.connectedCallback();

    mediaQueryLarge.addEventListener('change', this.#closeQuickAddModal);
    document.addEventListener(StandardEvents.cartLinesUpdate, this.#handleCartUpdate, {
      signal: this.#cartUpdateAbortController.signal,
    });
    document.addEventListener(StandardEvents.productSelect, this.#handleProductSelectUpdate);
    this.addEventListener('pointerenter', this.#prefetchQuickAddContent, { once: true });
    this.addEventListener('focusin', this.#prefetchQuickAddContent, { once: true });
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    mediaQueryLarge.removeEventListener('change', this.#closeQuickAddModal);
    this.#abortController?.abort();
    this.#cartUpdateAbortController.abort();
    this.#modalBindingsAbortController?.abort();
    document.removeEventListener(StandardEvents.productSelect, this.#handleProductSelectUpdate);
  }

  /**
   * Updates quick-add button state when product variant is selected
   * @param {ProductSelectEvent} event - The product select event
   */
  #handleProductSelectUpdate = (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest('product-card') !== this.closest('product-card')) return;
    const productOptionsCount = this.dataset.productOptionsCount;
    const quickAddButton = productOptionsCount === '1' ? 'add' : 'choose';
    this.setAttribute('data-quick-add-button', quickAddButton);
  };

  /**
   * Clears the cached content when cart is updated
   */
  #handleCartUpdate = () => {
    this.#cachedContent.clear();
  };

  /**
   * Re-renders the variant picker in the quick-add modal.
   * @param {Element} newHtml - The element to re-render.
   */
  #updateVariantPicker(newHtml) {
    const modalContent = document.getElementById('quick-add-modal-content');
    if (!modalContent) return;
    const variantPicker = /** @type {VariantPicker | null} */ (modalContent.querySelector('variant-picker'));
    if (!variantPicker) return;
    variantPicker.updateVariantPicker(newHtml);
  }

  /**
   * Handles quick add button click
   * @param {Event} event - The click event
   */
  handleClick = async (event) => {
    event.preventDefault();
    const currentUrl = this.productPageUrl;
    if (!currentUrl) return;

    const requestId = ++this.#quickAddRequestId;
    this.#showQuickAddLoadingState(currentUrl);
    this.#openQuickAddModal();

    try {
      const productGrid = await this.#getCachedOrFetchQuickAddContent(currentUrl);
      if (requestId !== this.#quickAddRequestId || !productGrid) return;

      const freshContent = /** @type {Element} */ (productGrid.cloneNode(true));
      await this.updateQuickAddModal(freshContent);
      if (requestId !== this.#quickAddRequestId) return;

      this.#updateVariantPicker(productGrid);
      this.#setQuickAddReadyState();
    } catch (error) {
      if (requestId !== this.#quickAddRequestId || error?.name === 'AbortError') return;
      console.warn('[quick-add] Failed to load quick add product:', error);
      this.#showQuickAddErrorState();
    }
  };

  #resetScroll() {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    const productDetails = dialogComponent.querySelector('.product-details');
    const productMedia = dialogComponent.querySelector('.product-information__media');
    productDetails?.scrollTo({ top: 0, behavior: 'instant' });
    productMedia?.scrollTo({ top: 0, behavior: 'instant' });
  }

  /** @param {QuickAddDialog} dialogComponent */
  #stayVisibleUntilDialogCloses(dialogComponent) {
    this.toggleAttribute('stay-visible', true);

    dialogComponent.addEventListener(DialogCloseEvent.eventName, () => this.toggleAttribute('stay-visible', false), {
      once: true,
    });
  }

  #openQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    this.#stayVisibleUntilDialogCloses(dialogComponent);

    dialogComponent.showDialog();

    // is nondeterministic when the open attribute is set on the dialog element after .showDialog() is called.
    // Waiting until the open animation starts seemed to be the most reliable metric here.
    const dialog = dialogComponent.refs?.dialog;
    if (!dialog) return;
    dialog.addEventListener('animationstart', this.#resetScroll.bind(this), { once: true });
  };

  #closeQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    dialogComponent.closeDialog();
  };

  /**
   * Fetches the product page content
   * @param {string} productPageUrl - The URL of the product page to fetch
   * @returns {Promise<Document | null>}
   */
  async fetchProductPage(productPageUrl) {
    if (!productPageUrl) return null;

    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    try {
      const response = await fetch(productPageUrl, {
        signal: this.#abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch product page: HTTP error ${response.status}`);
      }

      const responseText = await response.text();
      const html = new DOMParser().parseFromString(responseText, 'text/html');

      return html;
    } catch (error) {
      if (error.name === 'AbortError') {
        return null;
      } else {
        throw error;
      }
    } finally {
      this.#abortController = null;
    }
  }

  /**
   * Re-renders the variant picker.
   * @param {Element} productGrid - The product grid element
   */
  async updateQuickAddModal(productGrid) {
    const modalContent = document.getElementById('quick-add-modal-content');

    if (!productGrid || !modalContent) return;

    if (isMobileBreakpoint()) {
      const productDetails = productGrid.querySelector('.product-details');
      const productFormComponent = productGrid.querySelector('product-form-component');
      const variantPicker = productGrid.querySelector('variant-picker');
      const productPrice = productGrid.querySelector('product-price');
      const productTitle = document.createElement('a');
      productTitle.textContent = this.dataset.productTitle || '';

      // Make product title as a link to the product page
      productTitle.href = this.productPageUrl;

      const productHeader = document.createElement('div');
      productHeader.classList.add('product-header');

      productHeader.appendChild(productTitle);
      if (productPrice) {
        productHeader.appendChild(productPrice);
      }
      productGrid.appendChild(productHeader);

      if (variantPicker) {
        productGrid.appendChild(variantPicker);
      }
      if (productFormComponent) {
        productGrid.appendChild(productFormComponent);
      }

      productDetails?.remove();
    }

    // Sync the view-event-payload attribute and morph children into the modal's product-component
    const payload = productGrid.getAttribute('view-event-payload') || '';
    modalContent.setAttribute('view-event-payload', payload);

    morph(modalContent, productGrid);

    this.#modalBindingsAbortController?.abort();
    this.#modalBindingsAbortController = new AbortController();

    await this.#prepareQuickAddModalMedia(modalContent, this.#modalBindingsAbortController.signal);
    this.#bindQuickAddOptimisticPrice(modalContent, this.#modalBindingsAbortController.signal);
    this.#syncVariantSelection(modalContent);
    this.#positionQuickAddTrustBadges(modalContent);
  }

  /**
   * @param {string} productPageUrl
   * @returns {Promise<Element | null>}
   */
  async #getCachedOrFetchQuickAddContent(productPageUrl) {
    const cachedContent = this.#cachedContent.get(productPageUrl);
    if (cachedContent) return cachedContent;

    const prefetched = this.#prefetchPromises.get(productPageUrl);
    if (prefetched) {
      const prefetchedGrid = await prefetched;
      if (prefetchedGrid) return prefetchedGrid;
    }

    const html = await this.fetchProductPage(productPageUrl);
    if (!html) return null;

    const gridElement = html.querySelector('[data-product-grid-content]');
    if (!gridElement) {
      throw new Error('Missing product grid content');
    }

    const clonedGrid = /** @type {Element} */ (gridElement.cloneNode(true));
    this.#cachedContent.set(productPageUrl, clonedGrid);
    return clonedGrid;
  }

  #prefetchQuickAddContent = async () => {
    const productPageUrl = this.productPageUrl;
    if (!productPageUrl || this.#cachedContent.has(productPageUrl) || this.#prefetchPromises.has(productPageUrl)) return;

    const prefetchPromise = fetch(productPageUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to prefetch product page: HTTP error ${response.status}`);
        }
        return response.text();
      })
      .then((responseText) => {
        const html = new DOMParser().parseFromString(responseText, 'text/html');
        const gridElement = html.querySelector('[data-product-grid-content]');
        if (!gridElement) return null;

        const clonedGrid = /** @type {Element} */ (gridElement.cloneNode(true));
        this.#cachedContent.set(productPageUrl, clonedGrid);
        return clonedGrid;
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn('[quick-add] Prefetch failed:', error);
        }
        return null;
      })
      .finally(() => {
        this.#prefetchPromises.delete(productPageUrl);
      });

    this.#prefetchPromises.set(productPageUrl, prefetchPromise);
    await prefetchPromise;
  };

  /**
   * @param {string} productUrl
   */
  #showQuickAddLoadingState(productUrl) {
    const dialog = document.querySelector('.quick-add-modal');
    const modalContent = document.getElementById('quick-add-modal-content');
    if (!(modalContent instanceof HTMLElement)) return;

    this.#modalBindingsAbortController?.abort();

    dialog?.setAttribute('data-quick-add-state', 'loading');
    modalContent.setAttribute('aria-busy', 'true');
    modalContent.setAttribute('data-quick-add-url', productUrl);
    modalContent.innerHTML = `
      <div class="quick-add-modal__skeleton-media" aria-hidden="true">
        <div class="quick-add-modal__skeleton-main"></div>
        <div class="quick-add-modal__skeleton-thumbs">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>
      <div class="quick-add-modal__skeleton-info" aria-hidden="true">
        <div class="quick-add-modal__skeleton-title"></div>
        <div class="quick-add-modal__skeleton-title quick-add-modal__skeleton-title--short"></div>
        <div class="quick-add-modal__skeleton-price"></div>
        <div class="quick-add-modal__skeleton-options">
          <span></span><span></span><span></span>
        </div>
        <div class="quick-add-modal__skeleton-button"></div>
        <div class="quick-add-modal__skeleton-button quick-add-modal__skeleton-button--secondary"></div>
      </div>
    `;
    this.#resetScroll();
  }

  #setQuickAddReadyState() {
    const dialog = document.querySelector('.quick-add-modal');
    const modalContent = document.getElementById('quick-add-modal-content');

    dialog?.setAttribute('data-quick-add-state', 'ready');
    modalContent?.removeAttribute('aria-busy');
  }

  /**
   * Moves trust badges into a full-width rail at the bottom of the quick add modal.
   * @param {Element} modalContent
   */
  #positionQuickAddTrustBadges(modalContent) {
    if (!(modalContent instanceof HTMLElement)) return;

    const media = modalContent.querySelector(':scope > .product-information__media, .product-information__media');
    const details = modalContent.querySelector(':scope > .product-details, .product-details');
    const trustBadges = modalContent.querySelector('.product-form-trust-badges');
    const oldMain = modalContent.querySelector(':scope > .quick-add-modal__main');

    if (oldMain instanceof HTMLElement) {
      oldMain.replaceWith(...Array.from(oldMain.childNodes));
    }

    const main = document.createElement('div');
    main.className = 'quick-add-modal__main';

    if (media instanceof HTMLElement) {
      main.appendChild(media);
    }
    if (details instanceof HTMLElement) {
      main.appendChild(details);
    }

    modalContent.prepend(main);

    if (trustBadges instanceof HTMLElement) {
      trustBadges.setAttribute('data-quick-add-trust-rail', 'true');
      modalContent.appendChild(trustBadges);
    }
  }

  #showQuickAddErrorState() {
    const dialog = document.querySelector('.quick-add-modal');
    const modalContent = document.getElementById('quick-add-modal-content');
    if (!(modalContent instanceof HTMLElement)) return;

    dialog?.setAttribute('data-quick-add-state', 'error');
    modalContent.setAttribute('aria-busy', 'false');
    modalContent.innerHTML = `
      <div class="quick-add-modal__error" role="status">
        <strong>Couldn&rsquo;t load this product.</strong>
        <span>Please try again in a moment.</span>
        <button type="button" class="quick-add-modal__error-close">Close</button>
      </div>
    `;

    modalContent.querySelector('.quick-add-modal__error-close')?.addEventListener(
      'click',
      () => {
        this.#closeQuickAddModal();
      },
      { once: true }
    );
  }

  /**
   * Prepares native media gallery markup for quick add modal rendering.
   * @param {Element} modalContent
   * @param {AbortSignal} signal
   */
  async #prepareQuickAddModalMedia(modalContent, signal) {
    const gallery = modalContent.querySelector('media-gallery');
    if (!(gallery instanceof HTMLElement)) return;

    const slideshowComponent = gallery.querySelector('slideshow-component');
    const slideshowContainer = gallery.querySelector('slideshow-container');
    const slideshowSlides = gallery.querySelector('slideshow-slides');
    const slides = Array.from(gallery.querySelectorAll('slideshow-slide'));

    if (!(slideshowComponent instanceof HTMLElement) || !(slideshowSlides instanceof HTMLElement) || slides.length === 0) {
      gallery.setAttribute('data-quick-add-slideshow-ready', 'false');
      return;
    }

    gallery.setAttribute('data-quick-add-slideshow-ready', 'true');
    slideshowComponent.setAttribute('in-viewport', '');

    slides.forEach((slide, index) => {
      slide.setAttribute('aria-hidden', index === 0 ? 'false' : 'true');
    });

    if (slideshowContainer instanceof HTMLElement) {
      slideshowContainer.scrollTop = 0;
      slideshowContainer.scrollLeft = 0;
    }

    slideshowSlides.scrollLeft = 0;

    this.#bindQuickAddNativeThumbnails(gallery, slideshowComponent, signal);

    await customElements.whenDefined('slideshow-component');

    if (typeof slideshowComponent.select === 'function') {
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          slideshowComponent.select(0, undefined, { animate: false });
          resolve();
        });
      });
    }
  }

  /**
   * Binds the native thumbnail controls to the slideshow in quick add modal.
   * @param {HTMLElement} gallery
   * @param {HTMLElement} slideshowComponent
   * @param {AbortSignal} signal
   */
  #bindQuickAddNativeThumbnails(gallery, slideshowComponent, signal) {
    const modalContent = document.getElementById('quick-add-modal-content');
    if (!modalContent?.contains(gallery)) return;

    const controls =
      gallery.querySelector('slideshow-controls[thumbnails]') ||
      gallery.querySelector('.slideshow-controls__thumbnails-container');
    if (!(controls instanceof HTMLElement)) return;

    const getThumbnails = () =>
      Array.from(controls.querySelectorAll('.slideshow-controls__thumbnail')).filter(
        (thumbnail) => thumbnail instanceof HTMLElement
      );

    const syncThumbnailState = (index) => {
      const thumbnails = getThumbnails();
      thumbnails.forEach((thumbnail, thumbnailIndex) => {
        thumbnail.setAttribute('aria-selected', thumbnailIndex === index ? 'true' : 'false');
        if (thumbnail instanceof HTMLButtonElement) {
          thumbnail.ariaPressed = thumbnailIndex === index ? 'true' : 'false';
        }
      });

      const activeThumbnail = thumbnails[index];
      if (activeThumbnail instanceof HTMLElement) {
        activeThumbnail.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      }
    };

    const fallbackSelect = (index) => {
      const slides = Array.from(gallery.querySelectorAll('slideshow-slide'));
      const slideshowSlides = gallery.querySelector('slideshow-slides');
      const selectedSlide = slides[index];

      slides.forEach((slide, slideIndex) => {
        if (slide instanceof HTMLElement) {
          slide.setAttribute('aria-hidden', slideIndex === index ? 'false' : 'true');
        }
      });

      if (selectedSlide instanceof HTMLElement) {
        if (slideshowSlides instanceof HTMLElement) {
          slideshowSlides.scrollTo({ left: selectedSlide.offsetLeft, behavior: 'auto' });
        } else {
          selectedSlide.scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'auto' });
        }
      }

      syncThumbnailState(index);
    };

    const selectSlide = (index, event) => {
      if (typeof slideshowComponent.select === 'function') {
        slideshowComponent.select(index, event, { animate: false });

        requestAnimationFrame(() => {
          const activeThumb = getThumbnails().findIndex((thumbnail) => thumbnail.getAttribute('aria-selected') === 'true');
          if (activeThumb !== index) {
            fallbackSelect(index);
          }
        });
        return;
      }

      requestAnimationFrame(() => fallbackSelect(index));
    };

    controls.addEventListener(
      'click',
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const thumbnail = target.closest('.slideshow-controls__thumbnail');
        if (!(thumbnail instanceof HTMLElement)) return;

        const thumbnails = getThumbnails();
        const index = thumbnails.indexOf(thumbnail);
        if (index < 0) return;

        event.preventDefault();
        selectSlide(index, event);
      },
      { signal }
    );

    slideshowComponent.addEventListener(
      SlideshowSelectEvent.eventName,
      (event) => {
        const index = typeof event.detail?.index === 'number' ? event.detail.index : Number.NaN;
        if (Number.isNaN(index) || index < 0) return;
        syncThumbnailState(index);
      },
      { signal }
    );

    const initialIndex = getThumbnails().findIndex((thumbnail) => thumbnail.getAttribute('aria-selected') === 'true');
    syncThumbnailState(initialIndex >= 0 ? initialIndex : 0);
  }

  /**
   * Updates the quick add modal price immediately using selected option data.
   * @param {Element} modalContent
   * @param {AbortSignal} signal
   */
  #bindQuickAddOptimisticPrice(modalContent, signal) {
    const variantPicker = modalContent.querySelector('variant-picker');
    const productPrice = modalContent.querySelector('product-price');

    if (!(variantPicker instanceof HTMLElement) || !(productPrice instanceof HTMLElement)) return;

    variantPicker.addEventListener(
      'change',
      (event) => {
        const priceSource = this.#getQuickAddPriceSource(event.target);
        if (!priceSource) return;

        const price = Number(priceSource.dataset.variantPrice);
        if (!Number.isFinite(price)) return;

        const compareAtPrice = Number(priceSource.dataset.variantCompareAtPrice);
        this.#updateQuickAddPrice(productPrice, price, compareAtPrice);
      },
      { signal }
    );
  }

  /**
   * @param {EventTarget | null} target
   * @returns {HTMLElement | null}
   */
  #getQuickAddPriceSource(target) {
    if (target instanceof HTMLInputElement) {
      return target;
    }

    if (target instanceof HTMLSelectElement) {
      return target.selectedOptions[0] instanceof HTMLElement ? target.selectedOptions[0] : null;
    }

    return null;
  }

  /**
   * @param {HTMLElement} productPrice
   * @param {number} priceCents
   * @param {number} compareAtPriceCents
   */
  #updateQuickAddPrice(productPrice, priceCents, compareAtPriceCents) {
    const formattedPrice = this.#formatQuickAddMoney(priceCents);
    const hasComparePrice = Number.isFinite(compareAtPriceCents) && compareAtPriceCents > priceCents;

    const regularPrice = productPrice.querySelector('.price__regular .price');
    const salePrice = productPrice.querySelector('.price__sale .price-item--sale.price, .price__sale .price');
    const comparePrices = Array.from(productPrice.querySelectorAll('.compare-at-price'));
    const regularBlock = productPrice.querySelector('.price__regular');
    const saleBlock = productPrice.querySelector('.price__sale');
    const badge = productPrice.querySelector('.price-sale-badge');

    if (hasComparePrice) {
      const formattedCompareAtPrice = this.#formatQuickAddMoney(compareAtPriceCents);
      const savingsPercentage = Math.round(((compareAtPriceCents - priceCents) * 100) / compareAtPriceCents);

      regularBlock?.classList.add('price__hidden');
      saleBlock?.classList.remove('price__hidden');

      if (salePrice) salePrice.textContent = formattedPrice;
      comparePrices.forEach((comparePrice) => {
        comparePrice.textContent = formattedCompareAtPrice;
      });

      if (badge instanceof HTMLElement) {
        badge.textContent = `Save ${savingsPercentage}%`;
        badge.hidden = false;
        badge.style.display = '';
      }
      return;
    }

    regularBlock?.classList.remove('price__hidden');
    saleBlock?.classList.add('price__hidden');

    if (regularPrice) regularPrice.textContent = formattedPrice;
    if (salePrice) salePrice.textContent = formattedPrice;
    comparePrices.forEach((comparePrice) => {
      comparePrice.textContent = '';
    });

    if (badge instanceof HTMLElement) {
      badge.hidden = true;
      badge.style.display = 'none';
    }
  }

  /**
   * @param {number} cents
   * @returns {string}
   */
  #formatQuickAddMoney(cents) {
    const currency = window.Shopify?.currency?.active || 'USD';
    const locale = document.documentElement.lang || navigator.language || 'en-US';

    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
      }).format(cents / 100);
    } catch (_error) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(cents / 100);
    }
  }

  /**
   * Syncs the variant selection from the product card to the modal
   * @param {Element} modalContent - The modal content element
   */
  #syncVariantSelection(modalContent) {
    const selectedVariantId = this.#getSelectedVariantId();
    if (!selectedVariantId) return;

    // Find and check the corresponding input in the modal
    const modalInputs = modalContent.querySelectorAll('input[type="radio"][data-variant-id]');
    for (const input of modalInputs) {
      if (input instanceof HTMLInputElement && input.dataset.variantId === selectedVariantId && !input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  }
}

if (!customElements.get('quick-add-component')) {
  customElements.define('quick-add-component', QuickAddComponent);
}

class QuickAddDialog extends DialogComponent {
  #abortController = new AbortController();

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener(StandardEvents.cartLinesUpdate, this.handleCartUpdate, {
      signal: this.#abortController.signal,
    });
    this.addEventListener(StandardEvents.productSelect, this.#handleProductSelect);

    this.addEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController.abort();
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  /**
   * Closes the dialog on successful cart update
   * @param {CartLinesUpdateEvent} event - The cart lines update event
   */
  handleCartUpdate = (event) => {
    event.promise
      ?.then(({ detail }) => {
        if (detail?.didError) return;
        this.closeDialog();
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[quick-add] Event promise rejected:', error);
      });
  };

  /** @param {ProductSelectEvent} event - The product select event */
  #handleProductSelect = (event) => {
    // Wait for variant update data
    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;

        const { html } = detail;
        const anchorElement = /** @type {HTMLAnchorElement} */ (html.querySelector('.view-product-title a'));
        const viewMoreDetailsLink = /** @type {HTMLAnchorElement} */ (this.querySelector('.view-product-title a'));
        const mobileProductTitle = /** @type {HTMLAnchorElement} */ (this.querySelector('.product-header a'));

        if (!anchorElement) return;

        if (viewMoreDetailsLink) viewMoreDetailsLink.href = anchorElement.href;
        if (mobileProductTitle) mobileProductTitle.href = anchorElement.href;
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[quick-add] Event promise rejected:', error);
      });
  };

  #handleDialogClose = () => {
    const iosVersion = getIOSVersion();
    /**
     * This is a patch to solve an issue with the UI freezing when the dialog is closed.
     * To reproduce it, use iOS 16.0.
     */
    if (!iosVersion || iosVersion.major >= 17 || (iosVersion.major === 16 && iosVersion.minor >= 4)) return;

    requestAnimationFrame(() => {
      /** @type {HTMLElement | null} */
      const grid = document.querySelector('#ResultsList [product-grid-view]');
      if (grid) {
        const currentWidth = grid.getBoundingClientRect().width;
        grid.style.width = `${currentWidth - 1}px`;
        requestAnimationFrame(() => {
          grid.style.width = '';
        });
      }
    });
  };
}

if (!customElements.get('quick-add-dialog')) {
  customElements.define('quick-add-dialog', QuickAddDialog);
}
