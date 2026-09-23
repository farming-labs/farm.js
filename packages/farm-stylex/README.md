# `@farm.js/stylex`

Compile [StyleX](https://stylexjs.com/) in Farm with extracted production CSS, pre-paint
development styles, and CSS HMR.

## Install

```bash
pnpm add @farm.js/stylex @stylexjs/stylex
```

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { stylex } from "@farm.js/stylex";

export default defineConfig({
  plugins: [stylex()],
});
```

Use the normal StyleX authoring API in application components:

```tsx
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  button: {
    backgroundColor: "#111",
    borderRadius: 8,
    color: "white",
    padding: "10px 16px",
    ":hover": { backgroundColor: "#333" },
  },
});

export function Button() {
  return <button {...stylex.props(styles.button)}>Create project</button>;
}
```

Farm selects StyleX's development or production compiler mode, injects the development stylesheet
before paint, connects HMR, and appends extracted production rules to Farm's CSS output. Do not add
StyleX virtual modules or stylesheet tags yourself.

## External packages

Dependencies are normally optimized as already-built code. Add a package to `externalPackages`
when it publishes source containing uncompiled `stylex.create()` calls:

```ts
stylex({
  externalPackages: ["@acme/ui", "shared-stylex-components"],
});
```

Farm then excludes those packages from Vite dependency optimization and runs the StyleX compiler
over them. Pass package names only, not file paths, glob patterns, or package subpaths. You do not
need this option for packages that publish compiled StyleX output or ordinary CSS.

Other StyleX compiler options such as `useCSSLayers`, `importSources`, `babelConfig`,
`unstable_moduleResolution`, `lightningcssOptions`, and `cssInjectionTarget` pass through to
`@stylexjs/unplugin`. Farm owns `dev`, `devMode`, and `devPersistToDisk` so development and build
behavior cannot drift apart.
