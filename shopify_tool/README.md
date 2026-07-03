# Shopify Codex Tool — README for AI/Codex Agents

## 1. Why this tool exists

This repository contains `shopify_codex_tool.py`, a **safe Shopify Admin GraphQL CLI helper** designed for AI-assisted Shopify theme development.

The main use case is:

> A human gives Codex or another AI agent a Shopify theme source and a business/product idea. The AI needs to inspect the real Shopify store data, understand product/content/metadata structures, propose changes, and optionally apply safe Shopify Admin API changes during theme development.

A Shopify theme is not only local Liquid/CSS/JS files. A real Shopify storefront also depends on store-side data and configuration, including:

- Products and product variants
- Collections
- Product metafields
- Collection metafields
- Metaobjects and metaobject definitions
- Shopify Files/media
- Pages and navigation menus
- Theme settings and theme files
- App blocks/app embeds, when present

Without this context, Codex may write Liquid code that references fields that do not exist, such as:

```liquid
{{ product.metafields.custom.warmth_level.value }}
```

If `custom.warmth_level` does not exist in Shopify Admin, the UI will render blank. This tool exists to help Codex avoid guessing.

---

## 2. What this tool is

This tool is a **CLI adapter for Shopify Admin GraphQL API**.

It is intentionally designed to be:

- Easy for Codex to call through terminal commands
- JSON-oriented, so outputs can be read by AI agents
- Safe by default, because write operations run as dry-run unless `--apply` is explicitly passed
- Useful during local Shopify theme development
- MCP-like, because it exposes a machine-readable tool manifest through `mcp-tools`

Run:

```bash
python shopify_codex_tool.py mcp-tools
```

This prints a JSON manifest that tells Codex what this CLI can do.

Important: this is **not a full MCP JSON-RPC stdio server** yet. It is an MCP-like command-line bridge. A real MCP server can wrap these commands later.

---

## 3. What this tool is not

This tool is **not** a full Shopify SDK.

It does not currently wrap every Shopify API domain such as orders, customers, inventory, discounts, markets, fulfillment, webhooks, Shopify Functions, Payments Apps API, Storefront API, or Customer Account API.

It focuses on the APIs most useful for **AI-assisted Shopify theme development**:

- Auth and token setup
- Store scanning
- Products
- Collections
- Metafields
- Metaobjects
- Files/media
- Themes/theme files
- Pages/menus at a basic level
- JSON migration plans
- Raw GraphQL fallback

For unsupported Shopify Admin GraphQL operations, use:

```bash
python shopify_codex_tool.py graphql --query-file query.graphql --variables-file variables.json
```

---

## 4. Golden rule for Codex

Codex must follow this rule:

> Never assume Shopify Admin data exists. Inspect first, then modify local theme code, then propose data/schema migrations when needed.

Correct workflow:

```text
Inspect store context
→ inspect local theme source
→ identify required data/metafields/metaobjects/files
→ create migration plan if needed
→ dry-run migration
→ only apply to dev/unpublished store when the human approves
→ update local theme code
→ test through Shopify CLI preview
```

Wrong workflow:

```text
Guess a metafield key
→ write Liquid using it
→ assume Shopify Admin has that data
```

---

## 5. Required files

Minimum files expected in the project:

```text
shopify_codex_tool.py
.env.shopify
```

Optional but recommended:

```text
shopify-context.json
shopify_migration.example.json
shopify-migrations/
```

Never commit `.env.shopify` to git.

---

## 6. `.env.shopify` format

Generate an example file:

```bash
python shopify_codex_tool.py env-example > .env.shopify
```

Example:

```env
SHOPIFY_SHOP="your-dev-store.myshopify.com"
SHOPIFY_CLIENT_ID="your_client_id"
SHOPIFY_CLIENT_SECRET="your_client_secret"
SHOPIFY_API_VERSION="2026-04"
SHOPIFY_SCOPES="read_products,write_products,read_files,write_files,read_metaobjects,write_metaobjects,read_metaobject_definitions,write_metaobject_definitions,read_themes,write_themes,read_content,write_content"
SHOPIFY_REDIRECT_URI="http://127.0.0.1:3456/callback"

# Filled by token commands when using --save
# SHOPIFY_ACCESS_TOKEN="shpat_or_token_value"
```

