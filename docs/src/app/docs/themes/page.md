---
title: "Themes"
description: "Configure light, dark, and system color modes with a pre-paint selector, Tailwind variants, and typed client and server APIs."
section: "Core"
---

# Themes

FARMJS can manage a visitor's light, dark, or system preference without owning your colors. The
framework applies the active mode before styles load, persists the preference, and exposes typed
client and server APIs. Tailwind utilities, CSS variables, or ordinary selectors still define how
the application looks.

## Enable themes

Add `theme` to the application config:

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  theme: {
    default: "system",
    storageKey: "farm-theme",
  },
});
```

`default` accepts `"light"`, `"dark"`, or `"system"`. Theme support is opt-in; omit the property or
set it to `false` when the application manages color mode itself.

FARMJS stores the preference in a same-site cookie so server rendering can read it. It mirrors
changes to local storage for cross-tab updates. The cookie path follows the configured `basePath`.

## Tailwind dark variants

When the built-in Tailwind integration processes a stylesheet containing `@import "tailwindcss"`,
FARMJS connects the `dark:` variant to its `data-theme` selector automatically:

```tsx
export function Panel() {
  return (
    <section className="bg-white text-neutral-950 dark:bg-black dark:text-white">
      Theme-aware content
    </section>
  );
}
```

The active document is either `<html data-theme="light">` or `<html data-theme="dark">`. If the
stylesheet already defines `@custom-variant dark`, FARMJS preserves that definition instead of
overriding it.

## Plain CSS and design tokens

Tailwind is optional. Use the same selector with CSS variables or ordinary styles:

```css
:root {
  --background: #ffffff;
  --foreground: #0a0a0a;
}

[data-theme="dark"] {
  --background: #000000;
  --foreground: #f5f5f5;
}

body {
  background: var(--background);
  color: var(--foreground);
}
```

FARMJS also sets `color-scheme` for the resolved mode so native form controls and browser surfaces
match the page.

## Read and change the theme

Use `useTheme` in a client component:

```tsx
"use client";

import { useTheme } from "@farm.js/core/theme/client";

export function ThemePicker() {
  const { theme, resolvedTheme, mounted, setTheme } = useTheme();

  return (
    <div role="group" aria-label="Color theme">
      {(["light", "dark", "system"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={theme === option}
          onClick={() => setTheme(option)}
        >
          {option}
        </button>
      ))}
      <span aria-live="polite">
        {mounted && resolvedTheme ? `Using ${resolvedTheme} mode` : "Resolving theme"}
      </span>
    </div>
  );
}
```

The returned values have different jobs:

- `theme` is the saved `"light"`, `"dark"`, or `"system"` preference.
- `resolvedTheme` is the active `"light"` or `"dark"` browser mode. It is undefined during server
  rendering when the saved preference is `"system"`.
- `mounted` becomes true when the browser runtime is active.
- `setTheme(theme)` saves and applies a preference.
- `toggleTheme()` switches between the resolved light and dark modes.

The client module also exports non-hook `getTheme`, `setTheme`, and `toggleTheme` functions for
event handlers or stores outside React components.

## Read the preference on the server

Server-rendered pages and helpers can read the cookie-backed preference:

```tsx
import { getTheme } from "@farm.js/core/theme/server";

export default function SettingsPage() {
  const theme = getTheme();
  return <p>Saved preference: {theme}</p>;
}
```

`getTheme()` returns the preference, not an invented server-side resolution for `"system"`; only
the browser knows the visitor's operating-system color mode. Prefer CSS and `useTheme` for visual
styling. When server-rendered content depends on the cookie, treat that route as request-specific
rather than shared static output.

## No-flash behavior

FARMJS places a small bootstrap script and color-scheme style at the start of the document head.
They resolve the cookie and operating-system preference before application CSS loads. The runtime
also follows operating-system changes while `theme === "system"` and preserves `data-theme` during
SPA document navigation.

## Configuration reference

| Option       | Type                            | Default        | Purpose                                       |
| ------------ | ------------------------------- | -------------- | --------------------------------------------- |
| `default`    | `"light" \| "dark" \| "system"` | `"system"`     | Preference used before a visitor chooses one. |
| `storageKey` | `string`                        | `"farm-theme"` | Cookie and cross-tab storage key.             |
