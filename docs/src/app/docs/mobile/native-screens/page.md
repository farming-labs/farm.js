---
title: "Native Screens"
description: "Draw page.tsx with native views, choose which routes get native screens, and write React Native screens when a page needs code on the device."
section: "Runtime"
---

# Native Screens

Part of [Mobile Apps](/docs/mobile). A route can be more than a WebView in two ways:

- **Drawn from `page.tsx`.** A page that needs no JavaScript on the device is drawn with Android
  views and UIKit, from the HTML your server renders. Nothing extra to write.
- **React Native.** A `page.native.tsx` next to the page, for screens with state, gestures, or
  animation.

Either way the route keeps its `page.tsx`, and the app shows that web page whenever a native screen
cannot draw. How this works inside, including the three layers of fallback, is in
[How Farm draws a page natively](/blog/native-internals).

## Pages drawn natively

The shell asks your server for the page with `Accept: application/vnd.farm.native+json`. The server
renders it as it would for a browser, through middleware, guards and data loading, and answers with
a tree of native views instead of HTML. Only the page is drawn; the shell draws the bar and tabs
in place of your layouts.

```tsx
// src/app/notes/page.tsx: drawn natively as it is
export default async function Notes() {
  const notes = await db.notes.list();
  return (
    <main className="p-4">
      <h1 className="text-2xl font-bold">Notes</h1>
      <ul className="mt-4 flex flex-col gap-2">
        {notes.map((note) => (
          <li key={note.id} className="rounded-lg bg-gray-100 p-3">
            <a href={`/notes/${note.id}`}>{note.title}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

**What draws natively:** boxes (`div`, `section`, `main`, lists, …) as flex rows and columns with
gap, padding, margins, sizes, borders, radii, backgrounds and opacity; text with links, `<strong>`,
`<em>` and `<code>` inside it; images; links; tables; and [forms](#forms). Styles come from Tailwind classes
(the default theme, with `dark:`) and from your own CSS: the stylesheets the page links are
cascaded on the server, with variables and `prefers-color-scheme: dark`.

A table draws as rows whose cells split the row's width evenly, as `table-layout: fixed` lays them
out, so columns line up from row to row. A `colspan` cell takes a wider share, a cell with its own
`width` keeps it, and `<th>` is bold and centered. A `rowspan`, or a width set on a `<col>`, keeps
the page on the web.

**What keeps a page on the web:** anything that needs JavaScript on the device (hooks, event
handlers, `"use client"` components), and anything with no native equivalent yet:
`canvas`, `iframe`, `video`, `svg`, `select`, `dangerouslySetInnerHTML`, CSS grid, `fixed` and
`sticky` positioning, and `hover:` or responsive variants. Async pages and server components are
fine, since they run on the server.

If a request renders something the tree cannot draw, that visit shows the web page instead. Vue
and Svelte pages work the same way; there, exporting `hydrate = true` is what keeps a page on the
web.

### Forms

Plain HTML forms work with no JavaScript on the device, so the same page posts from a browser and
from the app:

```tsx
<form method="post" action="/api/reports">
  <input type="hidden" name="trail" value={trail.id} />
  <label>
    Report <textarea name="text" required maxLength={280} />
  </label>
  <button>Post report</button>
</form>
```

The shell submits as a browser does: the fields, hidden inputs and the pressed button, as
`application/x-www-form-urlencoded` or `multipart/form-data`, with your cookies. The server answers
as it would a browser: a redirect back to the page reloads it, a redirect elsewhere navigates, and
a page with validation errors is drawn in place. Text fields and `<textarea>` are supported;
checkboxes, selects, and file inputs keep the page on the web for now.

### Server actions

In a server components app (RSC or islx), a server action passed to a form works as it is, with no
wrapper:

```tsx
// src/app/notes/actions.ts
"use server";
export async function addNote(formData: FormData) {
  await db.notes.insert({ title: String(formData.get("title")) });
  redirect("/notes");
}
```

```tsx
// src/app/notes/page.tsx, a server component
import { addNote } from "./actions";

export default function Notes() {
  return (
    <form action={addNote}>
      <input name="title" />
      <button>Add</button>
    </form>
  );
}
```

The action runs on your server, never on the device: React renders the form as one a browser can
submit without JavaScript, and the shell posts it like any form. Hooks such as `useServerFn` run in
the browser, so a page that uses them stays on the web; a `page.native.tsx` calls server functions
by import instead ([below](#calling-your-server)).

### Refresh and accessibility

Pull to refresh loads the page again, and closing a modal refreshes the screen under it, so a list
shows what a modal form just saved. Screen readers get what a browser exposes: headings,
`aria-label`, a field's `<label>`, and `aria-hidden`.

## Choosing a screen

Nothing changes until you opt in. A route's screen is decided at build time, and the first of these
that decides wins, per route and per OS:

1. **The page export.** `export const mobile = { native: true }` requires a native screen;
   `{ native: false }` keeps the route on the web.
2. **`mobile.native.routes` in the config**, with `screen: "native"` or `"web"`, and `android` or
   `ios` to override one OS.
3. **The files** next to `page.tsx`: `page.native.tsx`, or `page.android.tsx` / `page.ios.tsx`.
4. **The analyzer**, when `mobile.native.auto` is `"on"`: every page that can draw natively does.
5. **Web.**

`{ native: true }` turns a wish into a check. If the page cannot draw natively and has no
`page.native.tsx`, `farm dev --mobile` and `farm build --mobile` fail and say why:

```text
mobile (os: android): src/app/page.tsx sets mobile.native to true, but "/" cannot render as a native screen:
  - src/app/page.tsx:4:19 useState() runs on the device