Codex must never print real secrets into chat logs, documentation, commits, or screenshots.

---

## 7. Getting an access token

This tool supports two token flows.

### 7.1 Client credentials flow

Use this when the app is an internal/custom app for a store owned by the same organization and the app is already installed/allowed.

```bash
python shopify_codex_tool.py token-client-credentials --save
```

This saves `SHOPIFY_ACCESS_TOKEN` into `.env.shopify`.

Avoid:

```bash
python shopify_codex_tool.py token-client-credentials --show-token
```

Only use `--show-token` for local debugging, never in shared logs.

### 7.2 OAuth authorization-code flow

Generate an install URL:

```bash
python shopify_codex_tool.py auth-url
```

Open the generated URL in a browser, approve the app, copy the `code` from the callback URL, then run:

```bash
python shopify_codex_tool.py exchange-code --code <code-from-callback> --save
```

### 7.3 Verify callback HMAC

For debugging OAuth callback verification:

```bash
python shopify_codex_tool.py verify-hmac --query-string "shop=...&code=...&hmac=..."
```

---

## 8. First connection test

After token setup, run:

```bash
python shopify_codex_tool.py shop-info
```

Expected result:

```json
{
  "ok": true,
  "data": {
    "shop": {
      "id": "...",
      "name": "...",
      "myshopifyDomain": "..."
    }
  }
}
```

If this fails, Codex should not continue theme/data automation. Fix auth, store domain, app scopes, or token first.

---

## 9. Standard Codex workflow for Shopify theme development

### Step 1 — Export Shopify store context

```bash
python shopify_codex_tool.py scan-context --include-content --out shopify-context.json
```

This gives Codex a JSON snapshot of:

- Shop info
- Products
- Collections
- Product metafield definitions
- Collection metafield definitions
- Metaobject definitions
- Files
- Themes
- Optional pages and menus

If some sections fail because scopes are missing, the tool keeps scanning and records errors per section.

### Step 2 — Read local theme source

Codex should inspect these local theme directories:

```text
layout/
templates/
sections/
snippets/
assets/
config/
locales/
blocks/        # if present
```

### Step 3 — Map page to files

Before coding, Codex should answer:

```text
Which template renders this page?
Which sections does that template use?
Which snippets do those sections call?
Which CSS/JS assets affect those sections?
Which Shopify Admin data does the Liquid code depend on?
```

### Step 4 — Propose changes

Codex should separate changes into two groups:

```text
A. Local theme code changes
B. Shopify Admin data/schema changes
```

Examples of Shopify Admin data/schema changes:

- Create a product metafield definition
- Set sample metafield values on dev products
- Create a metaobject definition
- Create metaobject entries
- Upload files/media
- Create/update product mock data

### Step 5 — Create a migration plan if Admin data must change

Create a JSON migration file such as:

```text
shopify-migrations/001_add_blanket_product_metadata.json
```

Then dry-run it:

```bash
python shopify_codex_tool.py migration-apply --file shopify-migrations/001_add_blanket_product_metadata.json
```

Only apply after human approval:

```bash
python shopify_codex_tool.py migration-apply --file shopify-migrations/001_add_blanket_product_metadata.json --apply
```

---

## 10. Safety model

All write commands are dry-run by default.

Examples:

```bash
python shopify_codex_tool.py product-create --json-file product.json
python shopify_codex_tool.py metafield-definition-create --json-file metafield.json
python shopify_codex_tool.py metafields-set --json-file values.json
python shopify_codex_tool.py metaobject-create --json-file entry.json
python shopify_codex_tool.py theme-publish --theme-id gid://shopify/OnlineStoreTheme/123
```

These commands do **not** execute unless `--apply` is added.

To execute:

```bash
python shopify_codex_tool.py product-create --json-file product.json --apply
```

Codex should only use `--apply` when:

