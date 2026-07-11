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
    if (!previewModel || !Array.isArray(previewModel.layers) || !previewModel.layers.length) return;

    const frame = this.querySelector("[data-customization-preview-frame]");
    if (!frame) return;

    const currentImage = frame.querySelector(".cart-items__custom-preview-canvas");
    if (currentImage?.dataset.previewKey === payloadKey) {
      this.dataset.rendered = "ready";
      return;
    }

    if (CartCustomizationPreview.previewCache.has(payloadKey)) {
      this.#renderPreviewImage(frame, CartCustomizationPreview.previewCache.get(payloadKey), payloadKey);
      return;
    }

    const size = 320;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext("2d");
    context.fillStyle = previewModel.background || "#ffffff";
    context.fillRect(0, 0, size, size);

    const textLayers = previewModel.layers.filter((layer) => layer.type === "text");
    await Promise.all(textLayers.map((layer) => this.#ensureFont(layer)));

    for (const layer of previewModel.layers) {
      if (layer.type === "image") {
        const image = await this.#loadImage(layer.src);
        const rect = this.#ratioRect(layer.rect, size);
        context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
        continue;
      }
      if (layer.type === "clipped-image") {
        const image = await this.#loadImage(layer.src);
        const clipRect = this.#ratioRect(layer.clipRect, size);
        const imageRect = this.#ratioRect(layer.imageRect, size);
        context.save();
        context.beginPath();
        context.rect(clipRect.x, clipRect.y, clipRect.width, clipRect.height);
        context.clip();
        context.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
        context.restore();
        continue;
      }
      if (layer.type === "text") {
        const rect = this.#ratioRect(layer.rect, size);
        const lines = String(layer.text || "").split(/\r?\n/);
        const fontSize = Math.max(10, (Number(layer.fontSizeRatio) || 0.05) * size);
        const lineHeight = Math.max(fontSize * 1.18, (Number(layer.lineHeightRatio) || 0.06) * size);
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

    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    CartCustomizationPreview.previewCache.set(payloadKey, dataUrl);
    this.#renderPreviewImage(frame, dataUrl, payloadKey);
  }
}

if (!customElements.get("cart-customization-preview")) {
  customElements.define("cart-customization-preview", CartCustomizationPreview);
}
