/**
 * @typedef {Object} PersonalizationFieldValue
 * @property {string} fieldId
 * @property {string} propertyName
 * @property {string} type
 * @property {string} previewKey
 * @property {string} [value]
 * @property {string} [label]
 * @property {string} [cssFamily]
 * @property {string} [layerImage]
 * @property {string} [fileName]
 * @property {string} [fileType]
 * @property {number} [fileSize]
 */

class ProductPersonalizer {
  /**
   * @param {HTMLElement} root
   */
  constructor(root) {
    this.root = root;
    this.fields = this.#getElements('[data-personalizer-field]');
    this.jsonInput = this.#getInput('[data-personalization-json-input]');
    this.idInput = this.#getInput('[data-personalization-id-input]');
    this.summary = this.#getElement('[data-personalization-properties]');
    this.errors = this.#getElement('[data-personalizer-errors]');
    this.form = /** @type {HTMLFormElement | null} */ (root.closest('form'));
    this.personalizationId = '';
    this.objectUrls = new Map();

    if (!this.jsonInput || !this.idInput || !this.fields.length) {
      return;
    }

    this.personalizationId = this.idInput.value || this.createId();
    this.idInput.value = this.personalizationId;

    this.bindEvents();
    this.ensureDefaults();
    this.update();

    this.root.dataset.initialized = 'true';
  }

