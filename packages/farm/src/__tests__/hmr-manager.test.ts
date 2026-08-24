// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { ModuleNode, ViteDevServer } from "vite";
import { HMRManager } from "../hmr";

interface FakeModuleInit {
  url: string;
  type?: "js" | "css";
  isSelfAccepting?: boolean;
}

function createModule(init: FakeModuleInit): ModuleNode {
  return {
    url: init.url,
    type: init.type ?? "js",
    isSelfAccepting: init.isSelfAccepting ?? false,
    importers: new Set<ModuleNode>(),
    acceptedHmrDeps: new Set<ModuleNode>(),
  } as unknown as ModuleNode;
}

function link(importer: ModuleNode, imported: ModuleNode, options: { accepts?: boolean } = {}) {
  (imported.importers as Set<ModuleNode>).add(importer);
  if (options.accepts) {
    (importer.acceptedHmrDeps as Set<ModuleNode>).add(imported);
  }
}

function createServer(changed: ModuleNode) {
  const send = vi.fn();
  const server = {
    ws: { send },
    moduleGraph: {
      getModuleByUrl: vi.fn(async () => changed),
      invalidateModule: vi.fn(),
    },
  } as unknown as ViteDevServer;
  return { server, send };
}

function sentUpdatePaths(send: ReturnType<typeof vi.fn>): string[] {
  const payload = send.mock.calls[0]?.[0];
  return (payload?.updates ?? []).map((update: { path: string }) => update.path).sort();
}

describe("HMRManager affected-module traversal", () => {
  it("includes the self-accepting boundary and stops above it", async () => {
    // page -> widget(self-accepting) -> util(changed)
    const util = createModule({ url: "/src/util.ts" });
    const widget = createModule({ url: "/src/widget.ts", isSelfAccepting: true });
    const page = createModule({ url: "/src/page.ts" });
    link(widget, util);
    link(page, widget);
    const { server, send } = createServer(util);

    await new HMRManager(server).handleFileChange("/src/util.ts");

    // The boundary itself must receive the update; its importers must not.
    expect(sentUpdatePaths(send)).toEqual(["/src/util.ts", "/src/widget.ts"]);
  });

  it("stops at the changed module when it accepts itself", async () => {
    const widget = createModule({ url: "/src/widget.ts", isSelfAccepting: true });
    const page = createModule({ url: "/src/page.ts" });
    link(page, widget);
    const { server, send } = createServer(widget);

    await new HMRManager(server).handleFileChange("/src/widget.ts");

    expect(sentUpdatePaths(send)).toEqual(["/src/widget.ts"]);
  });

  it("stops at an importer that accepts the changed dependency", async () => {
    // page -> consumer(accepts dep) -> dep(changed)
    const dep = createModule({ url: "/src/dep.ts" });
    const consumer = createModule({ url: "/src/consumer.ts" });
    const page = createModule({ url: "/src/page.ts" });
    link(consumer, dep, { accepts: true });
    link(page, consumer);
    const { server, send } = createServer(dep);

    await new HMRManager(server).handleFileChange("/src/dep.ts");

    expect(sentUpdatePaths(send)).toEqual(["/src/consumer.ts", "/src/dep.ts"]);
  });

  it("keeps climbing through importers that do not accept", async () => {
    // root -> mid -> leaf(changed), nobody accepts
    const leaf = createModule({ url: "/src/leaf.ts" });
    const mid = createModule({ url: "/src/mid.ts" });
    const root = createModule({ url: "/src/root.ts" });
    link(mid, leaf);
    link(root, mid);
    const { server, send } = createServer(leaf);

    await new HMRManager(server).handleFileChange("/src/leaf.ts");

    expect(sentUpdatePaths(send)).toEqual(["/src/leaf.ts", "/src/mid.ts", "/src/root.ts"]);
  });

  it("still climbs through a module that is a boundary for one edge but not another", async () => {
    // shared imports both: a (accepted) and b (not accepted); changed module
    // feeds both edges. The climb through b must not be blocked by shared's
    // boundary role on the a edge.
    const changed = createModule({ url: "/src/changed.ts" });
    const a = createModule({ url: "/src/a.ts" });
    const b = createModule({ url: "/src/b.ts" });
    const shared = createModule({ url: "/src/shared.ts" });
    const top = createModule({ url: "/src/top.ts" });
    link(a, changed);
    link(b, changed);
    link(shared, a, { accepts: true });
    link(shared, b);
    link(top, shared);
    const { server, send } = createServer(changed);

    await new HMRManager(server).handleFileChange("/src/changed.ts");

    expect(sentUpdatePaths(send)).toEqual([
      "/src/a.ts",
      "/src/b.ts",
      "/src/changed.ts",
      "/src/shared.ts",
      "/src/top.ts",
    ]);
  });

  it("survives importer cycles", async () => {
    const one = createModule({ url: "/src/one.ts" });
    const two = createModule({ url: "/src/two.ts" });
    link(two, one);
    link(one, two);
    const { server, send } = createServer(one);

    await new HMRManager(server).handleFileChange("/src/one.ts");

    expect(sentUpdatePaths(send)).toEqual(["/src/one.ts", "/src/two.ts"]);
  });
});
