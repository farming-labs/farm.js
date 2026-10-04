// @vitest-environment node

import type { Plugin } from "vite";
import { describe, expect, it } from "vitest";
import { createFarmRendererPlugin } from "../vite";

async function browserConditionsPlugin(): Promise<Plugin> {
  const plugins = (await createFarmRendererPlugin()) as unknown[];
  const plugin = plugins
    .flat(Infinity)
    .find((entry) => (entry as Plugin | undefined)?.name === "farm:svelte-browser-conditions");
  if (!plugin) throw new Error("browser conditions plugin missing");
  return plugin as Plugin;
}

type ConfigEnvironment = (
  name: string,
  options: { consumer?: string; resolve?: { conditions?: string[] } },
) => { resolve: { conditions: string[] } } | undefined;

describe("svelte browser conditions", () => {
  it("adds the client defaults Vite 6+ drops when the Svelte plugin sets conditions", async () => {
    const configEnvironment = (await browserConditionsPlugin())
      .configEnvironment as ConfigEnvironment;
    // vite-plugin-svelte 4 leaves `["svelte"]`, which replaces Vite 6+'s defaults.
    const result = configEnvironment("client", {
      consumer: "client",
      resolve: { conditions: ["svelte"] },
    });
    expect(result?.resolve.conditions).toEqual(["module", "browser", "development|production"]);
  });

  it("leaves server environments and lists that already target the browser alone", async () => {
    const configEnvironment = (await browserConditionsPlugin())
      .configEnvironment as ConfigEnvironment;
    expect(
      configEnvironment("ssr", { consumer: "server", resolve: { conditions: ["svelte"] } }),
    ).toBeUndefined();
    expect(
      configEnvironment("client", {
        consumer: "client",
        resolve: { conditions: ["svelte", "browser"] },
      }),
    ).toBeUndefined();
  });

  it("treats an environment named client without a consumer as the browser", async () => {
    const configEnvironment = (await browserConditionsPlugin())
      .configEnvironment as ConfigEnvironment;
    expect(
      configEnvironment("client", { resolve: { conditions: ["svelte", "module"] } })?.resolve
        .conditions,
    ).toEqual(["browser", "development|production"]);
  });
});
