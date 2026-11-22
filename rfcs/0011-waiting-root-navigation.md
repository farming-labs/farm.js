# A first navigation out of a root that has not hydrated

Status: Draft (islands mode, web), open for discussion.

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
such a root waits for an interaction (RFC 0003, section 11), and a link click inside it is one:

1. The boot holds the click inside the root and requests the next page with `F-Render: tree`,
   whose response carries only the page's tree.
2. The entry loads React DOM, islx and the root's client modules (about 70 KB br, some 350 ms at
   1.6 Mbit/s), hydrates the root from the document's tree, and replays the click.
3. The router renders the next page's tree in the root.

The entry also hydrates such a root when the pointer moves over a link in it
(`hydrateForLink` in `generateClientHydrationEntry`), because the navigation renders the root
anyway.

But a root that has not hydrated holds no client state. Its DOM is server HTML, and what it would
hydrate from is the tree script (`<script type="f/tree">`) the document carries. A streamed
navigation response for the same route already carries the same three things a document does.
Requested from the bench's built islands server for `/shop/s1`:

| Navigation request | Raw     | gzip   | Page HTML | `f/tree` script | Root attributes on the boot script |
| ------------------ | ------- | ------ | --------- | --------------- | ---------------------------------- |
| `F-Render: tree`   | 15.4 KB | 5.0 KB | no        | yes (partial)   | yes                                |
| `F-Stream: flush`  | 31.4 KB | 6.7 KB | yes       | yes             | yes                                |

So the server needs no change for the browser to swap a waiting root's page the way it swaps a
streamed page, and keep the root waiting.

## Prior behavior elsewhere

- **Astro** swaps documents without hydrating anything; a framework island hydrates by its own
  directive afterwards, from the new document's props.
- **Farm's `rsc` engine** hydrates every client component with the first load, so its first
  navigation has nothing left to hydrate.

## Proposal

While a route's root has not hydrated, a link click in it that cannot run client code navigates
like a streamed page: the root's markup and its tree are replaced, and the root keeps waiting.
Once the root has hydrated, navigations render in it as today.

1. **Which clicks.** A click navigates without hydrating the root only when the anchor came from
   the server tree: a host `<a>` a server component rendered, or Farm's `Link` rendered by one.
   Such an anchor's props crossed the network, so it carries no event handler, and its click can
   do nothing in the browser except navigate. An anchor a client component rendered may have an
   `onClick` that calls `preventDefault()` (a link that opens a dialog), so its click still
   hydrates the root and replays, as today.
2. **How the browser tells them apart.** The DOM inside a root does not say which component
   rendered an element. The server tree resolver marks the anchors in point 1 with an attribute
   (proposed: `data-f-link`), as a prop in the tree itself, so the server's HTML and the
   browser's rebuild agree and hydration sees no difference. Anchors outside a root need no mark;
   islands already wrap client components in `<f-island>`.
3. **The boot.** A marked link in a waiting root starts the runtime without the renderer
   (`start(false)`), as a link outside a root does, and requests the page with `F-Stream: flush`
   instead of `F-Render: tree`. The root's modules are not preloaded.
4. **The router.** When the destination route has the same waiting root and the current root has
   not hydrated, the router swaps the root's content and the `f/tree` script from the streamed
   response, as it swaps a streamed page, and leaves the root's trigger armed. The pending root
   hydration reads the tree when it triggers, not when it was armed, so it hydrates the page now
   in the document. `hydrateForLink` skips marked links.
5. **Everything else is today's path.** A root that has hydrated, an unmarked link, a destination
   whose root differs, a root strategy of `load`, and the mobile client render in the root as
   before.

### Why the contract holds

- Before its trigger, a waiting root is server HTML plus a tree to hydrate from. After the swap it
  is exactly the document the server sends for the destination, so its later hydration is a first
  load's.
- A marked anchor has no client handler to skip, so navigating without running the root's code
  changes nothing a user can observe on the page being left.
- The root's client effects (`useEffect` in `CartBadge`, say) run on the destination's first
  interaction instead of on the click. That is what a first load of the destination does.

## Costs

- **Bytes.** The first navigation out of a waiting root fetches the page's HTML with its tree:
  6.7 KB gzip instead of 5.0 KB on `/shop/s1`. Later navigations, once the root has hydrated, are
  unchanged.
- **Markup.** Server-rendered links inside a root gain one attribute. It is in both the HTML and
  the tree, so hydration does not see a mismatch.
- **Root hydration moves.** It happens on the destination's first interaction, not on a link's
  hover. A reader who hovers a marked link and then clicks a client component hydrates the root on
  that click instead of on the hover.
- **Code.** A branch in the boot's request headers and preload choice, a branch in the router's
  swap for a waiting root, and the mark in the tree resolver.

## Estimated effect

Not measured. With React DOM, islx and the root's modules off the path, a first tap on shop and
guide should cost what docs and blog do, whose path is the same entry, router and streamed page:
roughly 320 to 400 ms instead of 776 and 826 at 1.6 Mbit/s, and an instant tap near docs' 137 ms
instead of 216 and 250.

## Alternatives

- **Preload React DOM while a waiting root idles.** Closes the gap for a reader who later taps,
  and charges about 70 KB br to every reader who never does. RFC 0010 rejected it for the same
  reason.
- **Navigate on every link click in a waiting root.** Simpler, and wrong for a client link whose
  `onClick` prevents navigation.
- **Mark client components' output instead of server links.** Comment markers around each client
  component would let the browser find unmarked regions, but React SSR cannot emit a comment
  around a component's output, and post-processing the stream costs more than a prop on the
  anchors.
- **Read the tree at click time.** The router could map the clicked anchor to the tree, but a
  client component's DOM has no fixed length in the tree, so the mapping breaks after the first
  one.

## Open questions

- The attribute's name, and whether a marked anchor outside a root (where the boot already knows)
  should carry it too, for one rule.
- Whether the destination must have the same root, or any waiting root (a different provider
  chain) can be swapped the same way.