  /**
   * @param {string} selector
   * @returns {HTMLElement[]}
   */
  #getElements(selector) {
    return [...this.root.querySelectorAll(selector)].filter(
      /**
       * @param {Element} element
       * @returns {element is HTMLElement}
       */
      (element) => element instanceof HTMLElement
    );
  }

  /**
   * @param {string} selector
   * @returns {HTMLElement | null}
   */
  #getElement(selector) {
    const element = this.root.querySelector(selector);
    return element instanceof HTMLElement ? element : null;
  }

  /**
   * @param {string} selector
   * @returns {HTMLInputElement | null}
   */
  #getInput(selector) {
    const input = this.root.querySelector(selector);
    return input instanceof HTMLInputElement ? input : null;
  }

  /**
   * @returns {string}
   */
  createId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }

    return `pers_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  /**
   * @returns {void}
   */
  bindEvents() {
    this.root.addEventListener('click', this.handleClick);
    this.root.addEventListener('change', this.handleChange);
    this.root.addEventListener('input', this.handleInput);

    this.form?.addEventListener('click', this.handleFormClick, true);
    this.form?.addEventListener('submit', this.handleSubmit, true);
  }

  /**
   * @param {Event} event
   * @returns {void}
   */
  handleClick = (event) => {
    const target = event.target;

    if (!(target instanceof HTMLInputElement) || target.type !== 'radio') {
      return;
    }

    const fieldset = target.closest('[data-selection-kind]');

    if (!(fieldset instanceof HTMLElement)) {
      return;
    }

    const isRequired = fieldset.dataset.required === 'true';
    const wasChecked = target.dataset.wasChecked === 'true';

    if (wasChecked && !isRequired) {
      event.preventDefault();
      target.checked = false;
      target.dataset.wasChecked = 'false';
      this.update();
      return;
    }

    if (wasChecked && isRequired) {
      target.checked = true;
      return;
    }

    if (target.name) {
      const radios = this.root.querySelectorAll(`input[type="radio"][name="${CSS.escape(target.name)}"]`);
      radios.forEach((radio) => {
        if (radio instanceof HTMLInputElement) {
          radio.dataset.wasChecked = radio === target ? 'true' : 'false';
        }
      });
    }

    this.update();
  };

  /**
   * @param {Event} event
   * @returns {void}
   */
  handleChange = (event) => {
    const target = event.target;

    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return;
    }

    if (target.matches('[data-personalizer-input]')) {
      this.validateField(target.closest('[data-personalizer-field]'));
      this.update();
    }
  };

  /**
   * @param {Event} event
   * @returns {void}
   */
  handleInput = (event) => {
    const target = event.target;

    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return;
    }

    if (target.matches('[data-personalizer-input]')) {
      this.validateField(target.closest('[data-personalizer-field]'));
      this.update();
    }
  };

  /**
   * @param {Event} event
   * @returns {void}
   */
  handleSubmit = (event) => {
    if (!this.validateAll({ focusFirstError: true })) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  /**
   * @param {Event} event
   * @returns {void}
   */
  handleFormClick = (event) => {
    const target = event.target;
    const submitButton = target instanceof HTMLElement ? target.closest('button[type="submit"], input[type="submit"]') : null;

    if (!(submitButton instanceof HTMLElement)) {
      return;
    }

    if (!this.validateAll({ focusFirstError: true })) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  /**
   * @returns {void}
   */
  ensureDefaults() {
    this.fields.forEach((field) => {
      const type = field.dataset.fieldType || '';

      if (type === 'font' || type === 'option') {
        this.ensureRadioDefault(field, '.personalizer-choice__input');
      }

      const colorInput = field.querySelector('input[type="color"]');
      if (colorInput instanceof HTMLInputElement) {
        this.syncColorValue(field, colorInput.value);
      }
    });
  }

  /**
   * @param {HTMLElement} container
   * @param {string} selector
   * @returns {void}
   */
  ensureRadioDefault(container, selector) {
    const checked = container.querySelector(`${selector}:checked`);

    if (checked instanceof HTMLInputElement) {
      checked.dataset.wasChecked = 'true';
      return;
    }

    const isRequired = container.dataset.required === 'true';
    const first = container.querySelector(selector);

    if (isRequired && first instanceof HTMLInputElement) {
      first.checked = true;
      first.dataset.wasChecked = 'true';
    }
  }

  /**
   * @returns {PersonalizationFieldValue[]}
   */
  getFieldValues() {
    return this.fields
      .map((field) => this.getFieldValue(field))
      .filter(
        /**
         * @param {PersonalizationFieldValue | null} value
         * @returns {value is PersonalizationFieldValue}
         */
        (value) => value !== null
      );
  }

  /**
   * @param {HTMLElement} field
   * @returns {PersonalizationFieldValue | null}
   */
  getFieldValue(field) {
    const fieldId = field.dataset.fieldId || '';
    const propertyName = field.dataset.propertyName || '';
    const type = field.dataset.fieldType || '';
    const previewKey = field.dataset.previewKey || '';

    if (!fieldId || !propertyName || !type) {
      return null;
    }

    if (type === 'font' || type === 'option') {
      const checked = field.querySelector('input[type="radio"]:checked');
      if (!(checked instanceof HTMLInputElement) || checked.value === '') {
        return null;
      }

      const technicalValue = checked.dataset.optionValue || checked.value;
      const label = checked.dataset.optionLabel || checked.value;

      return {
        fieldId,
        propertyName,
        type,
        previewKey,
        value: technicalValue,
        label: label,
        cssFamily: checked.dataset.optionCssFamily || '',
        layerImage: checked.dataset.layerImage || ''
      };
    }

    const input = field.querySelector('[data-personalizer-input]');

    if (input instanceof HTMLInputElement) {
      if (input.type === 'file') {
        const file = input.files?.[0];

        if (!file) {
          return null;
        }

        return {
          fieldId,
          propertyName,
          type,
          previewKey,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size
        };
      }

      if (input.value === '') {
        return null;
      }

      return {
        fieldId,
        propertyName,
        type,
        previewKey,
        value: input.value
      };
    }

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) {
      if (input.value === '') {
        return null;
      }

      return {
        fieldId,
        propertyName,
        type,
        previewKey,
        value: input.value
      };
    }

    return null;
  }

  /**
   * @param {{ focusFirstError?: boolean }} [options]
   * @returns {boolean}
   */
  validateAll(options = {}) {
    const containers = [...this.fields];
    let firstInvalid = null;
    let isValid = true;

    containers.forEach((container) => {
      const valid = this.validateField(container);

      if (!valid && !firstInvalid) {
        firstInvalid = container;
      }

      isValid = isValid && valid;
    });

    if (this.errors instanceof HTMLElement) {
      this.errors.hidden = isValid;
      this.errors.textContent = isValid ? '' : 'Please complete the required personalization fields before adding to cart.';
    }

    if (!isValid && options.focusFirstError && firstInvalid instanceof HTMLElement) {
      const focusTarget = firstInvalid.querySelector('[data-personalizer-input], input, textarea, select, button, label');

      if (focusTarget instanceof HTMLElement) {
        focusTarget.focus();
      } else {
        firstInvalid.focus();
      }
    }

    return isValid;
  }

  /**
   * @param {Element | null} container
   * @returns {boolean}
   */
  validateField(container) {
    if (!(container instanceof HTMLElement)) {
      return true;
    }

    if (!container.hasAttribute('data-personalizer-field')) {
      return true;
    }

    const error = this.getErrorContainer(container);
    const fieldType = container.dataset.fieldType || '';
    const required = container.dataset.required === 'true';
    const input = container.querySelector('[data-personalizer-input]');

    if (fieldType === 'font' || fieldType === 'option') {
      const checked = container.querySelector('input[type="radio"]:checked');

      if (required && !(checked instanceof HTMLInputElement)) {
        this.setError(container, 'Please choose an option.');
        return false;
      }

      this.clearError(container, error);
      return true;
    }

    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) {
      this.clearError(container, error);
      return true;
    }

    if (input instanceof HTMLInputElement && input.type === 'file') {
      const file = input.files?.[0];
      const accept = container.dataset.accept || '';
      const maxFileSizeMb = Number(container.dataset.maxFileSizeMb || 0);

      if (required && !file) {
        this.setError(container, 'Please upload a file.');
        return false;
      }

      if (!file) {
        this.clearError(container, error);
        return true;
      }

      if (accept && !this.fileMatchesAccept(file, accept)) {
        this.setError(container, 'This file type is not supported for this field.');
        return false;
      }

      if (maxFileSizeMb > 0 && file.size > maxFileSizeMb * 1024 * 1024) {
        this.setError(container, `File must be ${maxFileSizeMb} MB or smaller.`);
        return false;
      }

      this.clearError(container, error);
      return true;
    }

    const value = input.value.trim();
    const minLength = Number(container.dataset.minLength || 0);
    const maxLength = Number(container.dataset.maxLength || 0);

    if (required && value === '') {
      this.setError(container, 'This field is required.');
      return false;
    }

    if (value !== '' && minLength > 0 && value.length < minLength) {
      this.setError(container, `Please enter at least ${minLength} characters.`);
      return false;
    }

    if (value !== '' && maxLength > 0 && value.length > maxLength) {
      this.setError(container, `Please keep this field under ${maxLength} characters.`);
      return false;
    }

    this.clearError(container, error);
    return true;
  }

  /**
   * @param {HTMLElement} container
   * @returns {HTMLElement | null}
   */
  getErrorContainer(container) {
    const error = container.querySelector('[data-personalizer-error]');
    return error instanceof HTMLElement ? error : null;
  }

  /**
   * @param {HTMLElement} container
   * @param {string} message
   * @returns {void}
   */
  setError(container, message) {
    container.dataset.invalid = 'true';
    const error = this.getErrorContainer(container);

    if (error instanceof HTMLElement) {
      error.hidden = false;
      error.textContent = message;
    }
  }

  /**
   * @param {HTMLElement} container
   * @param {HTMLElement | null} error
   * @returns {void}
   */
  clearError(container, error) {
    delete container.dataset.invalid;

    if (error instanceof HTMLElement) {
      error.hidden = true;
      error.textContent = '';
    }
  }

  /**
   * @param {File} file
   * @param {string} accept
   * @returns {boolean}
   */
  fileMatchesAccept(file, accept) {
    const tokens = accept
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);

    if (!tokens.length) {
      return true;
    }

    const fileName = file.name.toLowerCase();
    const mimeType = (file.type || '').toLowerCase();

    return tokens.some((token) => {
      if (token === '*/*') {
        return true;
      }

      if (token.endsWith('/*')) {
        const prefix = token.slice(0, -1);
        return mimeType.startsWith(prefix);
      }

      if (token.startsWith('.')) {
        return fileName.endsWith(token);
      }

      return mimeType === token;
    });
  }

  /**
   * @param {PersonalizationFieldValue[]} values
   * @returns {void}
   */
  updateDynamicPreview(values) {
    const previews = this.getPreviewRoots();

    previews.forEach((preview) => {
      preview.querySelectorAll('[data-preview-text]').forEach((node) => {
        if (node instanceof HTMLElement) {
          node.hidden = true;
          node.textContent = '';
          node.style.fontFamily = '';
          node.style.color = '';
        }
      });

      preview.querySelectorAll('[data-preview-upload]').forEach((node) => {
        if (node instanceof HTMLImageElement) {
          node.hidden = true;
          node.removeAttribute('src');
        }
      });

      preview.querySelectorAll('[data-preview-layer]').forEach((node) => {
        if (node instanceof HTMLImageElement) {
          node.hidden = true;
          node.removeAttribute('src');
        }
      });
    });

    values.forEach((fieldValue) => {
      if (!fieldValue.previewKey && fieldValue.type !== 'font' && fieldValue.type !== 'color') {
        return;
      }

      previews.forEach((preview) => {
        if (fieldValue.type === 'image') {
          const image = this.root.querySelector(
            `[data-personalizer-field][data-field-id="${CSS.escape(fieldValue.fieldId)}"] input[type="file"]`
          );
          const fileInput = image instanceof HTMLInputElement ? image : null;
          const file = fileInput?.files?.[0];
          const objectUrl = file ? this.getObjectUrl(fieldValue.fieldId, file) : '';

          preview
            .querySelectorAll(`[data-preview-upload="${CSS.escape(fieldValue.previewKey)}"]`)
            .forEach((layer) => {
              if (!(layer instanceof HTMLImageElement)) {
                return;
              }

              if (!objectUrl) {
                layer.hidden = true;
                layer.removeAttribute('src');
                return;
              }

              layer.src = objectUrl;
              layer.hidden = false;
            });

          return;
        }

        if (fieldValue.type === 'text' || fieldValue.type === 'textarea') {
          preview
            .querySelectorAll(`[data-preview-text="${CSS.escape(fieldValue.previewKey)}"]`)
            .forEach((layer) => {
              if (!(layer instanceof HTMLElement)) {
                return;
              }

              layer.textContent = fieldValue.value || '';
              layer.hidden = !fieldValue.value;
            });

          return;
        }

        if (fieldValue.type === 'option' && fieldValue.previewKey) {
          preview
            .querySelectorAll(`[data-preview-layer="${CSS.escape(fieldValue.previewKey)}"]`)
            .forEach((layer) => {
              if (!(layer instanceof HTMLImageElement)) {
                return;
              }

              if (!fieldValue.layerImage) {
                layer.hidden = true;
                layer.removeAttribute('src');
                return;
              }

              layer.src = fieldValue.layerImage;
              layer.hidden = false;
            });

          return;
        }

        if (fieldValue.type === 'font') {
          this.getPreviewTextTargets(preview, fieldValue.previewKey).forEach((layer) => {
            layer.style.fontFamily = fieldValue.cssFamily || '';
          });

          return;
        }

        if (fieldValue.type === 'color') {
          this.getPreviewTextTargets(preview, fieldValue.previewKey).forEach((layer) => {
            layer.style.color = fieldValue.value || '';
          });
        }
      });
    });
  }

  /**
   * @returns {HTMLElement[]}
   */
  getPreviewRoots() {
    const productId = this.root.dataset.productId;

    if (!productId) {
      return [];
    }

    return [...document.querySelectorAll(`[data-personalizer-preview="${CSS.escape(productId)}"]`)].filter(
      /**
       * @param {Element} preview
       * @returns {preview is HTMLElement}
       */
      (preview) => preview instanceof HTMLElement
    );
  }

  /**
   * @param {HTMLElement} preview
   * @param {string} previewKey
   * @returns {HTMLElement[]}
   */
  getPreviewTextTargets(preview, previewKey) {
    const allTargets = [...preview.querySelectorAll('[data-preview-text]')].filter(
      /**
       * @param {Element} node
       * @returns {node is HTMLElement}
       */
      (node) => node instanceof HTMLElement
    );

    if (!previewKey) {
      return allTargets;
    }

    const matchedTargets = allTargets.filter((node) => node.dataset.previewText === previewKey);

    return matchedTargets.length ? matchedTargets : allTargets;
  }

  /**
   * @param {string} fieldId
   * @param {File} file
   * @returns {string}
   */
  getObjectUrl(fieldId, file) {
    const existing = this.objectUrls.get(fieldId);

    if (existing?.name === file.name && existing.size === file.size && existing.type === file.type) {
      return existing.url;
    }

    if (existing?.url) {
      URL.revokeObjectURL(existing.url);
    }

    const url = URL.createObjectURL(file);
    this.objectUrls.set(fieldId, {
      url,
      name: file.name,
      size: file.size,
      type: file.type
    });

    return url;
  }

  /**
   * @param {PersonalizationFieldValue[]} fieldValues
   * @returns {void}
   */
  updateFieldUi(fieldValues) {
    this.fields.forEach((field) => {
      const fieldId = field.dataset.fieldId || '';
      const fieldType = field.dataset.fieldType || '';
      const input = field.querySelector('[data-personalizer-input]');

      if (fieldType === 'image' || fieldType === 'file') {
        const fileNameNode = field.querySelector('[data-personalizer-file-name]');
        const preview = field.querySelector('[data-personalizer-upload-preview]');
        const previewImage = field.querySelector('[data-upload-preview-image]');
        const fileInput = input instanceof HTMLInputElement ? input : null;
        const file = fileInput?.files?.[0];

        if (fileNameNode instanceof HTMLElement) {
          fileNameNode.textContent = file ? file.name : 'No file selected';
        }

        if (preview instanceof HTMLElement) {
          const isImage = fieldType === 'image' && !!file;
          preview.hidden = !isImage;

          if (previewImage instanceof HTMLImageElement) {
            if (isImage && file) {
              previewImage.src = this.getObjectUrl(fieldId, file);
              previewImage.hidden = false;
            } else {
              previewImage.hidden = true;
              previewImage.removeAttribute('src');
            }
          }
        }
      }

      if (fieldType === 'color' && input instanceof HTMLInputElement) {
        this.syncColorValue(field, input.value);
      }
    });

    this.updateSummaryMarkup(fieldValues);
  }

  /**
   * @param {HTMLElement} field
   * @param {string} value
   * @returns {void}
   */
  syncColorValue(field, value) {
    const swatch = field.querySelector('.personalizer-color__swatch');
    const label = field.querySelector('[data-color-value]');

    if (swatch instanceof HTMLElement) {
      swatch.style.setProperty('--personalizer-color', value);
    }

    if (label instanceof HTMLElement) {
      label.textContent = value.toUpperCase();
    }
  }

  /**
   * @param {PersonalizationFieldValue[]} fieldValues
   * @returns {void}
   */
  updateSummaryMarkup(fieldValues) {
    if (!(this.summary instanceof HTMLElement)) {
      return;
    }

    this.summary.querySelectorAll('[data-personalizer-summary-row]').forEach((node) => node.remove());

    const summaryRows = [];

    fieldValues.forEach((fieldValue) => {
      if (fieldValue.type === 'file' || fieldValue.type === 'image') {
        summaryRows.push({
          label: fieldValue.propertyName,
          value: fieldValue.fileName || 'Uploaded file'
        });
        return;
      }

      if (fieldValue.type === 'font' || fieldValue.type === 'option') {
        if (fieldValue.value || fieldValue.label) {
          summaryRows.push({
            label: fieldValue.propertyName,
            value: fieldValue.label || fieldValue.value
          });
        }
        return;
      }

      if (fieldValue.value) {
        summaryRows.push({
          label: fieldValue.propertyName,
          value: fieldValue.value
        });
      }
    });

    summaryRows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'product-personalizer__summary-item';
      item.setAttribute('data-personalizer-summary-row', '');
      item.innerHTML = `<strong>${this.escapeHtml(row.label)}:</strong> <span>${this.escapeHtml(row.value)}</span>`;
      this.summary.appendChild(item);
    });
  }

  /**
   * @param {string} value
   * @returns {string}
   */
  escapeHtml(value) {
    const span = document.createElement('span');
    span.textContent = value;
    return span.innerHTML;
  }

  /**
   * @param {PersonalizationFieldValue[]} fieldValues
   * @returns {void}
   */
  updateJson(fieldValues) {
    if (!(this.jsonInput instanceof HTMLInputElement)) {
      return;
    }

    const payload = {
      schemaVersion: 2,
      personalizationId: this.personalizationId,
      productId: this.root.dataset.productId || '',
      groups: [],
      fields: fieldValues.map((fieldValue) => {
        if (fieldValue.type === 'file' || fieldValue.type === 'image') {
          return {
            fieldId: fieldValue.fieldId,
            propertyName: fieldValue.propertyName,
            type: fieldValue.type,
            previewKey: fieldValue.previewKey,
            fileName: fieldValue.fileName || '',
            fileType: fieldValue.fileType || '',
            fileSize: fieldValue.fileSize || 0
          };
        }

        return {
          fieldId: fieldValue.fieldId,
          propertyName: fieldValue.propertyName,
          type: fieldValue.type,
          previewKey: fieldValue.previewKey,
          value: fieldValue.value || '',
          label: fieldValue.label || '',
          cssFamily: fieldValue.cssFamily || ''
        };
      })
    };

    this.jsonInput.value = JSON.stringify(payload);
  }

  /**
   * @returns {void}
   */
  update() {
    const fieldValues = this.getFieldValues();

    this.updateDynamicPreview(fieldValues);
    this.updateFieldUi(fieldValues);
    this.updateJson(fieldValues);
  }
}

/**
 * @param {ParentNode} [scope=document]
 * @returns {void}
 */
function initializeProductPersonalizers(scope = document) {
  scope
    .querySelectorAll('[data-product-personalizer]:not([data-initialized])')
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

document.addEventListener('shopify:section:load', (event) => {
  const target = event.target;

  if (target instanceof HTMLElement) {
    initializeProductPersonalizers(target);
    return;
  }

  initializeProductPersonalizers(document);
});
