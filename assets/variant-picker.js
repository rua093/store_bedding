import { Component } from '@theme/component';
import { morph, MORPH_OPTIONS } from '@theme/morph';
import { OverflowList } from '@theme/overflow-list';
import { yieldToMainThread, getViewParameterValue, ResizeNotifier } from '@theme/utilities';
import { ProductSelectEvent } from '@shopify/events';

/**
 * @typedef {object} VariantPickerRefs
 * @property {HTMLFieldSetElement[]} fieldsets - The fieldset elements.
 * @property {HTMLElement} [overflowList] - The overflow list element.
 */

/**
 * A custom element that manages a variant picker.
 *
 * @template {import('@theme/component').Refs} [TRefs=VariantPickerRefs]
 * @extends Component<TRefs>
 */
export default class VariantPicker extends Component {
  /** @type {string | undefined} */
  #pendingRequestUrl;

  /** @type {AbortController | undefined} */
  #abortController;

  /** @type {number[][]} */
  #checkedIndices = [];

  /** @type {HTMLInputElement[][]} */
  #radios = [];

  /** @type {Array<Record<string, any>>} */
  #productVariants = [];

  /** @type {string[]} */
  #optionNames = [];

  /** @type {number} */
  #beddingTypeOptionIndex = -1;

  #resizeObserver = new ResizeNotifier(() => this.updateVariantPickerCss());

  #handleChange = (event) => this.variantChanged(event);

  connectedCallback() {
    super.connectedCallback();
    this.#hydrateBeddingVariantData();
    this.#refreshOptionInputState();

    this.addEventListener('change', this.#handleChange);
    this.#resizeObserver.observe(this);
    this.#syncBeddingDependentOptions();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('change', this.#handleChange);
    this.#resizeObserver.disconnect();
  }

  /**
   * Handles the variant change event.
   * @param {Event} event - The variant change event.
   */
  variantChanged(event) {
    if (!(event.target instanceof HTMLElement)) return;

    const selectedOption =
      event.target instanceof HTMLSelectElement ? event.target.options[event.target.selectedIndex] : event.target;

    if (!selectedOption) return;

    this.updateSelectedOption(event.target);
    if (this.#isBeddingDependentPicker()) {
      this.#resetInvalidBeddingSelections();
      this.#syncBeddingDependentOptions();
    }

    const isOnProductPage =
      this.dataset.templateProductMatch === 'true' &&
      !event.target.closest('product-card') &&
      !event.target.closest('quick-add-dialog');

    // Morph the entire main content for combined listings child products, because changing the product
    // might also change other sections depending on recommendations, metafields, etc.
    const currentUrl = this.dataset.productUrl?.split('?')[0];
    const newUrl = selectedOption.dataset.connectedProductUrl;
    const loadsNewProduct = isOnProductPage && !!newUrl && newUrl !== currentUrl;
    const isOnFeaturedProductSection = Boolean(this.closest('featured-product-information'));

    const morphElementSelector = loadsNewProduct
      ? 'main'
      : isOnFeaturedProductSection
      ? 'featured-product-information'
      : undefined;

    const selectedVariant = this.#isBeddingDependentPicker() ? this.#getSelectedVariant() : null;
    const optionValueId = selectedOption.dataset.optionValueId ?? '';
    this.fetchUpdatedSection(this.buildRequestUrl(selectedOption), morphElementSelector, optionValueId, selectedVariant);

    const url = new URL(window.location.href);

    const variantId = selectedVariant?.id?.toString() || selectedOption.dataset.variantId || null;

    if (isOnProductPage) {
      if (variantId) {
        if (selectedVariant) {
          url.searchParams.set('variant', selectedVariant.id.toString());
        } else {
          url.searchParams.set('variant', variantId);
        }
      } else {
        url.searchParams.delete('variant');
      }
    }

    // Change the path if the option is connected to another product via combined listing.
    if (loadsNewProduct) {
      url.pathname = newUrl;
    }

    if (url.href !== window.location.href) {
      yieldToMainThread().then(() => {
        history.replaceState({}, '', url.toString());
      });
    }
  }

  /**
   * @typedef {object} FieldsetMeasurements
   * @property {HTMLFieldSetElement} fieldset
   * @property {number | undefined} currentIndex
   * @property {number | undefined} previousIndex
   * @property {number | undefined} currentWidth
   * @property {number | undefined} previousWidth
   */

  /**
   * Gets measurements for a single fieldset (read phase).
   * @param {number} fieldsetIndex
   * @returns {FieldsetMeasurements | null}
   */
  #getFieldsetMeasurements(fieldsetIndex) {
    const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);
    const fieldset = fieldsets[fieldsetIndex];
    const checkedIndices = this.#checkedIndices[fieldsetIndex];
    const radios = this.#radios[fieldsetIndex];

