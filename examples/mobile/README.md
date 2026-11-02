# Farm Field Notes

One Farm app that is a normal web site in the browser and an Android app in Farm's native shell.
Everything mobile is config: the `mobile` block in `farm.config.ts`, a page's
`export const mobile`, and screen files next to `page.tsx`. A web build never reads any of it.

```sh
pnpm dev                 # web
pnpm build && pnpm start # web production build
pnpm report              # farm config inspect --mobile --report
pnpm dev:mobile          # Android shell against the dev server (needs @farm.js/mobile, the SDK)
pnpm build:apk           # farm build --mobile --apk
pnpm smoke               # checks the mobile decisions and the web build
```

## Routes

| Route                    | Shows                                                                     |
| ------------------------ | ------------------------------------------------------------------------- |
| `/`                      | Home tab: a static page that links every demo, and an external link       |
| `/notes`                 | Notes tab: a server-rendered list                                         |
| `/settings`              | Settings tab: i18n (`en`, `es`) with a language switch                    |
| `/about`                 | A static push, from Home or Settings (each tab keeps its own stack)       |
| `/notes/[id]`            | A dynamic route pushed on the Notes tab                                   |
| `/notes/new`             | `export const mobile = { presentation: "modal" }`, a form that calls the `createNote` server function and pushes the new note |
| `/navigation`            | Navigations the shell takes (Link, anchors, `navigateTo`, router replace) and the ones it never sees (hash links, back, forward, document loads) |
| `/navigation/step/[n]`   | `mobile.routes` sets `presentation: "replace"`: the wizard renders in one screen |
| `/docs/[...slug]`        | A catch-all route                                                         |
| `/feed`                  | 240 rows, for scroll and frame-time checks                                |
| `/stations/[id]`         | A programmatic route (`src/farm.routes.tsx`) whose data comes from `data.main` |
| `/map`                   | `page.native.tsx`; `mobile.native.routes` keeps it web on iOS             |
| `/camera`                | `page.native.tsx` with a `page.android.tsx` override                      |
| `/settings/device`       | `page.kt`: a platform screen on Android                                   |
| `/lab/packing`           | Only portable elements and inline styles: the analyzer says `port`        |
| `/lab/chart`             | A canvas through a ref, a table, and `window`: the analyzer lists why it stays web |

Native and platform screens show a placeholder in the shell: Farm records them in
`farm-routes.json` but does not build `page.native.tsx` or `page.kt` yet.

The root layout has no stylesheet, because the analyzer checks every layout above a route. Styled
routes get `globals.css` from the `(styled)` route group's layout; `/lab` routes use inline styles.

`mobile.server` defaults to `https://field-notes.farmjs.dev`; set `FIELD_NOTES_SERVER` to point
`farm build --mobile` at your own deployment.
