import { ThemeEvents } from '@theme/events';
import { Component } from '@theme/component';
import { StandardEvents, ProductSelectEvent } from '@shopify/events';
import { formatMoney } from '@theme/money-formatting';

/**
 * @typedef {Object} ProductPriceRefs
 * @property {HTMLElement} priceContainer
 * @property {HTMLElement} [volumePricingNote]
 */

/**
 * A custom element that displays a product price.
 * This component listens for variant update events and updates the price display accordingly.
 * It handles price updates from two different sources:
 * 1. Variant picker (in quick add modal or product page)
 * 2. Swatches variant picker (in product cards)
 *
 * @extends {Component<ProductPriceRefs>}
 */
class ProductPrice extends Component {
  connectedCallback() {
    super.connectedCallback();
    const closestSection = this.closest('.shopify-section, dialog');
    if (!closestSection) return;
    closestSection.addEventListener(StandardEvents.productSelect, this.#handleProductSelect);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    const closestSection = this.closest('.shopify-section, dialog');
    if (!closestSection) return;
    closestSection.removeEventListener(StandardEvents.productSelect, this.#handleProductSelect);
  }

  /**
   * Handles product select event and updates the price.
   * @param {ProductSelectEvent} event - The product select event.
   */
  #handleProductSelect = (event) => {
    if (!(event.target instanceof Element) || event.target.closest('product-card')) return;

    this.#optimisticallyUpdatePrice(event);

    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;

        const { html, newProduct } = detail;

        if (newProduct) {
          this.dataset.productId = newProduct.id;
        } else if (detail.productId && detail.productId !== this.dataset.productId) {
          return;
        }

        const { priceContainer, volumePricingNote } = this.refs;
        // Find the new product-price element in the updated HTML
        const newProductPrice = html.querySelector(`product-price[data-block-id="${this.dataset.blockId}"]`);
        if (!newProductPrice) return;

        // Update price container
        const newPrice = newProductPrice.querySelector('[ref="priceContainer"]');
        if (newPrice && priceContainer) {
          priceContainer.replaceWith(newPrice);
        }

        // Update volume pricing note
        const newNote = newProductPrice.querySelector('[ref="volumePricingNote"]');
        if (!newNote) {
          volumePricingNote?.remove();
        } else if (!volumePricingNote) {
          // Use newPrice since priceContainer was just replaced and now points to the detached element
          newPrice?.insertAdjacentElement('afterend', /** @type {Element} */ (newNote.cloneNode(true)));
        } else {
          volumePricingNote.replaceWith(newNote);
        }

        // Update installments (SPI banner) variant ID to trigger payment terms re-render
        const installmentsInput = /** @type {HTMLInputElement|null} */ (
          this.querySelector(`#product-form-installment-${this.dataset.blockId} input[name="id"]`)
        );
        if (installmentsInput) {
          installmentsInput.value = detail.resource?.id ?? '';
          installmentsInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[product-price] Event promise rejected:', error);
      });
  };

  /**
   * Updates the PDP price immediately using selected variant option data.
   * Falls back to server-rendered replacement after the variant fetch resolves.
   * @param {ProductSelectEvent} event
   */
  #optimisticallyUpdatePrice(event) {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('product-card') || event.target.closest('quick-add-dialog')) return;

    const variantPicker =
      event.target instanceof HTMLElement ? event.target.closest('variant-picker') : null;

    if (!(variantPicker instanceof HTMLElement)) return;

    const priceSource = this.#getSelectedPriceSource(variantPicker, event);
    if (!(priceSource instanceof HTMLElement)) return;

    const price = Number(priceSource.dataset.variantPrice);
    if (!Number.isFinite(price)) return;

    const compareAtPrice = Number(priceSource.dataset.variantCompareAtPrice);
    this.#updatePriceDisplay(price, compareAtPrice);
  }

  /**
   * @param {HTMLElement} variantPicker
   * @param {ProductSelectEvent} event
   * @returns {HTMLElement | null}
   */
  #getSelectedPriceSource(variantPicker, event) {
    const optionValueId = event.detail?.optionValueId;
    if (optionValueId) {
      const optionById = variantPicker.querySelector(`[data-option-value-id="${CSS.escape(optionValueId)}"]`);
      if (optionById instanceof HTMLElement) return optionById;
    }

    const selectedOption = variantPicker.querySelector('select option:checked');
    if (selectedOption instanceof HTMLElement) return selectedOption;

    const checkedInput = variantPicker.querySelector('fieldset input:checked');
    if (checkedInput instanceof HTMLElement) return checkedInput;

    return null;
  }

  /**
   * @param {number} priceCents
   * @param {number} compareAtPriceCents
   */
  #updatePriceDisplay(priceCents, compareAtPriceCents) {
    const { priceContainer } = this.refs;
    if (!(priceContainer instanceof HTMLElement)) return;

    const formattedPrice = this.#formatPrice(priceCents);
    const hasComparePrice = Number.isFinite(compareAtPriceCents) && compareAtPriceCents > priceCents;

    const regularPrice = priceContainer.querySelector('.price__regular .price');
    const salePrice = priceContainer.querySelector('.price__sale .price-item--sale.price, .price__sale .price');
    const comparePrices = Array.from(priceContainer.querySelectorAll('.compare-at-price'));
    const regularBlock = priceContainer.querySelector('.price__regular');
    const saleBlock = priceContainer.querySelector('.price__sale');
    const badge = this.querySelector('.price-sale-badge');

    if (hasComparePrice) {
      const formattedCompareAtPrice = this.#formatPrice(compareAtPriceCents);
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
  #formatPrice(cents) {
    const moneyFormat = this.dataset.moneyFormat || '${{amount}}';
    const currency = this.dataset.currency || window.Shopify?.currency?.active || 'USD';
    const locale = document.documentElement.lang || navigator.language || 'en-US';

    try {
      return formatMoney(cents, moneyFormat, currency);
    } catch (_error) {
      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
        }).format(cents / 100);
      } catch (_fallbackError) {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(cents / 100);
      }
    }
  }
}

if (!customElements.get('product-price')) {
  customElements.define('product-price', ProductPrice);
}