    if (!radios || !checkedIndices || !fieldset) return null;

    const [currentIndex, previousIndex] = checkedIndices;

    return {
      fieldset,
      currentIndex,
      previousIndex,
      currentWidth: currentIndex !== undefined ? radios[currentIndex]?.parentElement?.offsetWidth : undefined,
      previousWidth: previousIndex !== undefined ? radios[previousIndex]?.parentElement?.offsetWidth : undefined,
    };
  }

  /**
   * Applies measurements to a fieldset (write phase).
   * @param {FieldsetMeasurements} measurements
   */
  #applyFieldsetMeasurements({ fieldset, currentWidth, previousWidth, currentIndex, previousIndex }) {
    if (currentWidth) {
      fieldset.style.setProperty('--pill-width-current', `${currentWidth}px`);
    } else if (currentIndex !== undefined) {
      fieldset.style.removeProperty('--pill-width-current');
    }

    if (previousWidth) {
      fieldset.style.setProperty('--pill-width-previous', `${previousWidth}px`);
    } else if (previousIndex !== undefined) {
      fieldset.style.removeProperty('--pill-width-previous');
    }
  }

  /**
   * Updates the fieldset CSS.
   * @param {number} fieldsetIndex - The fieldset index.
   */
  updateFieldsetCss(fieldsetIndex) {
    if (Number.isNaN(fieldsetIndex)) return;

    const measurements = this.#getFieldsetMeasurements(fieldsetIndex);
    if (measurements) {
      this.#applyFieldsetMeasurements(measurements);
    }
  }

  /**
   * Updates the selected option.
   * @param {string | Element} target - The target element.
   */
  updateSelectedOption(target) {
    if (typeof target === 'string') {
      const targetElement = this.querySelector(`[data-option-value-id="${target}"]`);

      if (!targetElement) throw new Error('Target element not found');

      target = targetElement;
    }

    if (target instanceof HTMLInputElement) {
      const fieldsetIndex = Number.parseInt(target.dataset.fieldsetIndex || '');
      const inputIndex = Number.parseInt(target.dataset.inputIndex || '');

      if (!Number.isNaN(fieldsetIndex) && !Number.isNaN(inputIndex)) {
        const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);
        const fieldset = fieldsets[fieldsetIndex];
        const checkedIndices = this.#checkedIndices[fieldsetIndex];
        const radios = this.#radios[fieldsetIndex];

        if (radios && checkedIndices && fieldset) {
          // Clear previous checked states
          const [currentIndex, previousIndex] = checkedIndices;

          if (currentIndex !== undefined && radios[currentIndex]) {
            radios[currentIndex].dataset.previousChecked = 'false';
          }
          if (previousIndex !== undefined && radios[previousIndex]) {
            radios[previousIndex].dataset.previousChecked = 'false';
          }

          // Update checked indices array - keep only the last 2 selections
          checkedIndices.unshift(inputIndex);
          checkedIndices.length = Math.min(checkedIndices.length, 2);

          // Update the new states
          const newCurrentIndex = checkedIndices[0]; // This is always inputIndex
          const newPreviousIndex = checkedIndices[1]; // This might be undefined

          // newCurrentIndex is guaranteed to exist since we just added it
          if (newCurrentIndex !== undefined && radios[newCurrentIndex]) {
            radios[newCurrentIndex].dataset.currentChecked = 'true';
          }

          if (newPreviousIndex !== undefined && radios[newPreviousIndex]) {
            radios[newPreviousIndex].dataset.previousChecked = 'true';
            radios[newPreviousIndex].dataset.currentChecked = 'false';
          }

          this.updateFieldsetCss(fieldsetIndex);
        }
      }
      target.checked = true;
    }

    if (target instanceof HTMLSelectElement) {
      const newValue = target.value;
      const newSelectedOption = Array.from(target.options).find((option) => option.value === newValue);

      if (!newSelectedOption) throw new Error('Option not found');

      for (const option of target.options) {
        option.removeAttribute('selected');
      }

      newSelectedOption.setAttribute('selected', 'selected');
    }
  }

  /**
   * Builds the request URL.
   * @param {HTMLElement} selectedOption - The selected option.
   * @param {string | null} [source] - The source.
   * @param {string[]} [sourceSelectedOptionsValues] - The source selected options values.
   * @returns {string} The request URL.
   */
  buildRequestUrl(selectedOption, source = null, sourceSelectedOptionsValues = []) {
    // this productUrl and pendingRequestUrl will be useful for the support of combined listing. It is used when a user changes variant quickly and those products are using separate URLs (combined listing).
    // We create a new URL and abort the previous fetch request if it's still pending.
    let productUrl = selectedOption.dataset.connectedProductUrl || this.#pendingRequestUrl || this.dataset.productUrl;
    this.#pendingRequestUrl = productUrl;
    const params = [];
    const viewParamValue = getViewParameterValue();

    // preserve view parameter, if it exists, for alternative product view testing
    if (viewParamValue) params.push(`view=${viewParamValue}`);

    if (this.selectedOptionsValues.length && !source) {
      params.push(`option_values=${this.selectedOptionsValues.join(',')}`);
    } else if (source === 'product-card') {
      if (this.selectedOptionsValues.length) {
        params.push(`option_values=${sourceSelectedOptionsValues.join(',')}`);
      } else {
        params.push(`option_values=${selectedOption.dataset.optionValueId}`);
      }
    }

    // If variant-picker is a child of some specific sections, we need to append section_id=xxxx to the URL
    const SECTION_ID_MAP = {
      'quick-add-component': 'section-rendering-product-card',
      'swatches-variant-picker-component': 'section-rendering-product-card',
      'featured-product-information': this.closest('featured-product-information')?.id,
    };

    const closestSectionId = /** @type {keyof typeof SECTION_ID_MAP} | undefined */ (
      Object.keys(SECTION_ID_MAP).find((sectionId) => this.closest(sectionId))
    );

    if (closestSectionId) {
      if (productUrl?.includes('?')) {
        productUrl = productUrl.split('?')[0];
      }
      return `${productUrl}?section_id=${SECTION_ID_MAP[closestSectionId]}&${params.join('&')}`;
    }

    return `${productUrl}?${params.join('&')}`;
  }

  /**
   * Fetches the updated section.
   * @param {string} requestUrl - The request URL.
   * @param {string} [morphElementSelector] - The selector of the element to be morphed. By default, only the variant picker is morphed.
   * @param {string} [optionValueId] - The selected option value ID for event detail.
   * @param {Record<string, any> | null} [selectedVariant] - The selected variant resolved locally before fetching.
   */
  fetchUpdatedSection(requestUrl, morphElementSelector, optionValueId = '', selectedVariant = null) {
    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    const deferredEventPromise = ProductSelectEvent.createPromise();
    const selectedOptions = this.getAllSelectedOptions();

    this.dispatchEvent(
      new ProductSelectEvent({
        product: {
          id: this.dataset.productId ?? '',
          title: this.dataset.productTitle ?? '',
          handle: this.dataset.productHandle ?? '',
        },
        selectedOptions,
        detail: {
          optionValueId,
          variant: selectedVariant,
        },
        promise: deferredEventPromise.promise,
      })
    );

    fetch(requestUrl, { signal: this.#abortController.signal })
      .then((response) => response.text())
      .then((responseText) => {
        this.#pendingRequestUrl = undefined;
        const html = new DOMParser().parseFromString(responseText, 'text/html');
        // Defer is only useful for the initial rendering of the page. Remove it here.
        html.querySelector('overflow-list[defer]')?.removeAttribute('defer');

        const variantPickerJsonScript = html.querySelector(`variant-picker script[type="application/json"]`);
        const textContent = variantPickerJsonScript?.textContent;

        if (!textContent) {
          deferredEventPromise.resolve({
            variant: null,
            detail: {
              html,
              productId: this.dataset.productId ?? '',
              sourceId: this.selectedOptionId,
              resource: null,
            },
          });
          return;
        }

        let newProduct;

        if (morphElementSelector === 'main') {
          this.updateMain(html);
        } else if (morphElementSelector) {
          this.updateElement(html, morphElementSelector);
        } else {
          const { overflowList } = this.refs;
          const wasSwatchesExpanded =
            overflowList instanceof OverflowList && overflowList.getAttribute('disabled') === 'true';

          newProduct = this.updateVariantPicker(html);

          if (wasSwatchesExpanded) {
            const overflowListAfterMorph = overflowList;
            if (overflowListAfterMorph instanceof OverflowList) {
              overflowListAfterMorph.showAll();
            }
          }
        }

        // Resolve the ProductSelectEvent promise with all data needed by listeners
        if (this.selectedOptionId) {
          const variantData = JSON.parse(textContent);

          if (variantData && typeof variantData === 'object') {
            const productViewAttr = variantPickerJsonScript
              ?.closest('[view-event-payload]')
              ?.getAttribute('view-event-payload')
              ?.trim();

            deferredEventPromise.resolve({
              variant: (productViewAttr && JSON.parse(productViewAttr))?.product?.selectedVariant ?? null,
              detail: {
                html,
                productId: this.dataset.productId ?? '',
                newProduct,
                sourceId: this.selectedOptionId,
                resource: variantData,
              },
            });

            return;
          }
        }

        // Variant data is null/invalid (e.g. unavailable variant combination) —
        // still include detail with html so listeners can update UI (disable buttons, morph text)
        deferredEventPromise.resolve({
          variant: null,
          detail: {
            html,
            productId: this.dataset.productId ?? '',
            newProduct,
            sourceId: this.selectedOptionId,
            resource: null,
          },
        });
      })
      .catch((error) => {
        deferredEventPromise.reject(error);
        if (error.name === 'AbortError') {
          console.warn('Fetch aborted by user');
        } else {
          console.error(error);
        }
      });
  }

  /**
   * @typedef {Object} NewProduct
   * @property {string} id
   * @property {string} url
   */

  /**
   * Re-renders the variant picker.
   * @param {Document | Element} newHtml - The new HTML.
   * @returns {NewProduct | undefined} Information about the new product if it has changed, otherwise undefined.
   */
  updateVariantPicker(newHtml) {
    /** @type {NewProduct | undefined} */
    let newProduct;

    const newVariantPickerSource = newHtml.querySelector(this.tagName.toLowerCase());

    if (!newVariantPickerSource) {
      throw new Error('No new variant picker source found');
    }

    // For combined listings, the product might have changed, so update the related data attribute.
    if (newVariantPickerSource instanceof HTMLElement) {
      const newProductId = newVariantPickerSource.dataset.productId;
      const newProductUrl = newVariantPickerSource.dataset.productUrl;

      if (newProductId && newProductUrl && this.dataset.productId !== newProductId) {
        newProduct = { id: newProductId, url: newProductUrl };
      }

      this.dataset.productId = newProductId;
      this.dataset.productUrl = newProductUrl;
    }

    morph(this, newVariantPickerSource, {
      ...MORPH_OPTIONS,
      getNodeKey: (node) => {
        if (!(node instanceof HTMLElement)) return undefined;
        const key = node.dataset.key;
        return key;
      },
    });
    this.#refreshOptionInputState();
    this.#hydrateBeddingVariantData();
    this.#syncBeddingDependentOptions();
    this.updateVariantPickerCss();

    return newProduct;
  }

  #refreshOptionInputState() {
    this.#checkedIndices = [];
    this.#radios = [];

    const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);

    fieldsets.forEach((fieldset) => {
      const radios = Array.from(fieldset?.querySelectorAll('input') ?? []);
      this.#radios.push(radios);

      const initialCheckedIndex = radios.findIndex((radio) => radio.dataset.currentChecked === 'true');
      if (initialCheckedIndex !== -1) {
        this.#checkedIndices.push([initialCheckedIndex]);
      } else {
        this.#checkedIndices.push([]);
      }
    });
  }

  #hydrateBeddingVariantData() {
    try {
      this.#optionNames = JSON.parse(this.dataset.optionNames || '[]');
    } catch {
      this.#optionNames = [];
    }

    const variantsScript = this.querySelector('script[data-product-variants]');
    try {
      this.#productVariants = JSON.parse(variantsScript?.textContent || '[]');
    } catch {
      this.#productVariants = [];
    }

    this.#beddingTypeOptionIndex = this.#optionNames.findIndex(
      (name) => name.trim().toLowerCase() === 'bedding type'
    );
  }

  #isBeddingDependentPicker() {
    return (
      (this.dataset.productType || '').trim().toLowerCase() === 'bedding' &&
      this.#beddingTypeOptionIndex !== -1 &&
      this.#productVariants.length > 0
    );
  }

  /**
   * @param {Record<string, any>} variant
   * @param {number} index
   * @returns {string}
   */
  #getVariantOptionValue(variant, index) {
    const value = Array.isArray(variant.options) ? variant.options[index] : variant[`option${index + 1}`];
    return value == null ? '' : value.toString();
  }

  /**
   * @returns {string[]}
   */
  #getSelectedOptionValuesByIndex() {
    const values = Array.from({ length: this.#optionNames.length }, () => '');

    for (const select of this.querySelectorAll('select')) {
      const selected = select.selectedOptions[0];
      const index = this.#optionNames.findIndex((name) => name === selected?.dataset.optionName);
      if (index !== -1 && selected) values[index] = selected.value;
    }

    /** @type {NodeListOf<HTMLInputElement>} */
    const checkedInputs = this.querySelectorAll('fieldset input:checked');
    for (const input of checkedInputs) {
      const index = this.#optionNames.findIndex((name) => name === input.dataset.optionName);
      if (index !== -1) values[index] = input.value;
    }

    return values;
  }

  /**
   * @param {number} optionIndex
   * @param {string[]} selectedValues
   * @returns {Set<string>}
   */
  #getValidValuesForOption(optionIndex, selectedValues) {
    const validValues = new Set();

    for (const variant of this.#productVariants) {
      let matchesPreviousOptions = true;

      for (let index = 0; index < optionIndex; index += 1) {
        const selectedValue = selectedValues[index];
        if (selectedValue && this.#getVariantOptionValue(variant, index) !== selectedValue) {
          matchesPreviousOptions = false;
          break;
        }
      }

      if (matchesPreviousOptions) {
        const value = this.#getVariantOptionValue(variant, optionIndex);
        if (value) validValues.add(value);
      }
    }

    return validValues;
  }

  /**
   * @param {number} optionIndex
   * @param {string} value
   * @param {string[]} selectedValues
   * @returns {boolean}
   */
  #hasAvailableVariantForOptionValue(optionIndex, value, selectedValues) {
    return this.#productVariants.some((variant) => {
      if (this.#getVariantOptionValue(variant, optionIndex) !== value) return false;

      return this.#optionNames.every((_, index) => {
        if (index === optionIndex) return true;

        const selectedValue = selectedValues[index];
        return !selectedValue || this.#getVariantOptionValue(variant, index) === selectedValue;
      }) && variant.available !== false;
    });
  }

  /**
   * @param {number} optionIndex
   * @returns {(HTMLInputElement | HTMLOptionElement)[]}
   */
  #getOptionControls(optionIndex) {
    const optionName = this.#optionNames[optionIndex];
    if (!optionName) return [];

    return Array.from(this.querySelectorAll('fieldset input, select option')).filter((control) => {
      return (
        (control instanceof HTMLInputElement || control instanceof HTMLOptionElement) &&
        control.dataset.optionName === optionName
      );
    });
  }

  /**
   * @param {number} optionIndex
   * @param {Set<string>} validValues
   * @returns {string}
   */
  #getFirstValidControlValue(optionIndex, validValues) {
    const controls = this.#getOptionControls(optionIndex);
    const firstControl = controls.find((control) => validValues.has(control.value));
    return firstControl?.value || '';
  }

  /**
   * @param {number} optionIndex
   * @param {string} value
   */
  #selectOptionValue(optionIndex, value) {
    if (!value) return;

    const controls = this.#getOptionControls(optionIndex);
    const control = controls.find((candidate) => candidate.value === value);
    if (!control) return;

    if (control instanceof HTMLInputElement) {
      this.updateSelectedOption(control);
      return;
    }

    const select = control.closest('select');
    if (select instanceof HTMLSelectElement) {
      select.value = value;
      this.updateSelectedOption(select);
    }
  }

  #resetInvalidBeddingSelections() {
    if (!this.#isBeddingDependentPicker()) return;

    for (let optionIndex = this.#beddingTypeOptionIndex + 1; optionIndex < this.#optionNames.length; optionIndex += 1) {
      const selectedValues = this.#getSelectedOptionValuesByIndex();
      const validValues = this.#getValidValuesForOption(optionIndex, selectedValues);
      const selectedValue = selectedValues[optionIndex];

      if (!selectedValue || !validValues.has(selectedValue)) {
        this.#selectOptionValue(optionIndex, this.#getFirstValidControlValue(optionIndex, validValues));
      }
    }
  }

  #syncBeddingDependentOptions() {
    if (!this.#isBeddingDependentPicker()) return;

    this.#resetInvalidBeddingSelections();

    for (let optionIndex = this.#beddingTypeOptionIndex + 1; optionIndex < this.#optionNames.length; optionIndex += 1) {
      const selectedValues = this.#getSelectedOptionValuesByIndex();
      const validValues = this.#getValidValuesForOption(optionIndex, selectedValues);

      for (const control of this.#getOptionControls(optionIndex)) {
        const isValid = validValues.has(control.value);

        if (control instanceof HTMLInputElement) {
          const isAvailable = isValid && this.#hasAvailableVariantForOptionValue(
            optionIndex,
            control.value,
            selectedValues
          );
          const label = control.closest('label');

          control.disabled = !isValid;
          control.dataset.optionAvailable = isAvailable ? 'true' : 'false';
          control.toggleAttribute('aria-disabled', !isAvailable);
          label?.toggleAttribute('hidden', !isValid);
          label?.querySelectorAll('.variant-option__strikethrough').forEach((strikethrough) => {
            strikethrough.toggleAttribute('hidden', isAvailable);
          });
        } else {
          control.disabled = !isValid;
          control.hidden = !isValid;
        }
      }
    }
  }

  #getSelectedVariant() {
    if (!this.#isBeddingDependentPicker()) return null;

    const selectedValues = this.#getSelectedOptionValuesByIndex();
    return (
      this.#productVariants.find((variant) => {
        return this.#optionNames.every((_, index) => this.#getVariantOptionValue(variant, index) === selectedValues[index]);
      }) || null
    );
  }

  updateVariantPickerCss() {
    const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);

    // Batch all reads first across all fieldsets to avoid layout thrashing
    const measurements = fieldsets.map((_, index) => this.#getFieldsetMeasurements(index)).filter((m) => m !== null);

    // Batch all writes after all reads
    for (const measurement of measurements) {
      this.#applyFieldsetMeasurements(measurement);
    }
  }

  /**
   * Re-renders the desired element.
   * @param {Document} newHtml - The new HTML.
   * @param {string} elementSelector - The selector of the element to re-render.
   */
  updateElement(newHtml, elementSelector) {
    const element = this.closest(elementSelector);
    const newElement = newHtml.querySelector(elementSelector);

    if (!element || !newElement) {
      throw new Error(`No new element source found for ${elementSelector}`);
    }

    morph(element, newElement);
  }

  /**
   * Re-renders the entire main content.
   * @param {Document} newHtml - The new HTML.
   */
  updateMain(newHtml) {
    const main = document.querySelector('main');
    const newMain = newHtml.querySelector('main');

    if (!main || !newMain) {
      throw new Error('No new main source found');
    }

    morph(main, newMain);
  }

  /**
   * Gets the selected option.
   * @returns {HTMLInputElement | HTMLOptionElement | undefined} The selected option.
   */
  get selectedOption() {
    const selectedOption = this.querySelector('select option[selected], fieldset input:checked');

    if (!(selectedOption instanceof HTMLInputElement || selectedOption instanceof HTMLOptionElement)) {
      return undefined;
    }

    return selectedOption;
  }

  /**
   * Gets all the selected options.
   * @returns {{name: string, value: string}[]} All the currently selected options.
   */
  getAllSelectedOptions() {
    /** @type {{name: string, value: string}[]} */
    const options = [];

    // For <select> elements, use .selectedOptions to get the current selection
    // (the [selected] HTML attribute only reflects the initial state, not user changes)
    for (const select of this.querySelectorAll('select')) {
      const selected = select.selectedOptions[0];
      if (selected?.dataset?.optionName) {
        options.push({ name: selected.dataset.optionName, value: selected.value });
      }
    }

    // For radio/checkbox fieldsets, :checked reflects the current state
    /** @type {NodeListOf<HTMLInputElement>} */
    const checkedInputs = this.querySelectorAll('fieldset input:checked');
    for (const input of checkedInputs) {
      if (input.dataset?.optionName) {
        options.push({ name: input.dataset.optionName, value: input.value });
      }
    }

    return options;
  }

  /**
   * Gets the selected option ID.
   * @returns {string | undefined} The selected option ID.
   */
  get selectedOptionId() {
    const { selectedOption } = this;
    if (!selectedOption) return undefined;
    const { optionValueId } = selectedOption.dataset;

    if (!optionValueId) {
      throw new Error('No option value ID found');
    }

    return optionValueId;
  }

  /**
   * Gets the selected options values.
   * @returns {string[]} The selected options values.
   */
  get selectedOptionsValues() {
    /** @type HTMLElement[] */
    const selectedOptions = Array.from(this.querySelectorAll('select option[selected], fieldset input:checked'));

    return selectedOptions.map((option) => {
      const { optionValueId } = option.dataset;

      if (!optionValueId) throw new Error('No option value ID found');

      return optionValueId;
    });
  }
}

if (!customElements.get('variant-picker')) {
  customElements.define('variant-picker', VariantPicker);
}
