class CartCustomizationPreview extends HTMLElement {
  static imageCache = new Map();
  static fontCache = new Set();
  static previewCache = new Map();

  #mutationObserver = null;
  #renderQueued = false;

  connectedCallback() {
    if (!this.#mutationObserver) {
      this.#mutationObserver = new MutationObserver(() => this.#scheduleRender());
      this.#mutationObserver.observe(this, { childList: true, subtree: true, characterData: true });
    }
    if (!this.dataset.zoomBound) {
      this.dataset.zoomBound = "true";
      this.addEventListener("click", (event) => {
        const button = event.target.closest("[data-customization-preview-zoom]");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        this.#openLightbox().catch((error) => {
          console.warn("[cart-customization-preview] lightbox failed", error);
        });
      });
    }
    this.#scheduleRender();
  }

  disconnectedCallback() {
    this.#mutationObserver?.disconnect();
    this.#mutationObserver = null;
  }

  #decodePayload() {
    const script = this.querySelector('script[type="application/json"][data-customization-payload]');
    if (!script) return null;
    const encoded = JSON.parse(script.textContent || '""');
    if (!encoded) return null;
    return JSON.parse(decodeURIComponent(escape(atob(encoded))));
  }

  #payloadKey() {
    const script = this.querySelector('script[type="application/json"][data-customization-payload]');
    return script?.textContent || "";
  }

  async #ensureFont(layer) {
    const key = `${layer.fontFamily || ""}|${layer.fontUrl || ""}|${layer.fontType || ""}`;
    if (!key || CartCustomizationPreview.fontCache.has(key)) return;
    CartCustomizationPreview.fontCache.add(key);
    if (layer.fontUrl && "FontFace" in window) {
      try {
        const face = new FontFace(layer.fontFamily || "Arial", `url(${JSON.stringify(layer.fontUrl).slice(1, -1)})`);
        const loaded = await face.load();
        document.fonts.add(loaded);
      } catch {}
      return;
    }
    if (/googlefont/i.test(layer.fontType || "") && layer.fontFamily) {
      const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(layer.fontFamily).replace(/%20/g, "+")}&display=swap`;
      if (![...document.querySelectorAll("link[href]")].some((link) => link.href === href)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        document.head.appendChild(link);
      }
    }
  }

  async #loadImage(url) {
    const key = String(url || "");
    if (!key) throw new Error("Missing customization preview image.");
    if (!CartCustomizationPreview.imageCache.has(key)) {
      CartCustomizationPreview.imageCache.set(key, new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = key;
      }).catch((error) => {
        CartCustomizationPreview.imageCache.delete(key);
        throw error;
      }));
    }
    return CartCustomizationPreview.imageCache.get(key);
  }

  #ratioRect(rect, size) {
    return {
      x: rect.x * size,
      y: rect.y * size,
      width: rect.width * size,
      height: rect.height * size,
    };
  }

  #renderPreviewImage(frame, dataUrl, payloadKey) {
    const image = document.createElement("img");
    image.className = "cart-items__custom-preview-canvas";
    image.alt = "";
    image.src = dataUrl;
    image.dataset.previewKey = payloadKey;
    frame.replaceChildren(image);
    this.dataset.rendered = "ready";
  }

  #renderFallbackImage(frame, payloadKey = "") {
    const fallbackSrc = this.dataset.fallbackSrc || this.dataset.zoomSrc || "";
    if (!fallbackSrc) {
      this.dataset.rendered = "error";
      return false;
    }
    const image = document.createElement("img");
    image.className = "cart-items__custom-preview-canvas cart-items__custom-preview-canvas--fallback";
    image.alt = "";
    image.src = fallbackSrc;
    image.dataset.previewKey = payloadKey;
    frame.replaceChildren(image);
    this.dataset.rendered = "ready";
    return true;
  }

  #shouldUseGeneratedPreview(previewModel) {
    const layers = previewModel?.layers;
    if (!Array.isArray(layers) || !layers.length) return false;

    let imageLayerCount = 0;

    for (const layer of layers) {
      if (layer?.type === "text" || layer?.type === "clipped-image") {
        return true;
      }

      if (layer?.type === "image") {
        imageLayerCount += 1;
      }
    }

    return imageLayerCount > 1;
  }

  #ensureLightbox(host = document.body) {
    let lightbox = host.querySelector(".cart-items__preview-lightbox");
    if (lightbox) return lightbox;
    lightbox = document.createElement("div");
    lightbox.className = "cart-items__preview-lightbox";
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("aria-label", "Image preview");
    lightbox.innerHTML = `
      <div class="cart-items__preview-lightbox-dialog">
        <button type="button" class="cart-items__preview-lightbox-close" aria-label="Close preview">&times;</button>
        <img class="cart-items__preview-lightbox-image" alt="">
      </div>
    `;
    host.appendChild(lightbox);
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox || event.target.closest(".cart-items__preview-lightbox-close")) {
        closeCartPreviewLightbox();
      }
    });
    return lightbox;
  }

  async #renderPreviewDataUrl(previewModel, size, quality = 0.86) {
    const width = Math.max(1, Math.round(previewModel.width || size));
    const height = Math.max(1, Math.round(previewModel.height || size));
    const aspect = height / width;
    const canvasWidth = size;
    const canvasHeight = Math.max(1, Math.round(size * aspect));

    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const context = canvas.getContext("2d");
    context.fillStyle = previewModel.background || "#ffffff";
    context.fillRect(0, 0, canvasWidth, canvasHeight);

    const textLayers = previewModel.layers.filter((layer) => layer.type === "text");
    await Promise.all(textLayers.map((layer) => this.#ensureFont(layer)));

    for (const layer of previewModel.layers) {
      if (layer.type === "image") {
        const image = await this.#loadImage(layer.src);
        const rect = this.#ratioRect(layer.rect, canvasWidth);
        rect.y = layer.rect.y * canvasHeight;
        rect.height = layer.rect.height * canvasHeight;
        context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
        continue;
      }
      if (layer.type === "clipped-image") {
        const image = await this.#loadImage(layer.src);
        const clipRect = {
          x: layer.clipRect.x * canvasWidth,
          y: layer.clipRect.y * canvasHeight,
          width: layer.clipRect.width * canvasWidth,
          height: layer.clipRect.height * canvasHeight,
        };
        const imageRect = {
          x: layer.imageRect.x * canvasWidth,
          y: layer.imageRect.y * canvasHeight,
          width: layer.imageRect.width * canvasWidth,
          height: layer.imageRect.height * canvasHeight,
        };
        context.save();
        context.beginPath();
        context.rect(clipRect.x, clipRect.y, clipRect.width, clipRect.height);
        context.clip();
        context.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
        context.restore();
        continue;
      }
      if (layer.type === "text") {
        const rect = {
          x: layer.rect.x * canvasWidth,
          y: layer.rect.y * canvasHeight,
          width: layer.rect.width * canvasWidth,
          height: layer.rect.height * canvasHeight,
        };
        const lines = String(layer.text || "").split(/\r?\n/);
        const fontSize = Math.max(10, (Number(layer.fontSizeRatio) || 0.05) * canvasWidth);
        const lineHeight = Math.max(fontSize * 1.18, (Number(layer.lineHeightRatio) || 0.06) * canvasHeight);
        context.save();
        context.fillStyle = layer.color || "#000000";
        context.font = `${fontSize}px "${String(layer.fontFamily || "Arial").replace(/"/g, '\\"')}", Arial, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        if (layer.singleLine) {
          context.fillText(lines.join(" ").replace(/\s+/g, " "), rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width);
        } else {
          lines.forEach((line, index) => {
            context.fillText(line, rect.x + rect.width / 2, rect.y + rect.height / 2 + (index - (lines.length - 1) / 2) * lineHeight, rect.width);
          });
        }
        context.restore();
      }
    }

    return canvas.toDataURL("image/jpeg", quality);
  }

  async #openLightbox() {
    const host = this.closest("dialog") || document.body;
    const lightbox = this.#ensureLightbox(host);
    const image = lightbox.querySelector(".cart-items__preview-lightbox-image");
    const fallbackSrc = this.dataset.zoomSrc || this.dataset.fallbackSrc || "";
    const previewModel = this.#decodePayload()?.previewModel;
    image.alt = "Customization preview";
    image.src = fallbackSrc;
    lightbox.classList.add("is-open");
    document.documentElement.classList.add("cart-preview-lightbox-open");
    lightbox.querySelector(".cart-items__preview-lightbox-close")?.focus({ preventScroll: true });

    if (this.#shouldUseGeneratedPreview(previewModel)) {
      const targetSize = Math.min(1600, Math.max(900, Math.round(window.innerWidth * (window.devicePixelRatio || 1))));
      image.src = await this.#renderPreviewDataUrl(previewModel, targetSize, 0.96);
    }
  }

  #scheduleRender() {
    if (this.#renderQueued) return;
    this.#renderQueued = true;
    requestAnimationFrame(() => {
      this.#renderQueued = false;
      this.#render().catch((error) => {
        console.warn("[cart-customization-preview] render failed", error);
        this.dataset.rendered = "error";
      });
    });
  }

  async #render() {
    const payloadKey = this.#payloadKey();
    const payload = this.#decodePayload();
    const previewModel = payload && payload.previewModel;
    const frame = this.querySelector("[data-customization-preview-frame]");
    if (!frame) return;

    if (!this.#shouldUseGeneratedPreview(previewModel)) {
      this.#renderFallbackImage(frame, payloadKey);
      return;
    }

    const currentImage = frame.querySelector(".cart-items__custom-preview-canvas");
    if (currentImage?.dataset.previewKey === payloadKey) {
      this.dataset.rendered = "ready";
      return;
    }

    if (CartCustomizationPreview.previewCache.has(payloadKey)) {
      this.#renderPreviewImage(frame, CartCustomizationPreview.previewCache.get(payloadKey), payloadKey);
      return;
    }

    try {
      const dataUrl = await this.#renderPreviewDataUrl(previewModel, 320, 0.86);
      CartCustomizationPreview.previewCache.set(payloadKey, dataUrl);
      this.#renderPreviewImage(frame, dataUrl, payloadKey);
    } catch (error) {
      console.warn("[cart-customization-preview] preview render failed, using fallback image", error);
      this.#renderFallbackImage(frame, payloadKey);
    }
  }
}

