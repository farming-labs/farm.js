# A first navigation out of a root that has not hydrated

Status: Draft (islands mode, web). Implementation: #3071, open; values before islx runs: #3073,
open.

## Problem

RFC 0010 took React DOM off a first navigation's path when the next page streams in. A route
whose layout hydrates as one React root, such as a client provider around the pages, still waits
for it. Measured with `first-navigation.mjs` on `benchmarks/server-components-payload`, medians
of 5 rounds in ms, `rsc` / islands with RFC 0010 (HTTP/2, 4x CPU; Apple M1, macOS 26.2, Node
24.21.0, Chrome 157; 2026-11-21):

| Section | Root            | 150 ms latency at 1.6 Mbit/s, 80 ms tap | 50 ms latency, instant tap |
| ------- | --------------- | --------------------------------------- | -------------------------- |
| docs    | none            | 266 / 316                               | 124 / 137                  |
| blog    | none            | 290 / 389                               | 169 / 162                  |
| shop    | `CartProvider`  | 225 / 776                               | 121 / 216                  |
| guide   | `ThemeProvider` | 307 / 826                               | 226 / 250                  |

shop and guide are as far behind `rsc` as every section was before RFC 0010. In islands mode
such a root waits for an interaction (RFC 0003, section 11), but the production router treated a
navigation out of it as a render in it:

1. The boot holds a link's click, as it does anywhere, and requests the next page with
   `F-Render: tree`, whose response carries only the page's tree. It also preloads React DOM and
   the root's client modules (about 70 KB br, some 350 ms at 1.6 Mbit/s).
2. The router renders that tree in a new React root over the old one
   (`createMatchedHydrationRoute`), so the navigation waits for React DOM, islx and the root's
   modules.
3. The entry hydrates such a root when the pointer moves over a link in it (`hydrateForLink` in
   `generateClientHydrationEntry`), so that a mouse navigation can update the root instead of
   creating it.

But a root that has not hydrated holds no client state. Its DOM is server HTML, and what it would
hydrate from is the tree script (`<script type="f/tree">`) the document carries. A streamed
navigation response for the same route already carries the same three things a document does.
Requested from the bench's built islands server for `/shop/s1`:

| Navigation request | Raw     | gzip   | Page HTML | `f/tree` script | Root attributes on the boot script |
| ------------------ | ------- | ------ | --------- | --------------- | ---------------------------------- |
| `F-Render: tree`   | 15.4 KB | 5.0 KB | no        | yes (partial)   | yes                                |
| `F-Stream: flush`  | 31.4 KB | 6.7 KB | yes       | yes             | yes                                |

So the server needs no change for the browser to swap a waiting root's page the way it swaps a
streamed page, and keep the root waiting. The `farm dev` router already does: it swaps the page
in and schedules the root by the route's strategy.

## Prior behavior elsewhere

- **Astro** swaps documents without hydrating anything; a framework island hydrates by its own
  directive afterwards, from the new document's props.
- **Farm's `rsc` engine** hydrates every client component with the first load, so its first
  navigation has nothing left to hydrate.

## Decision

While no React root owns the page's root, a navigation lands the next page the way a first load
of it would. Once the root has hydrated, navigations render in it as before.

1. **The request.** The router asks for the next page whole, without `F-Render: tree`, while React
   does not own the root. The boot's request for a held click does the same. A whole page answers
   a request the router would stream, since a response without flush markers is all shell, so the
   router takes the boot's response (`takeFarmEarlyNavigation`).
2. **The swap.** `swapContent` replaces the root's content, as for a page without such a layout,
   and schedules the root by the destination route's strategy through the same function the first
   load uses (`scheduleFarmRouteHydration`). A strategy of `load` hydrates at once, as before. The
   destination may have the same root or another one; either is a first load's root after the
   swap.
3. **Intent.** Hovering a link no longer hydrates the root (`hydrateForLink` is removed from the
   production and dev entries). Pressing or focusing a link no longer starts the island or root
   around it either, matching its click, which the scheduler already let through
   (`heldClickTarget`). The boot preloads the router for a link and the root's modules and React
   DOM only for another interaction in the root.
4. **The entry.** It no longer loads React DOM and islx when it starts. What first renders or
   hydrates loads them, as the islands runtime facade and `createMatchedHydrationRoute` already
   did (RFC 0010).
5. **Removed.** The router's branch for a payload-only page in a root that never hydrated: a tree
   response now comes only for a root React owns.

No configuration or public API changes.

### Why the contract holds

