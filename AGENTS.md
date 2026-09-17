# Shopify Theme Codex Rules

This repository contains a Shopify theme. These rules apply regardless of the theme base, version, framework, or project.

The goal is to keep every change stable, scoped, maintainable, SEO-safe, responsive, performant, and easy for a team to review.

## 1. Before Editing

- Read this file first.
- Check `git status` and preserve unrelated user/team changes.
- Inspect the real repository before making assumptions.
- Identify the theme's existing architecture, conventions, breakpoints, CSS system, JavaScript patterns, sections, snippets, templates, settings, and shared components.
- Do not assume the project uses Dawn, Tinker, or any specific Shopify theme architecture.
- Understand the affected pages, dependencies, responsive behavior, commerce behavior, and acceptance criteria before editing.
- Keep each task focused. Do not mix unrelated redesigns, refactors, formatting, dependency changes, and bug fixes in one diff.

## 2. Debugging Protocol

For bugs:

1. Reproduce the issue.
2. Identify where and under what conditions it occurs.
3. Inspect relevant Liquid, HTML, CSS, JavaScript, DOM, console, network, settings, and Shopify data.
4. Find the root cause.
5. Make the smallest maintainable fix.
6. Retest the original case and nearby behavior.
7. Remove temporary/debug code.
8. Review the final diff.

Do not randomly change values until the symptom disappears.

## 3. No Fragile Shortcuts

Avoid:

- stacking CSS overrides instead of fixing the source
- broad global selectors for local issues
- unnecessary `!important`
- arbitrary negative margins
- unnecessary `z-index` escalation
- `overflow: hidden` used only to hide layout bugs
- `setTimeout()` used to mask rendering/state problems
- duplicate desktop/mobile content only for layout convenience
- JavaScript layout logic when CSS can handle it reliably
- hardcoded Shopify product/variant values when real Shopify data is available
- rewriting unrelated code to make a task easier

If a workaround is unavoidable, isolate it and explain why.

## 4. Respect Existing Theme Architecture

- Follow the architecture and conventions already used by the theme.
- Prefer reusing existing sections, snippets, components, CSS variables, helpers, and utilities.
- Do not introduce a second implementation of functionality the theme already provides.
- Keep merchant-editable content configurable through section/block settings when appropriate.
- Preserve existing schema IDs, app blocks, dynamic sources, translations, metafields, and Shopify integrations.
- Keep important product and SEO content server-rendered whenever possible.
- Scope component-specific CSS and JavaScript locally.
- Treat global/shared files with extra caution.
- Avoid unnecessary changes to layout, theme configuration, global CSS, header, cart, search, or shared JavaScript.

## 5. Shopify Commerce Safety

Do not break existing:

- variant selection
- product forms
- price updates
- compare-at prices
- availability
- inventory states
- Add to Cart
- dynamic checkout / Buy Now
- cart drawer / cart page
- selling plans
- line item properties
- product media
- pickup availability
- app blocks
- product JSON / structured data

Use Shopify product and variant data as the source of truth instead of duplicating business logic when possible.

## 6. Theme Editor Compatibility

Changes must remain safe when Shopify dynamically reloads sections.

JavaScript should:

- support section re-rendering
- avoid duplicate event listeners
- avoid duplicate observers
- clean up timers/subscriptions when necessary
- not depend on a single initial page load
- avoid leaking global state between section instances

Test Theme Editor behavior when the changed component uses JavaScript.

## 7. UI And Responsive Quality

Do not validate UI at only one viewport.

Check relevant:

- small mobile
- large mobile
- tablet
- laptop
- desktop
- large desktop
- widths around changed breakpoints

Verify:

- no horizontal overflow
- no clipped or overlapping content
- stable media sizing
- usable buttons, menus, forms, and touch targets
- no visible flicker or flashing
- no unnecessary layout shifts
- correct sticky/fixed behavior
- drawers and overlays behave correctly
- focus states remain usable
- animations do not cause jank

Animations should enhance a layout that already works.

Prefer `transform` and `opacity` for animation.

## 8. SEO

Preserve or improve:

- page titles
- meta descriptions
- canonical URLs
- crawlable links
- heading hierarchy
- structured data / JSON-LD
- product, variant, price, and availability semantics
- meaningful image alt text
- internal linking
- server-rendered primary content

Do not move important SEO content into JavaScript-only rendering without a strong reason.

## 9. Accessibility

- Use semantic HTML.
- Use buttons for actions and links for navigation.
- Keep keyboard navigation working.
- Preserve visible focus states.
- Keep labels associated with form controls.
- Maintain correct disabled/selected/expanded states.
- Prefer native HTML semantics over unnecessary ARIA.
- Ensure hidden UI cannot leave interactive controls accidentally reachable.

## 10. Performance

Avoid unnecessary:

- large JavaScript bundles
- duplicate dependencies
- repeated DOM queries
- repeated variant processing
- scroll/resize handlers without throttling when needed
- layout-triggering JavaScript
- oversized images
- eager loading of non-critical media

Do not knowingly worsen:

- LCP
- CLS
- INP
- page responsiveness

Reserve image/media dimensions where practical.

## 11. Git And Team Safety

- Never automatically commit or push.
- Commit or push only when explicitly requested.
- Never force push unless explicitly requested.
- Never reset, clean, restore, or overwrite unrelated work.
- Do not rewrite Git history without explicit approval.
- Review `git diff` before completion.
- Shared/global files require extra care when multiple team members work in parallel.
- Do not overwrite another team member's implementation without understanding the dependency.

## 12. Shopify Environment Boundaries

Do not automatically:

- publish a theme
- push to a live/shared theme
- pull remote Theme Editor changes over local work
- change store configuration
- change app configuration
- modify production data
- change Shopify credentials or authentication

Remote changes must be inspected before integration.

Git should remain the source of truth for theme code unless the project explicitly defines another workflow.

## 13. Verification

Before reporting completion:

- review the diff
- check for unrelated changes
- run relevant repository checks/tests
- inspect browser console for UI/JS work
- test the affected functionality
- test nearby behavior that may regress
- test relevant responsive widths
- test Shopify commerce flows when affected
- verify Theme Editor behavior when relevant

Do not claim a test passed unless it was actually run.

## 14. Completion Report

At the end of a task, report briefly:

### Changed

What was changed.

### Reason

Root cause or implementation reason.

### Files

Files modified.

### Verified

Tests, pages, flows, and viewport sizes actually checked.

### Not Verified

Anything that could not be tested.

### Risks

Remaining assumptions or potential risks.

Never report “done”, “passed”, or “no regression” without verification.

Desktop-only validation is never sufficient for UI work.