1. The human explicitly asked to apply the change, and
2. The target is a dev store or unpublished/development theme, and
3. The dry-run output was reviewed, and
4. The migration/data change is minimal and reversible.

Codex should avoid applying changes to production/live stores unless the human explicitly confirms that the target is production and accepts the risk.

---

## 11. Supported command groups

### 11.1 Help and manifest

```bash
python shopify_codex_tool.py --help
python shopify_codex_tool.py <command> --help
python shopify_codex_tool.py mcp-tools
python shopify_codex_tool.py env-example
```

Codex should call `--help` whenever unsure about command arguments.

### 11.2 Auth commands

```bash
python shopify_codex_tool.py auth-url
python shopify_codex_tool.py token-client-credentials --save
python shopify_codex_tool.py exchange-code --code <code> --save
python shopify_codex_tool.py verify-hmac --query-string "..."
```

### 11.3 Generic GraphQL

```bash
python shopify_codex_tool.py graphql --query-file query.graphql --variables-file variables.json
```

This is the escape hatch for APIs not wrapped by a dedicated command.

### 11.4 Store context

```bash
python shopify_codex_tool.py shop-info
python shopify_codex_tool.py scan-context --include-content --out shopify-context.json
```

### 11.5 Products

```bash
python shopify_codex_tool.py products-list --first 20
python shopify_codex_tool.py products-list --query "blanket"
python shopify_codex_tool.py product-get --handle cloudsoft-blanket
python shopify_codex_tool.py product-create --json-file product.json
python shopify_codex_tool.py product-create --json-file product.json --apply
python shopify_codex_tool.py product-update --json-file product-update.json --apply
```

### 11.6 Collections

```bash
python shopify_codex_tool.py collections-list --first 20
python shopify_codex_tool.py collections-list --query "blanket"
```

### 11.7 Metafields

```bash
python shopify_codex_tool.py metafield-definitions-list --owner-type PRODUCT
python shopify_codex_tool.py metafield-definitions-list --owner-type COLLECTION
python shopify_codex_tool.py metafield-definition-create --json-file metafield-definition.json
python shopify_codex_tool.py metafield-definition-create --json-file metafield-definition.json --apply
python shopify_codex_tool.py metafields-set --json-file metafield-values.json
python shopify_codex_tool.py metafields-set --json-file metafield-values.json --apply
```

### 11.8 Metaobjects

```bash
python shopify_codex_tool.py metaobject-definitions-list
python shopify_codex_tool.py metaobject-definition-create --json-file metaobject-definition.json
python shopify_codex_tool.py metaobject-definition-create --json-file metaobject-definition.json --apply
python shopify_codex_tool.py metaobjects-list --type product_benefit
python shopify_codex_tool.py metaobject-create --json-file metaobject.json
python shopify_codex_tool.py metaobject-create --json-file metaobject.json --apply
```

### 11.9 Files and media

```bash
python shopify_codex_tool.py files-list
python shopify_codex_tool.py files-list --query "blanket"
python shopify_codex_tool.py file-create-url --url "https://example.com/banner.jpg" --content-type IMAGE --alt "Blanket hero"
python shopify_codex_tool.py file-create-url --url "https://example.com/banner.jpg" --content-type IMAGE --alt "Blanket hero" --apply
python shopify_codex_tool.py staged-upload-target --filename hero.jpg --resource IMAGE
python shopify_codex_tool.py staged-upload-file --target-json staged-target.json --path ./hero.jpg
```

### 11.10 Themes

```bash
python shopify_codex_tool.py themes-list
python shopify_codex_tool.py theme-file-get --theme-id gid://shopify/OnlineStoreTheme/123 --filename templates/index.json
python shopify_codex_tool.py theme-files-upsert --theme-id gid://shopify/OnlineStoreTheme/123 --file templates/index.json=./templates/index.json
python shopify_codex_tool.py theme-files-upsert --theme-id gid://shopify/OnlineStoreTheme/123 --file templates/index.json=./templates/index.json --apply
python shopify_codex_tool.py theme-files-delete --theme-id gid://shopify/OnlineStoreTheme/123 --filename sections/old-section.liquid
python shopify_codex_tool.py theme-create --name "AI Dev Theme" --source "https://example.com/theme.zip"
python shopify_codex_tool.py theme-create --name "AI Dev Theme" --source "https://example.com/theme.zip" --apply
python shopify_codex_tool.py theme-publish --theme-id gid://shopify/OnlineStoreTheme/123
python shopify_codex_tool.py theme-publish --theme-id gid://shopify/OnlineStoreTheme/123 --apply
```

