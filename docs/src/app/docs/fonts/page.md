---
title: "Fonts"
description: "Load local and remote fonts as self-hosted, hashed Farm assets without runtime loader code."
---

# Fonts

Farm compiles font declarations into ordinary CSS and content-hashed assets. The loader call is removed from the application bundle, so it adds no browser runtime and does not require inline styles or `dangerouslySetInnerHTML`.

## Local fonts

Call `localFont` at module scope in a layout or page. The source can be relative to that module or a package font specifier.

```tsx title="src/app/layout.tsx"
import { localFont } from "@farm.js/core/font";

const geist = localFont({
  src: "geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  family: "Geist Sans",
  weight: "100 900",
  variable: "--font-geist-sans",
  fallback: ["system-ui", "sans-serif"],
});

export default function RootLayout({ children }) {
  return <main className={`${geist.variable} ${geist.className}`}>{children}</main>;
}
```

Farm emits the font with a content hash, generates its `@font-face`, and adds a preload hint by default. `display` defaults to `"swap"`.

### Fonts in `public`

An absolute URL beginning with `/` resolves from Farm's configured `publicDir`:

```tsx title="src/app/layout.tsx"
const geist = localFont({
  src: "/fonts/Geist-Variable.woff2",
  family: "Geist Sans",
  weight: "100 900",
  variable: "--font-geist-sans",
});
```

For example, the source above reads `public/fonts/Geist-Variable.woff2`. Farm generates the CSS and preload hint but keeps the public URL, so it does not emit a duplicate font asset. Use a relative or package source when you want Farm to create a content-hashed filename.

## Multiple weights and styles

Use explicit sources when one family has more than one file.

```ts
const editorial = localFont({
  family: "Editorial",
  src: [
    { path: "./Editorial-Regular.woff2", weight: 400 },
    { path: "./Editorial-Bold.woff2", weight: 700 },
    { path: "./Editorial-Italic.woff2", weight: 400, style: "italic" },
  ],
  variable: "--font-editorial",
});
```

Set `preload: false` for sources that are not needed above the fold or are only used on a narrow route.

## Remote fonts

`remoteFont` downloads the file during the build and serves it from the application by default. The browser does not contact the original font host.

```ts
import { remoteFont } from "@farm.js/core/font";

const brand = remoteFont({
  src: "https://fonts.example.com/brand.woff2",
  family: "Brand Sans",
  weight: "100 900",
  variable: "--font-brand",
  integrity: "sha384-BASE64_DIGEST",
});
```

Remote sources must use HTTPS. Add `integrity` when the host publishes a stable file so Farm can reject unexpected bytes. Builds fail clearly when a self-hosted remote font cannot be downloaded or does not match its integrity value.

Pass a direct `.woff2`, `.woff`, `.ttf`, or `.otf` URL, not a provider stylesheet URL. For Geist, installing the `geist` package and using `localFont` keeps the font version in the lockfile. For Google Fonts, download the licensed font files into the project or use their direct font-file URLs with `remoteFont`.

If a license or hosting policy requires the browser to retain the original URL, opt into external loading:

```ts
const partner = remoteFont({
  src: "https://cdn.example.com/partner.woff2",
  family: "Partner Sans",
  strategy: "external",
});
```

## Returned values

Every loader returns:

- `className`, which applies the generated font stack
- `variable`, which defines the configured CSS custom property, or an empty string when none was configured
- `style`, an inline-style compatible object containing `fontFamily` and any fixed style or weight

The options must be static and the call must initialize a module-scope variable. This lets Farm resolve files, validate remote URLs, deduplicate identical declarations, generate CSS, and assign assets to the build before application code runs.
