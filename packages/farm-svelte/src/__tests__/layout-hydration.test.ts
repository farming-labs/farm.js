// @vitest-environment jsdom

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { flushSync } from "svelte";
import { compile } from "svelte/compiler";
import { afterAll, describe, expect, it } from "vitest";
import { FARM_LAYOUT_ELEMENT_CLIENT_SOURCE } from "../../../farm/src/document-layout-client";
import SvelteClient, { hydrateRoot } from "../client";
import SvelteServer, { renderToString } from "../server";

const fixtureDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".layout-hydration-fixture",
);

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

async function compileComponent(name: string, source: string, generate: "client" | "server") {
  await mkdir(fixtureDirectory, { recursive: true });
  const modulePath = path.join(fixtureDirectory, `${name}.${generate}.js`);
  await writeFile(modulePath, compile(source, { filename: `${name}.svelte`, generate }).js.code);
  return (await import(pathToFileURL(modulePath).href)).default;
}

// Evaluate the shared client source the way the generated entries do, with the
// renderer's compat runtime in scope as `React`.
function loadCreateLayoutElement() {
  return new Function(
    "React",
    `${FARM_LAYOUT_ELEMENT_CLIENT_SOURCE}\nreturn createFarmLayoutElement;`,
  )(SvelteClient);
}

const layoutSource = [
  "<script>",
  "  let { children } = $props();",
  "  let count = $state(0);",
  "</script>",
  '<header><button id="layout" onclick={() => count++}>layout {count}</button></header>',
  "<main>{@render children?.()}</main>",
].join("\n");

const pageSource = [
  "<script>",
  "  let count = $state(0);",
  "</script>",
  '<button id="page" onclick={() => count++}>page {count}</button>',
].join("\n");

const pageBoundaryProps = {
  id: "__farm_page__",
  "data-farm-segment": "page",
  "data-farm-client": "true",
  "data-farm-layout-client": "true",
  "data-farm-island": "page",
  "data-farm-island-strategy": "load",
};

describe("svelte layout hydration", () => {
  it("keeps the server markup of a hydrated layout that renders its children", async () => {
    const ServerLayout = await compileComponent("layout", layoutSource, "server");
    const ServerPage = await compileComponent("page", pageSource, "server");
    // The tree the server renderer builds for a page under a hydrated layout.
    const html = await renderToString(
      SvelteServer.createElement(
        "div",
        {
          "data-farm-layout-boundary": "true",
          "data-farm-layout-pattern": "/",
          style: { display: "contents" },
        },
        SvelteServer.createElement(ServerLayout, {
          children: SvelteServer.createElement(
            "div",
            pageBoundaryProps,
            SvelteServer.createElement(ServerPage, {}),
          ),
          params: {},
        }),
      ),
    );

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const serverHeader = container.querySelector("header");
    expect(serverHeader).toBeTruthy();

    const ClientLayout = await compileComponent("layout", layoutSource, "client");
    const ClientPage = await compileComponent("page", pageSource, "client");
    const createFarmLayoutElement = loadCreateLayoutElement();
    hydrateRoot(
      container,
      createFarmLayoutElement(
        ClientLayout,
        "/",
        SvelteClient.createElement(
          "div",
          pageBoundaryProps,
          SvelteClient.createElement(ClientPage, {}),
        ),
        {},
      ),
    );
    flushSync();

    expect(container.querySelector("header")).toBe(serverHeader);
    (container.querySelector("#layout") as HTMLButtonElement).click();
    (container.querySelector("#page") as HTMLButtonElement).click();
    flushSync();
    expect(container.querySelector("#layout")?.textContent).toBe("layout 1");
    expect(container.querySelector("#page")?.textContent).toBe("page 1");

    container.remove();
  });
});