Theme write commands may require `write_themes` and Shopify theme API exemption. If they fail, Codex should report the failure and avoid guessing.

### 11.11 Pages and menus

```bash
python shopify_codex_tool.py pages-list
python shopify_codex_tool.py pages-list --query "about"
python shopify_codex_tool.py menus-list
```

These commands may require the right API version and scopes. If they fail, use `graphql` with the current Shopify docs as ground truth.

### 11.12 Migrations

```bash
python shopify_codex_tool.py migration-apply --file migration.json
python shopify_codex_tool.py migration-apply --file migration.json --apply
```

Migration files are the preferred way for Codex to propose Shopify Admin changes.

---

## 12. Migration file format

A migration file is a JSON plan. It may contain these top-level arrays:

```json
{
  "metafield_definitions": [],
  "metaobject_definitions": [],
  "products": [],
  "metafields": [],
  "metaobjects": [],
  "files": []
}
```

### 12.1 Example: product metafield definition

```json
{
  "metafield_definitions": [
    {
      "name": "Warmth level",
      "namespace": "custom",
      "key": "warmth_level",
      "description": "Warmth level of the blanket.",
      "type": "single_line_text_field",
      "ownerType": "PRODUCT"
    }
  ]
}
```

### 12.2 Example: set product metafield value

```json
{
  "metafields": [
    {
      "ownerId": "gid://shopify/Product/1234567890",
      "namespace": "custom",
      "key": "warmth_level",
      "type": "single_line_text_field",
      "value": "Medium Warm"
    }
  ]
}
```

### 12.3 Example: metaobject definition

```json
{
  "metaobject_definitions": [
    {
      "name": "Product benefit",
      "type": "product_benefit",
      "access": {
        "admin": "MERCHANT_READ_WRITE",
        "storefront": "PUBLIC_READ"
      },
      "fieldDefinitions": [
        {
          "name": "Title",
          "key": "title",
          "type": "single_line_text_field",
          "required": true
        },
        {
          "name": "Description",
          "key": "description",
          "type": "multi_line_text_field",
          "required": false
        },
        {
          "name": "Icon",
          "key": "icon",
          "type": "file_reference",
          "required": false
        }
      ]
    }
  ]
}
```

---

## 13. Decision guide: metafield or metaobject?

Use a **metafield** when the data is a simple attribute on one Shopify resource.

Good product metafield examples:

```text
custom.material
custom.care_instruction
custom.warmth_level
custom.size_guide
custom.short_description
```

Use a **metaobject** when the data is structured, repeatable, or has multiple fields.

Good metaobject examples:

```text
product_benefit:
- icon
- title
- description

size_guide_row:
- size
- width
- length
- recommended_use

faq_item:
- question
- answer
```

Codex should not create one giant JSON/string metafield when a metaobject would be clearer and easier for a merchant to manage.

---

## 14. How Codex should handle a new metadata requirement

If Codex wants to render a new product field, it must do this:

```text
1. Search existing product metafield definitions.
2. Search existing product data/metafields.
3. If an appropriate field exists, reuse it.
4. If no field exists, propose a new metafield definition in a migration JSON file.
5. Add sample values only on dev/sample products.
6. Update Liquid with safe fallback logic.
7. Dry-run migration.
8. Ask/apply only after human approval.
```

Liquid must use fallback checks:

```liquid
{% assign warmth_level = product.metafields.custom.warmth_level.value %}

{% if warmth_level != blank %}
  <div class="product-spec">
    <span class="product-spec__label">Warmth level</span>
    <span class="product-spec__value">{{ warmth_level }}</span>
  </div>
{% endif %}
```

