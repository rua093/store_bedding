$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$variantPickerJsPath = Join-Path $root 'assets/variant-picker.js'
$variantPickerLiquidPath = Join-Path $root 'snippets/variant-main-picker.liquid'

$variantPickerJs = Get-Content -Raw $variantPickerJsPath
$variantPickerLiquid = Get-Content -Raw $variantPickerLiquidPath

if ($variantPickerLiquid -notmatch 'data-product-type="{{ product_resource\.type') {
  throw 'Variant picker markup must expose product type for Bedding-only scoping.'
}

if ($variantPickerLiquid -notmatch 'data-option-names="{{ product_resource\.options \| json \| escape }}"') {
  throw 'Variant picker markup must expose option names so logic can find Bedding Type without hardcoding positions.'
}

if ($variantPickerLiquid -notmatch 'data-product-variants') {
  throw 'Variant picker markup must expose product variants as the source of truth.'
}

if ($variantPickerJs -notmatch '#isBeddingDependentPicker\(\)') {
  throw 'variant-picker.js must scope dependent option logic to Bedding products with a Bedding Type option.'
}

if ($variantPickerJs -notmatch '#syncBeddingDependentOptions') {
  throw 'variant-picker.js must filter dependent Size and Set Options values from actual variants.'
}

if ($variantPickerJs -notmatch '#resetInvalidBeddingSelections') {
  throw 'variant-picker.js must reset invalid downstream selections to the first valid option.'
}

if ($variantPickerJs -notmatch '#getSelectedVariant\(\)') {
  throw 'variant-picker.js must resolve the final selected variant from all selected option values.'
}

if ($variantPickerJs -notmatch '#refreshOptionInputState\(\)') {
  throw 'variant-picker.js must refresh cached radio state after morphing variant picker DOM.'
}

if ($variantPickerJs -notmatch 'this\.#refreshOptionInputState\(\);\s*this\.#hydrateBeddingVariantData\(\);') {
  throw 'updateVariantPicker must refresh radio state before syncing Bedding dependent options after morph.'
}

if ($variantPickerJs -notmatch 'url\.searchParams\.set\(''variant'', selectedVariant\.id\.toString\(\)\)') {
  throw 'Variant URL must use the final selected variant ID, not a partial option value variant ID.'
}

Write-Output 'Bedding variant picker static checks passed.'
