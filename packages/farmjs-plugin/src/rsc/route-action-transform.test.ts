import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import farmRsc from "./index.js";
import { transformFarmRouteActionClients } from "./route-action-transform";

const fixtures: string[] = [];

function createRscFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "farm-route-actions-"));
  fixtures.push(root);
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

  for (const packageName of [
    "react",
    "react-dom",
    "react-server-dom-webpack",
    "@vitejs/plugin-rsc",
  ]) {
    const source = [
      path.join(repositoryRoot, "node_modules", packageName),
      path.join(repositoryRoot, "examples/rsc-demo/node_modules", packageName),
    ].find((candidate) => existsSync(candidate));
    if (!source) throw new Error(`Missing route action fixture dependency: ${packageName}`);

    const target = path.join(root, "node_modules", packageName);
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(realpathSync(source), target, process.platform === "win32" ? "junction" : "dir");
  }

  return root;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe("Farm route action client transform", () => {
  it("emits an action-only proxy for a programmatic route", () => {
    const result = transformFarmRouteActionClients(
      `import { createRoute } from "@farm.js/core/routes";
import { updateProduct, publishProduct } from "./actions";
import { ProductPage } from "./product-page";
import { db } from "./db";

export const ProductRoute = createRoute("/products/[id]", {
  data: {
    async main({ params }) {
      return db.product.find(params.id);
    },
  },
  actions: {
    update: updateProduct,
    publishProduct,
  },
  defaultAction: "update",
  component: ProductPage,
});`,
      "/app/src/product.route.tsx",
    );

    expect(result?.routes).toEqual(["ProductRoute"]);
    expect(result?.code).toContain('import { updateProduct, publishProduct } from "./actions";');
    expect(result?.code).toContain('path: "/products/[id]"');
    expect(result?.code).toContain('"update": updateProduct');
    expect(result?.code).toContain('"publishProduct": publishProduct');
    expect(result?.code).toContain('defaultAction: "update"');
    expect(result?.code).toContain("action: updateProduct");
    expect(result?.code).not.toContain("ProductPage");
    expect(result?.code).not.toContain("./db");
    expect(result?.code).not.toContain("data:");
  });

  it("uses the first action when defaultAction is omitted", () => {
    const result = transformFarmRouteActionClients(
      `import { createRoute as route } from "@farm.js/core";
import save from "./save";
export const SettingsRoute = route('/settings', {
  actions: { save },
  component: SettingsPage,
});
export default SettingsRoute;`,
      "/app/src/settings.route.tsx",
    );

    expect(result?.code).toContain('import save from "./save";');
    expect(result?.code).toContain('defaultAction: "save"');
    expect(result?.code).toContain("action: save");
    expect(result?.code).toContain("export default SettingsRoute;");
  });

  it("requires route actions to come from a dedicated server module", () => {
    expect(() =>
      transformFarmRouteActionClients(
        `import { createRoute, createServerFn } from "@farm.js/core";
const save = createServerFn({ handler: async () => true });
export const SettingsRoute = createRoute('/settings', {
  actions: { save },
  component: SettingsPage,
});`,
        "/app/src/settings.route.tsx",
      ),
    ).toThrow("must reference a server function imported from another module");
  });

  it("rejects a defaultAction that is not declared", () => {
    expect(() =>
      transformFarmRouteActionClients(
        `import { createRoute } from "@farm.js/core";
import { save } from "./actions";
export const SettingsRoute = createRoute('/settings', {
  actions: { save },
  defaultAction: 'remove',
  component: SettingsPage,
});`,
        "/app/src/settings.route.tsx",
      ),
    ).toThrow('defaultAction "remove"');
  });

  it("only proxies route actions in the enabled client environment", async () => {
    const source = `import { createRoute } from "@farm.js/core/routes";
import { save } from "./actions";
export const SettingsRoute = createRoute('/settings', {
  actions: { save },
  component: SettingsPage,
});`;
    const plugins = farmRsc();
    const plugin = plugins.find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:route-action-clients",
    );
    const transform = plugin?.transform as (code: string, id: string) => { code: string } | null;

    expect(
      transform.call({ environment: { name: "client" } }, source, "/app/src/settings.route.tsx"),
    ).toBeNull();

    const configPlugin = plugins.find(
      (candidate) => candidate.name === "@farm.js/plugin/rsc:config",
    );
    const config = configPlugin?.config as (
      config: Record<string, unknown>,
      env: { command: "build"; mode: string },
    ) => Promise<unknown>;

    await config(
      {
        root: createRscFixture(),
        experimental: { serverComponents: true, serverActions: true },
      },
      { command: "build", mode: "production" },
    );

    expect(
      transform.call({ environment: { name: "client" } }, source, "/app/src/settings.route.tsx")
        ?.code,
    ).toContain("__farmRouteActionTarget");
    expect(
      transform.call({ environment: { name: "rsc" } }, source, "/app/src/settings.route.tsx"),
    ).toBeNull();
  });
});