It needs JavaScript on the device: add page.native.tsx next to the page, or remove mobile.native.
```

To see what every route would get, and the first thing keeping each one on the web:

```sh
farm config inspect --mobile --report
```

```text
route        screen  tier     reason
/settings    web     native   renders natively, no JavaScript on the device
/notes/[id]  web     web      src/app/notes/[id]/page.tsx:41:9 dangerouslySetInnerHTML
```

| `mobile.native` | Notes                                                                                 |
| --------------- | ------------------------------------------------------------------------------------- |
| `auto`          | `"report"` (default) prints the report in builds; `"on"` applies it; `"off"` skips it |
| `routes`        | Per route: `screen` (`web`, `native`), `android`, `ios`, `presentation`               |
| `engine`        | `"react-native"` (default) or `"platform"` for `page.kt` / `page.swift` (planned)     |
| `prefetch`      | `"intent"` (default) or `"off"`                                                       |

## React Native screens

When a screen needs code on the device, add `page.native.tsx` next to the page. Install React Native
and `@farm.js/native` as dev dependencies; a web build never resolves them:

```sh
pnpm add -D @farm.js/native react-native@^0.88 @react-native/metro-config@^0.88
pnpm add react@^19.2.8 react-dom@^19.2.8
```

```tsx
// src/app/map/page.native.tsx
import { useNavigate, useServerQuery } from "@farm.js/native";
import { FlatList, Pressable, Text } from "react-native";
import { listStations } from "../../features/stations/server"; // a server function

export const metadata = { title: "Map" };

export default function MapScreen() {
  const navigate = useNavigate();
  const { data = [] } = useServerQuery(listStations, undefined);
  return (
    <FlatList
      data={data}
      renderItem={({ item }) => (
        <Pressable onPress={() => navigate(`/stations/${item.id}`)}>
          <Text>{item.name}</Text>
        </Pressable>
      )}
    />
  );
}
```

- `page.android.tsx` and `page.ios.tsx` override `page.native.tsx` on one OS.
- A `page.native.tsx` with no `page.tsx` is an app-only route: it exists in mobile builds only, and
  your web server answers it as not found.
- Screens navigate by URL, so the next screen can be web, native, a modal, or a tab.
- `farm dev --mobile` runs Metro with Fast Refresh. `farm build --mobile` compiles the screens to
  Hermes bytecode; a release app downloads no code.
- If a screen fails to start or throws, the app shows the route's `page.tsx` instead.
- React Native costs about 400 MB of first-build downloads on Android, and around 20 MB more
  installed on iOS. An app pays it only when at least one route has a React Native screen.

| `@farm.js/native`             | Notes                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `useNavigate()`               | `navigate(href, { replace })` by URL                                                    |
| `useRouteParams()`            | The route params, such as `{ id: "7" }` for `/notes/[id]`                               |
| `useServerQuery(fn, input)`   | Runs `fn(input)` on mount and when `input` changes: `{ data, error, pending, refetch }` |
| `serverFetch(path, init)`     | `fetch` against `mobile.server`, signed in once the user is                             |
| `serverUrl(path)`             | The absolute URL of a path on `mobile.server`                                           |
| `export const metadata.title` | The native bar's title                                                                  |

### Calling your server

React Native screens use your server the way web pages do:

- **Server functions:** import one and call it. Metro replaces the server module with a stub that
  posts to your server, so server code never ships in the app. Each server function a screen
  imports becomes a public endpoint, like a server action: validate its input and check the
  caller inside it.
- **API routes:** the typed client from `@farm.js/core/api/client` works on native screens and sends
  requests through `serverFetch`. Import it from there, not `@farm.js/core/client`, so one
  `lib/api.ts` serves both.
- **Signed-in calls:** once the user signs in, on a web or a native screen, requests carry the
  device's session. See [Authentication on mobile](/docs/auth#mobile-apps).

### Portable components

`@farm.js/ui` (`View`, `Text`, `Image`, `Pressable`, `TextInput`, `List`, `PhotoPicker`) renders DOM
on the web and native views on a React Native screen, from the same import. Styling is token props
(`padding="md"`, `background="surface"`), which is what keeps a page portable.

### Type-checking native files

Native files import `react-native`, which a web-only checkout may not have. Keep them out of the
web type-check and check them with their own config:

```jsonc
// tsconfig.json
{ "exclude": ["src/**/*.native.tsx", "src/**/*.android.tsx", "src/**/*.ios.tsx", "src/native"] }
```

```jsonc
// tsconfig.native.json: tsc -p tsconfig.native.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "lib": ["ESNext"], "customConditions": ["react-native"] },
  "include": ["src/**/*.native.tsx", "src/**/*.android.tsx", "src/**/*.ios.tsx", "src/native"],
  "exclude": [],
}
```

With `native.auto: "on"`, Android builds can also turn a page with state into a React Native screen
automatically, when everything it uses has a native equivalent (generated ports, experimental). The
report shows which routes qualify.
