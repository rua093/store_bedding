/**
 * @typedef {Object} PersonalizationSelection
 * @property {string} groupId
 * @property {string} groupName
 * @property {string} layerKey
 * @property {string} optionId
 * @property {string} optionLabel
 * @property {string} layerImage
 */

class ProductPersonalizer {
  /**
   * @param {HTMLElement} root
   */
  constructor(root) {
    /** @type {HTMLElement} */
    this.root = root;

    /** @type {HTMLElement[]} */
    this.groups = [];

    /** @type {HTMLInputElement | null} */
    this.jsonInput = null;

    /** @type {HTMLInputElement | null} */
    this.idInput = null;

    /** @type {HTMLElement | null} */
    this.summary = null;

    /** @type {string} */
    this.personalizationId = '';

    this.groups = [
      ...root.querySelectorAll('[data-personalizer-group]')
    ].filter(
      /**
       * @param {Element} group
       * @returns {group is HTMLElement}
       */
      (group) => group instanceof HTMLElement
    );

    const jsonInput = root.querySelector(
      '[data-personalization-json-input]'
    );

    const idInput = root.querySelector(
      '[data-personalization-id-input]'
    );

    const summary = root.querySelector(
      '[data-personalization-properties]'
    );

    if (
      !(jsonInput instanceof HTMLInputElement) ||
      !(idInput instanceof HTMLInputElement) ||
      !this.groups.length
    ) {
      return;
    }

    this.jsonInput = jsonInput;
    this.idInput = idInput;
    this.summary =
      summary instanceof HTMLElement ? summary : null;

    this.personalizationId = this.createId();
    this.idInput.value = this.personalizationId;

    this.bindEvents();
    this.ensureDefaults();
    this.update();

    this.root.dataset.initialized = 'true';
  }

  /**
   * @returns {string}
   */
  createId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }

    return `pers_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;
  }

  /**
   * @returns {void}
   */
  bindEvents() {
    this.root.addEventListener('click', (event) => {
      const target = event.target;

      if (
        !(target instanceof HTMLInputElement) ||
        !target.matches('.personalizer-option__input')
      ) {
        return;
      }

      if (target.dataset.wasChecked === 'true') {
        target.checked = false;
        target.dataset.wasChecked = 'false';
      } else {
        const name = target.name;
        if (name) {
          const otherRadios = this.root.querySelectorAll(
            `input[name="${CSS.escape(name)}"]`
          );
          otherRadios.forEach((radio) => {
            if (radio instanceof HTMLInputElement) {
              radio.dataset.wasChecked = 'false';
            }
          });
        }
        target.dataset.wasChecked = 'true';
      }

      this.update();
    });
  }

  /**
   * @returns {void}
   */
  ensureDefaults() {
    this.groups.forEach((group) => {
      const checked = group.querySelector(
        '.personalizer-option__input:checked'
      );

      if (checked instanceof HTMLInputElement) {
        checked.dataset.wasChecked = 'true';
        return;
      }

      const first = group.querySelector(
        '.personalizer-option__input'
      );

      if (first instanceof HTMLInputElement) {
        first.checked = true;
        first.dataset.wasChecked = 'true';
      }
    });
  }

  /**
   * @returns {PersonalizationSelection[]}
   */
  getSelections() {
    return this.groups.map((group) => {
      const selected = group.querySelector(
        '.personalizer-option__input:checked'
      );

      const selectedInput =
        selected instanceof HTMLInputElement
          ? selected
          : null;

      return {
        groupId: group.dataset.groupId || '',
        groupName: group.dataset.groupName || '',
        layerKey: group.dataset.layerKey || '',
        optionId: selectedInput?.value || '',
        optionLabel:
          selectedInput?.dataset.optionLabel || '',
        layerImage:
          selectedInput?.dataset.layerImage || ''
      };
    });
  }

  /**
   * @param {PersonalizationSelection[]} selections
   * @returns {void}
   */
  updatePreview(selections) {
    const productId = this.root.dataset.productId;

    if (!productId) {
      return;
    }

    const previews = document.querySelectorAll(
      `[data-personalizer-preview="${CSS.escape(productId)}"]`
    );

    if (!previews.length) {
      return;
    }

    previews.forEach((preview) => {
      if (!(preview instanceof HTMLElement)) {
        return;
      }

      selections.forEach((selection) => {
        if (!selection.layerKey) {
          return;
        }

        const layers = preview.querySelectorAll(
          `[data-preview-layer="${CSS.escape(
            selection.layerKey
          )}"]`
        );

        layers.forEach((layer) => {
          if (!(layer instanceof HTMLImageElement)) {
            return;
          }

          if (!selection.layerImage) {
            layer.hidden = true;
            layer.removeAttribute('src');
            return;
          }

          layer.src = selection.layerImage;
          layer.hidden = false;
        });
      });
    });
  }

  /**
   * @param {PersonalizationSelection[]} selections
   * @returns {void}
   */
  updateSummary(selections) {
    const summary = this.summary;

    if (!(summary instanceof HTMLElement)) {
      return;
    }

    summary.replaceChildren();

    selections.forEach((selection) => {
      if (!selection.groupName || !selection.optionLabel) {
        return;
      }

      const hiddenInput = document.createElement('input');

      hiddenInput.type = 'hidden';
      hiddenInput.name =
        `properties[${selection.groupName}]`;
      hiddenInput.value = selection.optionLabel;

      summary.append(hiddenInput);
    });
  }

  /**
   * @param {PersonalizationSelection[]} selections
   * @returns {void}
   */
  updateJson(selections) {
    const jsonInput = this.jsonInput;

    if (!(jsonInput instanceof HTMLInputElement)) {
      return;
    }

    const configuration = {
      schemaVersion: 1,
      personalizationId: this.personalizationId,
      productId: this.root.dataset.productId || '',
      selections: selections
        .filter((selection) => selection.optionId !== '')
        .map((selection) => ({
          groupId: selection.groupId,
          optionId: selection.optionId
        }))
    };

    jsonInput.value = JSON.stringify(configuration);
  }

  /**
   * @returns {void}
   */
  update() {
    const selections = this.getSelections();

    this.updatePreview(selections);
    this.updateSummary(selections);
    this.updateJson(selections);
  }
}

/**
 * @param {ParentNode} [scope=document]
 * @returns {void}
 */
function initializeProductPersonalizers(scope = document) {
  scope
    .querySelectorAll(
      '[data-product-personalizer]:not([data-initialized])'
    )
    .forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }

      new ProductPersonalizer(element);
    });
}

document.addEventListener('DOMContentLoaded', () => {
  initializeProductPersonalizers(document);
});

document.addEventListener(
  'shopify:section:load',
  (event) => {
    const target = event.target;

    if (target instanceof HTMLElement) {
      initializeProductPersonalizers(target);
      return;
    }

    initializeProductPersonalizers(document);
  }
);