- Before its trigger, a waiting root is server HTML plus a tree to hydrate from. After the swap it
  is exactly the document the server sends for the destination, so its later hydration is a first
  load's. A contract test hydrates the root after a swap and keeps the provider's state across the
  navigations after it.
- The root's client effects (`useEffect` in `CartBadge`, say) run on the destination's first
  interaction instead of on the click. That is what a first load of the destination does.
- A link a client component renders in a waiting root navigates on its click without running its
  `onClick`. Before this change it did the same on a tap; only a mouse hover, by hydrating the root
  first, gave the handler a chance. Islands already behave this way: the scheduler and the boot let
  a link's click through in an island that has not hydrated.

## Costs

- **Data per navigation.** Until the root hydrates, a navigation carries the page's HTML as well as
  its tree. Before islx runs, the browser holds no value store, so the router names no values
  (`F-Values`) and the server sends them again. On the bench's shop section that is 6.0 KB br per
  navigation instead of 2.0 KB. #3073 names the value scripts the page holds until islx runs and
  keeps them through the swap, which brings it to 4.4 KB, three quarters of it the page's HTML. The JavaScript a navigation loads falls by more, from 9.7 to 2.7 KB
  br on average over ten navigations, since React DOM, islx and the root's modules no longer load
  on the first hover.
- **Root hydration moves.** It happens on the destination's first interaction, not on a link's
  hover. A reader who hovers a link and then clicks a client component hydrates the root on that
  click instead.
- **Code.** Smaller: on the bench build the client entry is 44 B br lighter, the boot 24 B
  lighter, and the router 6 B heavier.

## Results

`first-navigation.mjs`, interleaved: `rsc` / islands just before (`main` at df6c467af) / islands
with this change, medians in ms (HTTP/2, 4x CPU; Apple M1, macOS 26.2, Node 24.21.0, Chrome 157;
2026-11-22, load average 7 to 71). Medians of 5, of 9 for the 150 ms, 80 ms tap.

| Section | 150 ms at 1.6 Mbit/s, 80 ms tap | 50 ms, instant tap | 150 ms, 80 ms tap | 50 ms, 100 ms hover |
| ------- | ------------------------------- | ------------------ | ----------------- | ------------------- |
| docs    | 267 / 317 / 316                 | 124 / 115 / 121    | 246 / 217 / 211   | 85 / 31 / 38        |
| blog    | 303 / 390 / 379                 | 162 / 168 / 165    | 269 / 227 / 218   | 139 / 66 / 67       |
| shop    | 223 / 788 / 350                 | 111 / 203 / 126    | 247 / 241 / 213   | 87 / 60 / 47        |
| guide   | 306 / 837 / 397                 | 158 / 221 / 170    | 273 / 251 / 235   | 134 / 97 / 77       |

- At 1.6 Mbit/s a first tap on shop and guide now costs what docs and blog do: 438 and 440 ms
  less, and 127 and 91 ms behind `rsc`, whose first load already brought its 71 KB.
- An instant tap on a fast network is 77 and 51 ms faster on shop and guide, 15 and 12 ms behind
  `rsc`.
- With 150 ms of latency an 80 ms tap is faster than `rsc` in every section.
- docs and blog are unchanged within noise: their path was already this one.

This RFC's draft estimated 320 to 400 ms at 1.6 Mbit/s, which held, and an instant tap near docs'
137 ms; it came in at 126 ms on shop and 170 ms on guide.

## Alternatives

- **Mark server-rendered links (this RFC's first draft).** The server tree resolver would mark the
  anchors a server component rendered (`data-f-link`), and only those would navigate without
  hydrating the root, so a client link's `onClick` could still prevent a navigation. It needs a
  mark in islx's tree and the boot, and it would protect a handler that today's taps already skip.
  If client links in waiting containers need that protection, it belongs to islands and roots
  alike, as a separate change.
- **Preload React DOM while a waiting root idles.** Closes the gap for a reader who later taps,
  and charges about 70 KB br to every reader who never does. RFC 0010 rejected it for the same
  reason.
- **Keep the tree request and render it without React DOM.** The tree is React's input; rendering
  it needs React, which is the cost this RFC removes.
- **Keep the root's layouts out of the response.** Only the page changes, but under a hydrating
  layout the page is most of the document (on shop, 154 bytes of the root are layout), so leaving
  layouts out saves little.

## Open questions

- Values before islx runs, answered by #3073. Until islx loads, the page's `f/value` scripts are
  the only copy of its values, so a navigation named none and the server sent them again. The
  router and the boot now name the scripts the document holds, and the swap keeps the ones the
  next page leaves out. That applies to every islands navigation before islx runs, not only under
  a waiting root.
