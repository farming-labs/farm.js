---
title: "StyleX"
description: "Use StyleX in Farm with extracted production CSS, pre-paint development styles, and HMR."
section: "Plugin Ecosystem"
---

# StyleX

`@farm.js/stylex` connects [StyleX](https://stylexjs.com/) to Farm's development and production
pipelines. The default setup is one config entry:

```bash
pnpm add @farm.js/stylex @stylexjs/stylex
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { stylex } from "@farm.js/stylex";

export default defineConfig({
  plugins: [stylex()],
});
```

Farm configures the compiler, puts the development stylesheet in the managed document before the
page paints, connects CSS HMR, and extracts rules into the production CSS output. You do not need a
Vite plugin entry, virtual-module declarations, a client setup hook, or a manually created StyleX
stylesheet.

## Use StyleX

Use StyleX's normal authoring API in a component:

```tsx
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  button: {
    appearance: "none",
    backgroundColor: "#111",
    border: 0,
    borderRadius: 8,
    color: "white",
    cursor: "pointer",
    paddingBlock: 10,
    paddingInline: 16,

    ":hover": {
      backgroundColor: "#333",
    },
  },
});

export function Button() {
  return <button {...stylex.props(styles.button)}>Create project</button>;
}
```

`stylex.create()` is compiled statically. The browser receives generated class names and extracted
CSS rather than a runtime CSS compiler.

## External packages

Use `externalPackages` when a dependency publishes source code that still contains
`stylex.create()` calls:

```ts
export default defineConfig({
  plugins: [
    stylex({
      externalPackages: ["@acme/ui", "shared-stylex-components"],
    }),
  ],
});
```

Farm treats each listed dependency like application source: it excludes the package from Vite's
dependency optimization and runs the StyleX compiler over its modules.

Use package names only:

```ts
externalPackages: ["@acme/ui"]; // supported
externalPackages: ["@acme/ui/button"]; // package subpath, rejected
externalPackages: ["./packages/ui"]; // file path, rejected
```

You do not need `externalPackages` when:

- all StyleX calls live in the application;
- the dependency publishes already-compiled StyleX output; or
- the dependency uses ordinary CSS rather than StyleX.

StyleX automatically discovers direct dependencies that declare `@stylexjs/stylex`. Keep
`externalPackages` for packages that cannot be discovered through that metadata, workspace
packages with unusual manifests, or packages you deliberately need to force through compilation.

## Compiler options

The wrapper keeps StyleX's established option names:

```ts
stylex({
  useCSSLayers: true,
  importSources: ["@stylexjs/stylex"],
  externalPackages: ["@acme/ui"],
});
```

| Option                      | Default                      | Purpose                                                            |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------ |
| `externalPackages`          | `[]`                         | Force packages containing uncompiled StyleX through compilation.   |
| `importSources`             | StyleX defaults              | Recognize compatible StyleX authoring packages.                    |
| `useCSSLayers`              | `false`                      | Place generated rules into CSS layers.                             |
| `babelConfig`               | StyleX defaults              | Add Babel plugins or presets to StyleX's transform.                |
| `unstable_moduleResolution` | StyleX CommonJS resolution   | Control how StyleX resolves imported constants and themes.         |
| `lightningcssOptions`       | Project Browserslist targets | Configure CSS prefixing and syntax lowering.                       |
| `cssInjectionTarget`        | First production stylesheet  | Select an existing CSS asset that receives extracted StyleX rules. |

Farm intentionally owns StyleX's `dev`, `devMode`, and `devPersistToDisk` options. This keeps the
compiler mode aligned with `farm dev` and `farm build` and ensures the development stylesheet and
HMR runtime are either enabled together or omitted together.

## Behavior

- StyleX registers as a Vite pre-transform and compiles supported JavaScript, TypeScript, JSX,
  TSX, and Svelte modules reached by Farm's route, server, and client graphs.
- Rules found while Farm evaluates server-rendered routes are included in the browser-linked
  production stylesheet, including styles owned by server components.
- Development CSS is served from a same-origin virtual endpoint and is injected into Farm's
  managed `<head>` before the document reaches the browser.
- Production rules are lowered using the project's Browserslist targets and appended to Farm's
  emitted stylesheet. If the application has no other CSS, StyleX emits a fallback stylesheet.
- Enabling the plugin adds compiler work only to modules importing a configured StyleX source.
- Configure one `stylex()` instance. Put every external package and compiler option in that one
  call.

Because the development stylesheet must be present in the managed document before paint, the
plugin uses Farm's final HTML transform during development. This buffers streamed development HTML;
production streaming is unchanged.
