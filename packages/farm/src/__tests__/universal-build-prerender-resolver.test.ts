// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createPrerenderRuntimeResolverPlugin } from "../nitro/universal-build";

type ResolveCall = { id: string; importer: string | undefined; options: Record<string, unknown> };

function createContext(resolutions: Record<string, string>) {
  const calls: ResolveCall[] = [];
  return {
    calls,
    async resolve(id: string, importer: string | undefined, options: Record<string, unknown>) {
      calls.push({ id, importer, options });
      const resolved = resolutions[id];
      return resolved ? { id: resolved, external: false } : null;
    },
  };
}

const NITRO_ENTRY = "/workspace/app/node_modules/nitro/dist/index.mjs";

async function resolveWithPlugin(
  plugin: ReturnType<typeof createPrerenderRuntimeResolverPlugin>,
  context: ReturnType<typeof createContext>,
  id: string,
  options: Record<string, unknown> = {},
) {
  const resolveId = plugin.resolveId as (
    this: unknown,
    id: string,
    importer: string | undefined,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  return resolveId.call(context, id, "\0#nitro-internal-virtual/storage", options);
}

describe("createPrerenderRuntimeResolverPlugin", () => {
  it("retries unresolved bare ids from Nitro's package context", async () => {
    // Nitro's virtual modules import unstorage/h3 with a virtual importer;
    // under pnpm's strict layout these transitive deps only resolve from
    // Nitro's own location (#403).
    const plugin = createPrerenderRuntimeResolverPlugin("/workspace/app", () => NITRO_ENTRY);
    const context = createContext({
      unstorage:
        "/workspace/app/node_modules/.pnpm/unstorage@1.0.0/node_modules/unstorage/dist/index.mjs",
    });

    const resolved = await resolveWithPlugin(plugin, context, "unstorage");

    expect(resolved).toMatchObject({ external: false });
    expect(context.calls[0]).toMatchObject({
      id: "unstorage",
      importer: NITRO_ENTRY,
      options: { skipSelf: true, custom: { farmPrerenderRuntimeResolve: true } },
    });
  });

  it("ignores relative, absolute, virtual, and builtin ids", async () => {
    const plugin = createPrerenderRuntimeResolverPlugin("/workspace/app", () => NITRO_ENTRY);
    const context = createContext({});

    for (const id of [
      "./chunk.mjs",
      "/abs/path.mjs",
      "\0virtual-id",
      "#nitro-internal-virtual/storage",
      "virtual:farm-ssr-entry",
      "node:fs",
      "fs",
    ]) {
      await expect(resolveWithPlugin(plugin, context, id)).resolves.toBeNull();
    }
    expect(context.calls).toHaveLength(0);
  });

  it("does not recurse when re-entered from its own retry", async () => {
    const plugin = createPrerenderRuntimeResolverPlugin("/workspace/app", () => NITRO_ENTRY);
    const context = createContext({});

    await expect(
      resolveWithPlugin(plugin, context, "unstorage", {
        custom: { farmPrerenderRuntimeResolve: true },
      }),
    ).resolves.toBeNull();
    expect(context.calls).toHaveLength(0);
  });

  it("returns null when Nitro's entry cannot be resolved", async () => {
    const plugin = createPrerenderRuntimeResolverPlugin("/workspace/app", () => {
      throw new Error("nitro not installed");
    });
    const context = createContext({});

    await expect(resolveWithPlugin(plugin, context, "unstorage")).resolves.toBeNull();
    expect(context.calls).toHaveLength(0);
  });
});
