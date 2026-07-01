import { Component } from '@theme/component';
import { ThemeEvents, ZoomMediaSelectedEvent } from '@theme/events';
import { StandardEvents, ProductSelectEvent } from '@shopify/events';

/**
 * A custom element that renders a media gallery.
 *
 * @typedef {object} Refs
 * @property {import('./zoom-dialog').ZoomDialog} [zoomDialogComponent] - The zoom dialog component.
 * @property {import('./slideshow').Slideshow} [slideshow] - The slideshow component.
 * @property {HTMLElement[]} [media] - The media elements.
 *
 * @extends Component<Refs>
 */
export class MediaGallery extends Component {
  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#controller;
    const target = this.closest('.shopify-section, dialog');

    target?.addEventListener(StandardEvents.productSelect, this.#handleProductSelect, { signal });
    this.refs.zoomDialogComponent?.addEventListener(ThemeEvents.zoomMediaSelected, this.#handleZoomMediaSelected, {
      signal,
    });
  }

  #controller = new AbortController();

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#controller.abort();
  }

  /**
   * Handles a product select event by replacing the current media gallery with a new one.
   *
   * @param {ProductSelectEvent} event - The product select event.
   */
  #handleProductSelect = (event) => {
    if (
      !(event.target instanceof Element) ||
      event.target.closest('product-card') ||
      event.target.closest('quick-add-dialog, .quick-add-modal')
    ) {
      return;
    }

    const variantPicker = event.target.closest('variant-picker');
    const optionValueId = event.detail?.optionValueId;

    const selectedOption =
      (optionValueId && variantPicker?.querySelector(`[data-option-value-id="${CSS.escape(optionValueId)}"]`)) ||
      (event.target instanceof HTMLSelectElement ? event.target.options[event.target.selectedIndex] : null) ||
      variantPicker?.querySelector('select option:checked, select option[selected], fieldset input:checked');

    const mediaId = selectedOption?.dataset?.optionMediaId;

    if (mediaId && this.slideshow) {
      const slide = this.slideshow.refs?.slides?.find(
        (slide) => slide.getAttribute('slide-id') === mediaId || slide.dataset.mediaId === mediaId
      );

      if (slide) {
        this.slideshow.select({ id: mediaId }, undefined, { animate: false });
      }
    }

    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;

        const { html } = detail;
        const newMediaGallery = html.querySelector('media-gallery');
        if (!newMediaGallery) return;

        this.replaceWith(newMediaGallery);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[media-gallery] Event promise rejected:', error);
      });
  };

  /**
   * Handles the 'zoom-media:selected' event.
   * @param {ZoomMediaSelectedEvent} event - The zoom-media:selected event.
   */
  #handleZoomMediaSelected = async (event) => {
    this.slideshow?.select(event.detail.index, undefined, { animate: false });
  };

  /**
   * Zooms the media gallery.
   *
   * @param {number} index - The index of the media to zoom.
   * @param {PointerEvent} event - The pointer event.
   */
  zoom(index, event) {
    this.refs.zoomDialogComponent?.open(index, event);
  }

  /**
   * Preloads an image.
   * @param {number} index - The index of the media to preload.
   */
  preloadImage(index) {
    const zoomDialogMedia = this.refs.zoomDialogComponent?.refs.media[index];
    if (!zoomDialogMedia) return;

    this.refs.zoomDialogComponent?.loadHighResolutionImage(zoomDialogMedia);
  }

  get slideshow() {
    return this.refs.slideshow;
  }

  get media() {
    return this.refs.media;
  }

  get presentation() {
    return this.dataset.presentation;
  }
}

if (!customElements.get('media-gallery')) {
  customElements.define('media-gallery', MediaGallery);
}
