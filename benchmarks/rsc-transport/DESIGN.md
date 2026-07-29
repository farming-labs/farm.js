# Representation-aware RSC transport

## What this benchmark says

There is no universal winner between Flight, HTML, and reusable client renderers. The result depends on
the shape of the subtree, compression, renderer cache state, server work, and client work.

For this host-only content fixture:

- Normal element-tree Flight pays for React's composable tree representation even though the subtree
  contains no Client Components.
- Replacing that element tree with one opaque HTML value inside Flight retains RSC as the outer
  composition protocol while letting the browser's HTML parser reconstruct the host-only interior.
- Brotli makes repetitive HTML surprisingly compact. Raw HTML was more than twice the size of the
  semantic IR, but their compressed sizes were close.
- The released Strata N-API package measures the real server boundary, including its JavaScript
  wrapper and native call. The separate Rust/Wasm renderer measures the client-side tradeoff, where
  the reusable Wasm asset has a meaningful cold-start and transfer cost.
- The browser's DOM or React commit often cost more than decoding. Rewriting only the Flight decoder
  would therefore miss the larger element-count and reconciliation costs.

Opaque HTML in Flight is not a replacement for RSC. It is a restricted representation for one
eligible RSC subtree.

## State preservation

The benchmark renders both Flight representations beneath a stateful client shell and checks its
identity after every measured navigation. The shell state remains stable while the server-produced
subtree changes.

React still owns the shell and the opaque boundary. React does not own the individual DOM nodes
created inside `dangerouslySetInnerHTML`. Consequently:

- state outside the boundary can be preserved;
- the fragment can be replaced as a unit;
- independently updating Client Components cannot live inside the fragment;
- React cannot reconcile individual nodes inside it;
- event behavior inside it must use ordinary links/forms or an explicitly separate client island.

This is why eligibility must be proved before choosing the representation.

## Proposed architecture

The first implementation should live in the RSC integration or meta-framework, not as RSC-specific
policy in Farm core.

Farm core should provide generic primitives already useful to other protocols:

- build-graph metadata;
- virtual modules and emitted artifacts;
- stable content hashes;
- target-specific Rust transforms;
- plugin hooks for route and chunk manifests.

The RSC integration should own:

- Client Component reference analysis;
- subtree eligibility;
- Flight and HTML encoding;
- representation manifests;
- runtime selection;
- React boundary semantics;
- cache and security rules.

A route manifest could describe the representations that were proved safe:

```json
{
  "segment": "article-body",
  "representations": ["flight-tree", "flight-html", "ui-ir-js"],
  "containsClientReferences": false,
  "opaqueInterior": true,
  "cacheScope": "public",
  "contentHash": "…"
}
```

Application code should continue to look like ordinary components. An explicit escape hatch may be
useful during the first experimental phase, but the verbose resource-definition API should remain an
internal compiler representation.

## AOT safety, JIT choice

Build-time analysis should decide which representations are legal. Request-time policy should choose
only among those legal representations.

An opaque HTML candidate must have:

- no Client Component references below the boundary;
- no client-owned state, refs, effects, or event handlers inside;
- no unresolved Suspense slot that must stream independently;
- deterministic server rendering for its cache key;
- a trusted server-side HTML producer or mandatory sanitizer;
- an explicit policy for links, forms, and any allowed islands.

The runtime selector can then estimate:

```text
cost =
  server production
  + compressed bytes / estimated throughput
  + renderer cache-miss cost
  + decode or reconstruction
  + DOM or React commit
```

The choice should use hysteresis and coarse buckets, not change representation on every noisy timing
sample. Cache keys must include representation, content hash, locale, authorization scope, and any
capability header used for negotiation.

Recommended order:

1. Use normal Flight whenever the subtree contains Client Components or requires React-level
   composition.
2. Use opaque HTML-in-Flight for eligible host-only content that still needs to arrive through an RSC
   navigation.
3. Use plain HTML when React composition is not required at that boundary.
4. Use semantic IR plus a small JavaScript renderer when recurring payload savings repay the cached
   renderer.
5. Use Rust/Wasm on the client only for sufficiently large, repeated, CPU-heavy transforms after the
   Wasm asset is already cached or its cold cost is acceptable.

## Where Rust helps

The best initial Rust target is the server or build process:

```text
Markdown, CMS rich text, or typed content
                  ↓
       native Rust content compiler
                  ↓
     sanitized, trusted HTML fragment
                  ↓
       opaque value inside Flight
```

This does not attempt to reimplement the React renderer or Flight decoder in Rust. It accelerates a
well-defined content transform and reduces the number of React element records sent to the browser.

A generic Rust RSC renderer would have to reproduce React semantics, module references, Suspense,
errors, serialization rules, and version-specific protocol behavior. That is high-risk work, while
the benchmark shows that representation size and commit work are larger opportunities for this
workload.

## Security and correctness

Opaque HTML must never be a shortcut around escaping:

- accept only branded server-generated output;
- sanitize untrusted Markdown, CMS content, or user HTML before branding;
- support CSP and Trusted Types;
- prevent public caching of personalized fragments;
- never let a request header upgrade an ineligible subtree to opaque HTML;
- keep the standard Flight path as the correctness fallback.

## Implementation sequence

1. Keep this benchmark and add real application traces, lower-end devices, and network profiles.
2. Add an explicit experimental opaque-content boundary to the RSC plugin.
3. Use the released Strata native renderer for a narrow typed host tree and verify byte-for-byte
   output equivalence.
4. Emit AOT eligibility and size metadata in the RSC route manifest.
5. Add a conservative runtime selector with telemetry and a standard-Flight fallback.
6. Automate selection only after the safety rules and measurements remain stable across applications.
