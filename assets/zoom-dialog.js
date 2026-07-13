import { Component } from '@theme/component';
import {
  supportsViewTransitions,
  startViewTransition,
  onAnimationEnd,
  prefersReducedMotion,
  preloadImage,
  isLowPowerDevice,
} from '@theme/utilities';
import { scrollIntoView } from '@theme/scrolling';
import { ZoomMediaSelectedEvent } from '@theme/events';
import { DialogCloseEvent } from '@theme/dialog';
/**
 * A custom element that renders a zoom dialog.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog - The dialog element.
 * @property {HTMLElement[]} media - The media elements.
 * @property {HTMLElement} thumbnails - The thumbnails elements.
 *
 * @extends Component<Refs>
 */
export class ZoomDialog extends Component {
  requiredRefs = ['dialog', 'media', 'thumbnails'];

  #highResImagesLoaded = /** @type {Set<string>} */ (new Set());

  connectedCallback() {
    super.connectedCallback();
    this.#syncActiveMediaFromSelection();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  /**
   * Opens the zoom dialog.
   *
   * @param {number} index - The index of the media to zoom.
   * @param {PointerEvent} event - The pointer event.
   */
  async open(index, event) {
    event.preventDefault();

    const { dialog, media, thumbnails } = this.refs;
    const targetImage = media[index];
    const targetThumbnail = thumbnails.children[index];

    const open = () => {
      this.#setActiveMedia(index);
      dialog.showModal();
      targetThumbnail?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
    };

    /** @type {HTMLElement | null} */
    const sourceImage = event.target instanceof Element ? event.target.closest('li,slideshow-slide') : null;

    if (!supportsViewTransitions() || isLowPowerDevice() || !sourceImage || !targetImage) return open();

    const itemTransitionName = `gallery-item-open`;
    sourceImage.style.setProperty('view-transition-name', itemTransitionName);

    const focalPoint = sourceImage.dataset.focalPoint;
    if (focalPoint) {
      document.documentElement.style.setProperty('--gallery-media-focal-point', focalPoint);
    }

    await startViewTransition(() => {
      open();
      sourceImage.style.removeProperty('view-transition-name');
      targetImage.style.setProperty('view-transition-name', itemTransitionName);
    });

    document.documentElement.style.removeProperty('--gallery-media-focal-point');
    targetImage.style.removeProperty('view-transition-name');

    this.selectThumbnail(index, { behavior: 'instant' });
  }

  /**
   * Loads a high-resolution image for a specific media container
   * @param {HTMLElement} mediaContainer - The media container element
   */
  loadHighResolutionImage(mediaContainer) {
    if (!mediaContainer.classList.contains('product-media-container--image')) return false;

    const image = mediaContainer.querySelector('img.product-media__image');
    if (!image || !(image instanceof HTMLImageElement)) return false;

    const highResolutionUrl = image.getAttribute('data_max_resolution');
    if (!highResolutionUrl || this.#highResImagesLoaded.has(highResolutionUrl)) return false;

    preloadImage(highResolutionUrl);

    const newImage = new Image();
    newImage.className = image.className;
    newImage.alt = image.alt;
    newImage.setAttribute('data_max_resolution', highResolutionUrl);
    newImage.setAttribute('ref', 'image');

    // When the high-resolution image loads, replace the existing image
    newImage.onload = () => {
      image.replaceWith(newImage);
      this.#highResImagesLoaded.add(highResolutionUrl);
    };

    newImage.src = highResolutionUrl;
  }

  /**
   * Closes the zoom dialog.
   */
  async close() {
    const { dialog, media } = this.refs;

    if (!supportsViewTransitions() || isLowPowerDevice()) return this.closeDialog();

    const activeIndex = this.#getActiveIndex();
    const mostVisibleElement = media[activeIndex];
    if (!mostVisibleElement) return this.closeDialog();

    const itemTransitionName = `gallery-item-close`;

    const mediaGallery = /** @type {import('./media-gallery').MediaGallery | undefined} */ (
      this.closest('media-gallery')
    );

    const slideshowActive = mediaGallery?.presentation === 'carousel';

    const slide = slideshowActive ? mediaGallery.slideshow?.slides?.[activeIndex] : mediaGallery?.media?.[activeIndex];

    if (!slide) return this.closeDialog();
    const focalPoint = slide.dataset.focalPoint;
    if (focalPoint) {
      document.documentElement.style.setProperty('--gallery-media-focal-point', focalPoint);
    }

    dialog.classList.add('dialog--closed');

    await onAnimationEnd(this.refs.thumbnails);

    mostVisibleElement.style.setProperty('view-transition-name', itemTransitionName);

    await startViewTransition(() => {
      mostVisibleElement.style.removeProperty('view-transition-name');
      slide.style.setProperty('view-transition-name', itemTransitionName);
      this.closeDialog();
    });

    slide.style.removeProperty('view-transition-name');
    dialog.classList.remove('dialog--closed');
    document.documentElement.style.removeProperty('--gallery-media-focal-point');
  }

  closeDialog() {
    const { dialog } = this.refs;
    dialog.close();
    window.dispatchEvent(new DialogCloseEvent());
  }

  /**
   * Closes the dialog when the user presses the escape key.
   *
   * @param {KeyboardEvent} event - The keyboard event.
   */
  handleKeyDown(event) {
    if (event.key !== 'Escape') return;

    event.preventDefault();
    this.close();
  }

  /**
   * Handles the click event of a thumbnail.
   * @param {number} index - The index of the thumbnail to select.
   */
  async handleThumbnailClick(index) {
    const behavior = prefersReducedMotion() ? 'instant' : 'smooth';
    this.selectThumbnail(index, { behavior });
  }

  /**
   * Handles the pointer enter event of a thumbnail.
   * @param {number} index - The index of the thumbnail to load the high-resolution image for.
   */
  async handleThumbnailPointerEnter(index) {
    const { media } = this.refs;
    if (!media[index]) return;

    this.loadHighResolutionImage(media[index]);
  }

  /**
   * Handles the selection of a thumbnail.
   * @param {number} index - The index of the thumbnail to select.
   * @param {Object} options - The options for the selection.
   * @param {ScrollBehavior} options.behavior - The behavior of the scroll.
   */
  async selectThumbnail(index, options = { behavior: 'smooth' }) {
    if (!this.refs.thumbnails || !this.refs.thumbnails.children.length) return;

    // Guard if invalid
    if (isNaN(index) || index < 0 || index >= this.refs.thumbnails.children.length) return;

    const { media, thumbnails } = this.refs;
    const targetThumbnail = thumbnails.children[index];

    if (!targetThumbnail || !(targetThumbnail instanceof HTMLElement)) return;

    Array.from(thumbnails.querySelectorAll('button')).forEach((button, i) => {
      button.setAttribute('aria-selected', `${i === index}`);
    });

    this.#setActiveMedia(index);

    scrollIntoView(targetThumbnail, {
      ancestor: thumbnails,
      behavior: options.behavior,
      block: 'center',
      inline: 'center',
    });

    const targetImage = media[index];

    if (targetImage) {
      this.loadHighResolutionImage(targetImage);
    }
    this.dispatchEvent(new ZoomMediaSelectedEvent(index));
  }

  #getActiveIndex() {
    const selectedIndex = Array.from(this.refs.thumbnails.querySelectorAll('button')).findIndex(
      (button) => button.getAttribute('aria-selected') === 'true'
    );

    return selectedIndex >= 0 ? selectedIndex : 0;
  }

  #setActiveMedia(index) {
    this.refs.media.forEach((item, mediaIndex) => {
      const isActive = mediaIndex === index;
      if (!isActive) {
        item.querySelector('drag-zoom-wrapper')?.resetZoomState?.();
      }
      item.toggleAttribute('hidden', !isActive);
      item.setAttribute('aria-hidden', `${!isActive}`);
      item.dataset.active = `${isActive}`;
    });
  }

  #syncActiveMediaFromSelection() {
    this.#setActiveMedia(this.#getActiveIndex());
  }
}

if (!customElements.get('zoom-dialog')) {
  customElements.define('zoom-dialog', ZoomDialog);
}