Avoid:

```liquid
<div>{{ product.metafields.custom.warmth_level.value }}</div>
```

The unsafe version may render empty UI when the metafield is missing.

---

## 15. How Codex should use this with local Shopify theme code

Codex should treat local theme code and Shopify Admin data as separate layers.

```text
Local theme code = rendering logic and UI structure
Shopify Admin data = product/content/metadata/media/config used by the theme
```

When implementing a feature, Codex should document both layers.

Example:

```text
Feature: Product benefit cards

Theme files:
- sections/product-benefits.liquid
- snippets/icon-benefit.liquid
- assets/product-benefits.css
- templates/product.json

Shopify Admin data:
- metaobject definition: product_benefit
- product metafield: custom.product_benefits, list.metaobject_reference
- sample entries for dev product
```

---

## 16. Recommended local development loop

```bash
# 1. Get store context
python shopify_codex_tool.py scan-context --include-content --out shopify-context.json

# 2. Run local Shopify theme preview through Shopify CLI
shopify theme dev

# 3. Make local theme changes
# Codex edits Liquid/CSS/JS/JSON templates locally.

# 4. If Shopify Admin schema/data is required, create a migration file
python shopify_codex_tool.py migration-apply --file shopify-migrations/001_feature.json

# 5. Apply only to dev store after approval
python shopify_codex_tool.py migration-apply --file shopify-migrations/001_feature.json --apply

# 6. Test preview again
shopify theme dev
```

---

## 17. API scopes and permission issues

Many Shopify Admin GraphQL operations require scopes.

Common scopes for this tool:

```text
read_products
write_products
read_files
write_files
read_metaobjects
write_metaobjects
read_metaobject_definitions
write_metaobject_definitions
read_themes
write_themes
read_content
write_content
```

If a command fails with an access/scope error, Codex should:

1. Report the exact error.
2. Identify the likely missing scope.
3. Avoid retrying blindly.
4. Ask the human to update app scopes/install permissions if needed.

Theme write operations may also need special Shopify approval/exemption. Codex must not assume theme write APIs are available just because a token exists.

---

## 18. Official documentation ground truth

Codex should treat Shopify official documentation as ground truth, especially for API names, input shapes, scope requirements, and API version changes.

Useful official docs:

```text
https://shopify.dev/docs/api
https://shopify.dev/docs/api/admin-graphql
https://shopify.dev/docs/api/admin-graphql/latest
https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate
https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldDefinitionCreate
https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldsSet
https://shopify.dev/docs/api/admin-graphql/latest/mutations/metaobjectDefinitionCreate
https://shopify.dev/docs/api/admin-graphql/latest/mutations/metaobjectCreate
https://shopify.dev/docs/api/admin-graphql/latest/mutations/fileCreate
https://shopify.dev/docs/api/admin-graphql/latest/mutations/stagedUploadsCreate
https://shopify.dev/docs/api/admin-graphql/latest/queries/themes
https://shopify.dev/docs/api/admin-graphql/latest/mutations/themeCreate
https://shopify.dev/docs/api/admin-graphql/latest/mutations/themePublish
https://shopify.dev/docs/storefronts/themes
https://shopify.dev/docs/storefronts/themes/tools/cli
```

If this README or tool conflicts with current Shopify docs, follow Shopify docs and update the tool.

---

## 19. Raw GraphQL examples

### 19.1 Query current shop

`query.graphql`:

```graphql
query ShopInfo {
  shop {
    id
    name
    myshopifyDomain
  }
}
```

Run:

```bash
python shopify_codex_tool.py graphql --query-file query.graphql
```

### 19.2 Use variables

`query.graphql`:

```graphql
query ProductByHandle($handle: String!) {
  productByHandle(handle: $handle) {
    id
    title
    handle
  }
}
```

`variables.json`:

```json
{
  "handle": "cloudsoft-blanket"
}
```

Run:

```bash
python shopify_codex_tool.py graphql --query-file query.graphql --variables-file variables.json
```

