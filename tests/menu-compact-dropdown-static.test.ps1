$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$headerMenuPath = Join-Path $root 'blocks/_header-menu.liquid'
$headerMenuJsPath = Join-Path $root 'assets/header-menu.js'

$headerMenu = Get-Content -Raw $headerMenuPath
$headerMenuJs = Get-Content -Raw $headerMenuJsPath

if ($headerMenu -notmatch 'data-submenu-layout="compact"') {
  throw 'Compact desktop submenus must identify their layout so header-menu.js can avoid expanding the header underlay.'
}

if ($headerMenuJs -notmatch '#shouldExpandHeaderForSubmenu\(submenu\)') {
  throw 'header-menu.js must branch on compact submenu layout before updating --full-open-header-height.'
}

$compactWrapperMatch = [regex]::Match(
  $headerMenu,
  '(?s)\.menu-list__list-item:where\(:not\(\[slot=''overflow''\]\)\) > \.menu-list__submenu--compact\s*\{(?<body>.*?)\}'
)

if (!$compactWrapperMatch.Success) {
  throw 'Expected compact submenu wrapper styles to exist.'
}

$compactWrapperBody = $compactWrapperMatch.Groups['body'].Value

if ($compactWrapperBody -notmatch 'clip-path:\s*none') {
  throw 'Compact submenu wrapper must reset the generic rectangular clip-path with clip-path: none.'
}

if ($compactWrapperBody -notmatch 'overflow:\s*visible') {
  throw 'Compact submenu wrapper must keep overflow visible so the rounded inner panel and shadow can render cleanly.'
}

$genericTransformIndex = $headerMenu.IndexOf('transform: translateY(calc(var(--full-open-header-height) - var(--submenu-height)))')
$compactOverrideIndex = $headerMenu.IndexOf(".menu-list__submenu-inner.menu-list__submenu-inner--compact")

if ($genericTransformIndex -lt 0) {
  throw 'Expected the generic submenu transform rule to exist.'
}

if ($compactOverrideIndex -lt 0) {
  throw 'Expected a high-specificity compact submenu override rule to exist.'
}

if ($compactOverrideIndex -lt $genericTransformIndex) {
  throw 'Compact submenu transform override must come after generic mega-menu transform rules.'
}

Write-Output 'Compact dropdown static checks passed.'
