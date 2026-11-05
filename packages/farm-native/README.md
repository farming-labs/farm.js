# @farm.js/native

React Native screens for Farm.js mobile apps (experimental). A route becomes a React Native screen
on mobile when a `page.native.tsx` (or `page.android.tsx` / `page.ios.tsx`) sits next to its
`page.tsx`. The web page stays the web screen everywhere else and the runtime fallback (the web
twin) when the native screen fails.

```sh
pnpm add -D @farm.js/native react-native@^0.88 @react-native/metro-config@^0.88
pnpm add react@^19.2.8 react-dom@^19.2.8
```

This package peers on `react@>=19.2.8`. React Native 0.88 declares `react@^19.3.0` (its renderer is
built from React 19.3.0), but the mobile example runs its native screens on React 19.2.8, the
version Farm core is tested on, with one React in the dev bundle. On 19.2.8 your package manager
warns about React Native's peer; 19.2.8 is verified in `farm dev --mobile` on an Android emulator,
not yet in a production (Hermes bytecode) build. The web pages and the native screens bundle the
app's one `react`, so keep `react` and `react-dom` on a single version for both.

```tsx
// src/app/map/page.native.tsx
import { serverFetch, useNavigate, useRouteParams, useServerQuery } from "@farm.js/native";
import { FlatList, Pressable, Text } from "react-native";

async function listStations(): Promise<Array<{ id: string; name: string }>> {
  const response = await serverFetch("/api/stations");
  return response.json();
}

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

| Export                        | What it does                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `useNavigate()`               | `navigate(href, { replace })` by URL. The shell's navigator picks the next screen, web or native |
| `useRouteParams()`            | The screen's route params, such as `{ id: "7" }` for `/notes/[id]`                               |
| `useServerQuery(fn, input)`   | Calls `fn(input)` on mount and when the input changes: `{ data, error, pending, refetch }`       |
| `useServerQuery(..., opts)`   | `{ enabled: false }` skips the call until it is true                                             |
| `serverFetch(path, init)`     | `fetch` against `mobile.server` (the dev server under `farm dev --mobile`) with the base path    |
| `serverUrl(path)`             | The absolute URL of a path on `mobile.server`                                                    |
| `export const metadata.title` | The native bar's title                                                                           |

`useServerQuery` runs any async function, such as one that calls `serverFetch`. Passing a Farm
server function by reference (`import { listNotes } from "./notes.server"`) is not wired yet:
native screens reach the server over HTTP routes. Results are cached by function and input in one
cache shared by every native screen in the runtime, so a reopened screen shows its last result at
once and refetches it. Keep `fn` a stable module-level function (an inline arrow is a new cache
key on every render). `pending` is true only until the first result or error for an input;
`refetch()` keeps the old `data` while it runs, so track its progress yourself if a screen shows a
refresh indicator.

`@farm.js/native/build` is what `farm dev|build --mobile` loads: it writes one entry that
registers every screen under its manifest module id (such as `app/notes/[id]`), bundles it with
Metro, and compiles the build bundle to Hermes bytecode with the `hermesc` that ships with the
app's `react-native`. `farm dev --mobile` serves the entry from Metro with Fast Refresh.

A screen whose module throws while loading fails with `<module id> failed to load: <error>`, such
as `app/map failed to load: ReferenceError: stations is not defined`. In a build the route shows
its web twin and the shell logs that reason (`adb logcat -s FarmShell`). In dev, React Native's
error screen shows the original error instead, so it is not hidden behind the web page.

See the [Mobile Apps](https://farmjs.dev/docs/mobile#react-native-screens) docs.