---

## 20. How to extend this tool

When Codex needs an API domain that is not wrapped by a command:

1. First use `graphql` with a query/mutation from official Shopify docs.
2. Confirm the query works against the dev store.
3. Add a named command to `shopify_codex_tool.py` only if the operation is used repeatedly.
4. Keep output JSON-friendly.
5. Keep write operations dry-run by default.
6. Add the new command to `mcp-tools` manifest.
7. Update this README.

Good candidates for future modules:

```text
orders
customers
inventory
locations
discounts
markets
translations
webhooks
bulk-operations
publications
selling-plans
delivery-profiles
store-policies
storefront-access-token
```

Do not add broad write permissions casually. Every write command should have a clear development use case and dry-run behavior.

---

## 21. Human approval rules

Codex should ask for explicit human approval before:

- Creating products in a real store
- Updating existing products
- Creating or changing metafield definitions
- Creating metaobject definitions
- Uploading many files
- Writing theme files through the API
- Publishing a theme
- Running `--apply` against any production store

Codex may run read-only commands without asking, if the task clearly requires Shopify context.

---

## 22. Common task recipes

### 22.1 Build a blanket product page section

```bash
python shopify_codex_tool.py scan-context --include-content --out shopify-context.json
python shopify_codex_tool.py product-get --handle cloudsoft-blanket
python shopify_codex_tool.py metafield-definitions-list --owner-type PRODUCT
```

Then Codex should inspect:

```text
templates/product.json
sections/main-product.liquid
snippets/price.liquid
snippets/product-card.liquid
assets/*.css
```

If a missing field is needed, create a migration.

### 22.2 Add a new product metafield

```bash
python shopify_codex_tool.py metafield-definitions-list --owner-type PRODUCT
python shopify_codex_tool.py metafield-definition-create --json-file warmth-level-definition.json
python shopify_codex_tool.py metafield-definition-create --json-file warmth-level-definition.json --apply
python shopify_codex_tool.py metafields-set --json-file warmth-level-values.json
python shopify_codex_tool.py metafields-set --json-file warmth-level-values.json --apply
```

### 22.3 Upload a local image to Shopify Files

```bash
python shopify_codex_tool.py staged-upload-target --filename blanket-hero.jpg --resource IMAGE > staged-target.json
python shopify_codex_tool.py staged-upload-file --target-json staged-target.json --path ./blanket-hero.jpg
```

Then use the returned `resourceUrl` with `fileCreate` through `graphql` or adapt the tool workflow as needed.

### 22.4 Create an unpublished theme from ZIP

```bash
python shopify_codex_tool.py theme-create --name "AI Dev Theme" --source "https://example.com/theme.zip"
python shopify_codex_tool.py theme-create --name "AI Dev Theme" --source "https://example.com/theme.zip" --apply
```

### 22.5 Publish a theme

Publishing is dangerous. Dry-run first:

```bash
python shopify_codex_tool.py theme-publish --theme-id gid://shopify/OnlineStoreTheme/123
```

Apply only after explicit human confirmation:

```bash
python shopify_codex_tool.py theme-publish --theme-id gid://shopify/OnlineStoreTheme/123 --apply
```

---

## 23. Error handling expectations for Codex

When a command fails, Codex should not hide the error.

Codex should report:

```text
- Command run
- Whether it was read-only or write/dry-run/apply
- Error message
- Likely cause
- Next safe step
```

Example:

```text
Command failed: themes-list
Likely cause: app token missing read_themes scope or store does not allow this API.
Next step: update app scopes and reinstall/regenerate token, or inspect theme through Shopify CLI.
```

---

## 24. Final mental model

Use this tool as the bridge between:

```text
Codex/local files
↔ Shopify Admin GraphQL API
↔ real store product/content/metadata/theme data
```

Codex should use it to answer these questions before coding:

```text
What data exists?
What metadata schema exists?
What content/files exist?
What theme exists?
What needs to be created?
What can be reused?
What must be dry-run first?
```

This tool exists so Codex can build Shopify themes with real store context instead of guessing.
