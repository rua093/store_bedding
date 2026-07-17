const SECTION_SELECTOR = '[data-new-arrivals-line-section]';
const VIEWPORT_SELECTOR = '[data-new-arrivals-line-viewport]';
const TRACK_SELECTOR = '[data-new-arrivals-line-track]';
const ITEM_SELECTOR = '[data-new-arrivals-line-item]';
const DOTS_SELECTOR = '[data-new-arrivals-strip-dots]';

const sectionStore = window.__newArrivalsLineCarouselStore || (window.__newArrivalsLineCarouselStore = new Map());

function getSectionSelectorById(id) {
  return `[data-new-arrivals-line-section="${id}"]`;
}

function getSectionRoot(id, scope = document) {
  const sectionSelector = getSectionSelectorById(id);

  if (scope?.matches?.(sectionSelector)) {
    return scope;
  }

  return scope?.querySelector?.(sectionSelector) || document.querySelector(sectionSelector);
}

function findSectionRootFromScope(scope) {
  if (!scope) return null;
  if (scope.matches?.(SECTION_SELECTOR)) return scope;
  return scope.querySelector?.(SECTION_SELECTOR) || null;
}

function destroySection(id) {
  const cleanup = sectionStore.get(id);
  if (typeof cleanup === 'function') {
    cleanup();
  }
  sectionStore.delete(id);
}

function loadEmbla() {
  if (window.EmblaCarousel) {
    return Promise.resolve(window.EmblaCarousel);
  }

  if (window.__newArrivalsEmblaPromise) {
    return window.__newArrivalsEmblaPromise;
  }

  window.__newArrivalsEmblaPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/embla-carousel/embla-carousel.umd.js';
    script.async = true;
    script.onload = () => resolve(window.EmblaCarousel);
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return window.__newArrivalsEmblaPromise;
}

function initSection(id, scope) {
  destroySection(id);

  const root = getSectionRoot(id, scope);
  if (!root) return;

  const viewport = root.querySelector(VIEWPORT_SELECTOR);
  const track = root.querySelector(TRACK_SELECTOR);
  const items = Array.from(root.querySelectorAll(ITEM_SELECTOR));
  if (!viewport || !track || items.length === 0) return;

  const prevButton = root.querySelector('[data-new-arrivals-line-prev]');
  const nextButton = root.querySelector('[data-new-arrivals-line-next]');
  const dotsRoot = root.querySelector(DOTS_SELECTOR);
  const controller = new AbortController();
  const { signal } = controller;
  let embla = null;
  let isDestroyed = false;
  let isPointerDown = false;
  let didDrag = false;
  let pointerDownX = 0;

  viewport.addEventListener(
    'dragstart',
    (event) => {
      event.preventDefault();
    },
    { signal }
  );

  viewport.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      isPointerDown = true;
      didDrag = false;
      pointerDownX = event.clientX;
      viewport.classList.add('is-dragging');
    },
    { signal }
  );

  viewport.addEventListener(
    'pointermove',
    (event) => {
      if (!isPointerDown) return;
      if (Math.abs(event.clientX - pointerDownX) > 5) {
        didDrag = true;
      }
    },
    { signal }
  );

  const endPointerDrag = () => {
    isPointerDown = false;
    window.setTimeout(() => {
      viewport.classList.remove('is-dragging');
    }, 0);
  };

  viewport.addEventListener('pointerup', endPointerDrag, { signal });
  viewport.addEventListener('pointercancel', endPointerDrag, { signal });
  viewport.addEventListener('lostpointercapture', endPointerDrag, { signal });

  viewport.addEventListener(
    'click',
    (event) => {
      if (!didDrag) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { signal, capture: true }
  );

  sectionStore.set(id, () => {
    isDestroyed = true;
    controller.abort();
    viewport.classList.remove('is-dragging');
    embla?.destroy();
  });

  loadEmbla()
    .then((EmblaCarousel) => {
      if (isDestroyed || !EmblaCarousel || !viewport.isConnected) return;

      embla = EmblaCarousel(viewport, {
        align: 'start',
        loop: false,
        dragFree: true,
        containScroll: 'trimSnaps',
        skipSnaps: false,
        slidesToScroll: 1,
      });

      const renderDots = () => {
        if (!dotsRoot) return;
        dotsRoot.innerHTML = '';

        embla.scrollSnapList().forEach((_, index) => {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'new-arrivals-strip-dot';
          dot.setAttribute('aria-label', `Go to slide group ${index + 1}`);
          dot.addEventListener(
            'click',
            () => {
              embla?.scrollTo(index);
            },
            { signal }
          );
          dotsRoot.appendChild(dot);
        });
      };

      const updateDots = () => {
        if (!dotsRoot) return;
        const selected = embla.selectedScrollSnap();
        dotsRoot.querySelectorAll('.new-arrivals-strip-dot').forEach((dot, index) => {
          dot.classList.toggle('is-active', index === selected);
        });
      };

      const updateButtons = () => {
        if (prevButton) prevButton.disabled = !embla.canScrollPrev();
        if (nextButton) nextButton.disabled = !embla.canScrollNext();
      };

      prevButton?.addEventListener(
        'click',
        () => {
          embla?.scrollPrev();
        },
        { signal }
      );

      nextButton?.addEventListener(
        'click',
        () => {
          embla?.scrollNext();
        },
        { signal }
      );

      embla.on('select', updateDots);
      embla.on('select', updateButtons);
      embla.on('reInit', () => {
        renderDots();
        updateDots();
        updateButtons();
      });

      renderDots();
      updateDots();
      updateButtons();
    })
    .catch(() => {
      viewport.classList.remove('is-dragging');
    });
}

function initAllSections(scope = document) {
  if (scope.matches?.(SECTION_SELECTOR)) {
    const id = scope.getAttribute('data-new-arrivals-line-section');
    if (id) initSection(id, scope);
    return;
  }

  scope.querySelectorAll?.(SECTION_SELECTOR).forEach((root) => {
    const id = root.getAttribute('data-new-arrivals-line-section');
    if (id) initSection(id, scope);
  });
}

window.__initNewArrivalsLineCarousel = initSection;
window.__destroyNewArrivalsLineCarousel = destroySection;

if (!window.__newArrivalsLineCarouselEventsBound) {
  window.__newArrivalsLineCarouselEventsBound = true;

  document.addEventListener('shopify:section:load', (event) => {
    const root = findSectionRootFromScope(event.target);
    const id = root?.getAttribute('data-new-arrivals-line-section');
    if (id) {
      initSection(id, event.target);
    }
  });

  document.addEventListener('shopify:section:unload', (event) => {
    const root = findSectionRootFromScope(event.target);
    const id = root?.getAttribute('data-new-arrivals-line-section');
    if (id) {
      destroySection(id);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      initAllSections(document);
    },
    { once: true }
  );
} else {
  initAllSections(document);
}
