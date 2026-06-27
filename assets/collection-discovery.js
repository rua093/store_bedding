const DISCOVERY_SELECTOR = '[data-collection-discovery]';
const CHIP_SELECTOR = '[data-comfort-chip]';
const TILE_SELECTOR = '[data-patchwork-tile]';

function setActiveIndex(section, activeIndex) {
  if (!(section instanceof HTMLElement) || !activeIndex) return;

  section.dataset.activeChip = activeIndex;

  section.querySelectorAll(CHIP_SELECTOR).forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.chipIndex === activeIndex ? 'true' : 'false');
  });
}

function setActiveChip(section, chip) {
  if (!(chip instanceof HTMLElement)) return;

  const chipIndex = chip.dataset.chipIndex;
  if (!chipIndex) return;

  setActiveIndex(section, chipIndex);
}

function setActiveTile(section, tile) {
  if (!(tile instanceof HTMLElement)) return;

  const tileIndex = tile.dataset.patchworkIndex;
  if (!tileIndex) return;

  setActiveIndex(section, tileIndex);
}

function bindDiscoverySection(section) {
  if (!(section instanceof HTMLElement) || section.dataset.collectionDiscoveryBound === 'true') return;

  const chips = Array.from(section.querySelectorAll(CHIP_SELECTOR));
  const tiles = Array.from(section.querySelectorAll(TILE_SELECTOR));
  if (!chips.length && !tiles.length) return;

  const defaultChip = chips.find((chip) => chip.getAttribute('aria-pressed') === 'true') ?? chips[0];
  const defaultTile = tiles[0];

  if (defaultChip instanceof HTMLElement) {
    setActiveChip(section, defaultChip);
  } else if (defaultTile instanceof HTMLElement) {
    setActiveTile(section, defaultTile);
  }

  chips.forEach((chip) => {
    chip.addEventListener('mouseenter', () => setActiveChip(section, chip));
    chip.addEventListener('focus', () => setActiveChip(section, chip));
    chip.addEventListener('click', () => setActiveChip(section, chip));
  });

  tiles.forEach((tile) => {
    tile.addEventListener('mouseenter', () => setActiveTile(section, tile));
    tile.addEventListener('focus', () => setActiveTile(section, tile), true);
    tile.addEventListener('click', () => setActiveTile(section, tile));
  });

  section.dataset.collectionDiscoveryBound = 'true';
}

function initCollectionDiscovery(root = document) {
  root.querySelectorAll(DISCOVERY_SELECTOR).forEach(bindDiscoverySection);
}

document.addEventListener('DOMContentLoaded', () => {
  initCollectionDiscovery();
});

document.addEventListener('shopify:section:load', (event) => {
  initCollectionDiscovery(event.target instanceof Element ? event.target : document);
});

document.addEventListener('shopify:section:reorder', () => {
  initCollectionDiscovery();
});
