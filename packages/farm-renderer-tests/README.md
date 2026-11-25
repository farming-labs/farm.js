# @farm.js/renderer-tests

**The conformance suite Farm.js runs against its official renderers, published so you can run it against yours.**

Each `define*Conformance` function registers Vitest suites that call your renderer's modules the
way Farm does and fail where your renderer behaves differently from the official ones.

## Install

```bash
pnpm add -D @farm.js/renderer-tests vitest
```

Vitest 5 is a peer dependency: the suites register with your project's own Vitest.

## Use

```ts
// test/server.test.ts
// @vitest-environment node
import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { myRenderer } from "../src/index";
import * as server from "../src/server";

defineRendererDescriptorConformance({
  name: "my-renderer",
  createDescriptor: myRenderer,
  expected: { server: "my-renderer/server", client: "my-renderer/client" },
});

defineRendererServerConformance(server);
```

The client suite needs a DOM. Install `jsdom` and run it in that environment:

```ts
// test/client.test.ts
// @vitest-environment jsdom
import { defineRendererClientConformance } from "@farm.js/renderer-tests";
import * as client from "../src/client";
import * as server from "../src/server";

defineRendererClientConformance({
  name: "my-renderer",
  client,
  server,
  // The value your descriptor declares in `capabilities.reconcilesRerenders`.
  reconcilesRerenders: true,
});
```

| Function                               | What it checks                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `defineRendererDescriptorConformance`  | The descriptor names all three modules and returns fresh arrays on each call.                                                        |
| `defineRendererServerConformance`      | Element primitives, escaping, React-style props, function components, error boundaries, and shell errors in each stream.             |
| `defineRendererClientConformance`      | The client exports Farm imports, mounting and updating a root, a new root replacing existing markup, events, and hydrating in place. |
| `defineRendererServerQueryConformance` | Server renders never share the browser query cache between visitors.                                                                 |
| `defineRendererNativeTreeConformance`  | The mobile native tier reads your server markup the same way as any other renderer's.                                                |
| `defineRendererIslandsConformance`     | `withIsland()` writes islands Farm's runtime starts, and `wrapClientGraph()` and `isolateServerPageGraph()` turn them off and on.    |
| `defineRendererSourceConformance`      | `routes()`, `hydration.resolve()` and `compile()` give the answer you list for each file in your format, every time.                 |

A renderer that declares `capabilities.islands`, or reads its own file format, runs two more.
List files in your format, relative to the project root, with what each hook should say about them:

```ts
// test/server.test.ts
import {
  defineRendererIslandsConformance,
  defineRendererSourceConformance,
} from "@farm.js/renderer-tests";

defineRendererIslandsConformance({ name: "my-renderer", server });

defineRendererSourceConformance({
  name: "my-renderer",
  createDescriptor: myRenderer,
  files: [
    { path: "src/app/blog/[slug].mine", route: { kind: "page", pattern: "/blog/[slug]" } },
    { path: "src/app/blog/_card.mine", route: null },
    {
      path: "src/components/counter.mine",
      source: '<script>"use client";</script><button>0</button>',
      client: true,
    },
  ],
});
```

## What it doesn't do

- It doesn't start a Farm app. It calls your modules directly in Node and jsdom. Check the module
  shapes Farm imports by type-checking them against `@farm.js/core/renderer`, and check dev and
  production behavior by running an app on your renderer.
- It holds your renderer to what the official ones do, including the React-style props Farm's own
  components pass, such as `className` and numeric `style` values. A renderer with different
  conventions fails those checks.
- Stream checks run only for the primitives your server module exports.

See [Renderers](https://farmjs.dev/docs/renderers#renderer-modules) for the full contract.
