# Farm.js i18n example

This example verifies the complete internationalization path:

- locale config in `farm.config.ts`
- nested English, Amharic, and Arabic ICU catalogs
- generated locale, key, and argument types
- server translation and `Intl` formatting
- client translation and locale switching
- URL, cookie, and `Accept-Language` resolution
- localized API responses
- automatic `lang`, `dir`, and `hreflang` output

From the repository root:

```bash
pnpm --filter @farm.js/core build
pnpm --filter farm-i18n-example dev
```

Build and type-check the production app:

```bash
pnpm --filter farm-i18n-example build
pnpm --filter farm-i18n-example type-check
pnpm --filter farm-i18n-example start
```