if (!customElements.get("cart-customization-preview")) {
  customElements.define("cart-customization-preview", CartCustomizationPreview);
}

function ensureCartPreviewLightboxBindings() {
  if (document.documentElement.dataset.cartPreviewLightboxBound === "true") return;
  document.documentElement.dataset.cartPreviewLightboxBound = "true";

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cart-image-zoom]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const src = button.getAttribute("data-zoom-src");
    if (!src) return;
    const host = button.closest("dialog") || document.body;
    let lightbox = host.querySelector(".cart-items__preview-lightbox");
    if (!lightbox) {
      lightbox = document.createElement("div");
      lightbox.className = "cart-items__preview-lightbox";
      lightbox.setAttribute("role", "dialog");
      lightbox.setAttribute("aria-modal", "true");
      lightbox.setAttribute("aria-label", "Image preview");
      lightbox.innerHTML = `
        <div class="cart-items__preview-lightbox-dialog">
          <button type="button" class="cart-items__preview-lightbox-close" aria-label="Close preview">&times;</button>
          <img class="cart-items__preview-lightbox-image" alt="">
        </div>
      `;
      host.appendChild(lightbox);
      lightbox.addEventListener("click", (closeEvent) => {
        if (closeEvent.target === lightbox || closeEvent.target.closest(".cart-items__preview-lightbox-close")) {
          closeCartPreviewLightbox();
        }
      });
    }
    const image = lightbox.querySelector(".cart-items__preview-lightbox-image");
    image.src = src;
    image.alt = button.getAttribute("aria-label") || "Image preview";
    lightbox.classList.add("is-open");
    document.documentElement.classList.add("cart-preview-lightbox-open");
    lightbox.querySelector(".cart-items__preview-lightbox-close")?.focus({ preventScroll: true });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCartPreviewLightbox();
  });
}

function closeCartPreviewLightbox() {
  document.querySelectorAll(".cart-items__preview-lightbox.is-open").forEach((lightbox) => {
    lightbox.classList.remove("is-open");
  });
  document.documentElement.classList.remove("cart-preview-lightbox-open");
}

ensureCartPreviewLightboxBindings();
