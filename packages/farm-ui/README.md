# @farm.js/ui

Portable UI primitives for Farm.js apps. You write a screen once with `View`,
`Text`, `Image`, `Pressable`, `TextInput` and `List`; it renders as DOM on the
web and, on a mobile native screen, as native views.

```tsx
import { View, Text, TextInput, List } from "@farm.js/ui";

export default function Notes({ notes }) {
  return (
    <View padding="md">
      <TextInput placeholder="Search notes" onChange={setQuery} />
      <List
        items={notes}
        row={(note) => ({ title: note.title, subtitle: note.excerpt, href: `/notes/${note.id}` })}
      />
    </View>
  );
}
```

## Status

- **Web rendering ships today.** Every primitive renders semantic HTML with
  token styling, so it works on the web and on a mobile **web** screen now.
- **Native rendering is unreleased.** On a React Native screen, Metro resolves
  `@farm.js/ui` to its React Native build (from `@farm.js/native`, which apps
  with native screens install): native views, `List` as a recycling
  `FlatList`, and tokens resolved to the web defaults. It runs in tests, not
  yet on a device (see the [Mobile Apps](https://farmjs.dev/docs/mobile) docs).

## Why these components

Styling is token props (`padding="md"`, `background="surface"`, `radius="card"`),
not arbitrary CSS. That is what keeps a screen portable, and it is what lets
Farm's build-time analyzer recognize a page built from `@farm.js/ui` as one it
can port to a native screen automatically.

Raw values still pass through (`padding={10}`, `background="#fff"`), and every
box-like primitive takes a `style` escape hatch merged last.

## Theming

Color tokens resolve to CSS custom properties with a built-in fallback, so an
app theme can override them:

```css
:root {
  --farm-color-accent: #2f6f4f;
  --farm-color-surface: #f6f6f6;
}
```
