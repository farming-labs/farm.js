// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";
import { startProductionServer } from "./production-server";

const core = fileURLToPath(new URL("../..", import.meta.url));
const executablePath = process.env.FARM_TEST_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
const hasBrowser = await fs.access(executablePath).then(
  () => true,
  () => false,
);

it.skipIf(!hasBrowser && process.env.FARM_REQUIRE_TEST_BROWSER !== "1").each([
  ["dev", "19"],
  ["production", "19"],
  ["production", "18"],
])(
  "keeps the server IDs for a page under server and client layouts in %s with React %s",
  async (mode, reactVersion) => {
    const root = await fs.mkdtemp(path.join(core, ".tmp-route-ids-"));
    let stop: (() => Promise<void>) | undefined;
    const browser = await chromium.launch({ executablePath });
    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(core, path.join(root, "node_modules", "@farm.js", "core"), "junction");
      const modules =
        reactVersion === "18"
          ? path.resolve(core, "../../examples/simple-demo/node_modules")
          : path.join(core, "node_modules");
      for (const name of ["react", "react-dom"]) {
        await fs.symlink(
          await fs.realpath(path.join(modules, name)),
          path.join(root, "node_modules", name),
          "junction",
        );
      }
      const files = {
        "package.json": '{"type":"module","private":true}',
        "src/field.tsx": `"use client";
import { useId, useState } from "react";
import { Link } from "@farm.js/core/client";
export default function Field() {
  const id = useId();
  const [clicked, setClicked] = useState(false);
  return <><Link href="/server/deep">Next</Link><button aria-controls={id} onClick={() => setClicked(true)}>Open</button><section id={id}>{clicked ? id : "closed"}</section></>;
}`,
        "src/app/server/layout.tsx": `export default function Layout({children}) {return <html><head/><body><header>Farm</header><main>{children}</main></body></html>}`,
        "src/app/client/layout.tsx": `"use client"; export default function Layout({children}) {return <html><head/><body><header>Farm</header><main>{children}</main></body></html>}`,
        "src/app/server/deep/layout.tsx": `import { Fragment } from "react";
export default function Layout({children}) {
  for (let i = 0; i < 30; i++) children = <Fragment>{[null, <div key="child">{children}</div>, null]}</Fragment>;
  return children;
}`,
        "src/app/server/deep/page.tsx": `"use client"; export { default } from "../../../field";`,
        "src/app/server/page.tsx": `"use client"; export { default } from "../../field";`,
        "src/app/client/page.tsx": `"use client"; export { default } from "../../field";`,
      };
      for (const [file, source] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await fs.writeFile(path.join(root, file), source);
      }
      let origin: string;
      if (mode === "dev") {
        const server = await createServer({ root, images: { provider: "none" }, telemetry: false });
        stop = () => server.close();
        const port = await getAvailablePort();
        await server.listen(port);
        origin = "http://localhost:" + port;
      } else {
        const config = await resolveConfig(
          { root, srcDir: "src", images: { provider: "none" }, telemetry: false },
          "production",
        );
        await build(config, { root, preset: "node-server" });
        const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
        stop = server.stop;
        origin = server.origin;
      }
      const page = await browser.newPage();
      const hydrationErrors: string[] = [];
      page.on("pageerror", (error) => hydrationErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && /hydrat|unique "key"/i.test(message.text())) {
          hydrationErrors.push(message.text());
        }
      });
      for (const route of ["server", "server/deep", "client"]) {
        const response = await page.goto(origin + "/" + route);
        const html = await response!.text();
        const serverId = /<button aria-controls="([^"]+)"/.exec(html)?.[1];
        expect(serverId).toBeTruthy();
        await page.locator("button").click();
        await page.waitForFunction(
          () => document.querySelector("section")?.textContent !== "closed",
        );
        expect.soft(await page.locator("section").textContent(), route).toBe(serverId);
        expect.soft(await page.locator("section").getAttribute("id"), route).toBe(serverId);
        expect
          .soft(await page.locator("button").getAttribute("aria-controls"), route)
          .toBe(serverId);
      }
      await page.goto(origin + "/server");
      await page.locator("button").click();
      await page.waitForFunction(() => document.querySelector("section")?.textContent !== "closed");
      await page.evaluate(() => {
        document.documentElement.dataset.sameDocument = "yes";
      });
      await page.getByRole("link", { name: "Next" }).click();
      await page.waitForURL("**/server/deep");
      await page.locator("button").click();
      await page.waitForFunction(() => document.querySelector("section")?.textContent !== "closed");
      expect(await page.locator("html").getAttribute("data-same-document")).toBe("yes");
      const panel = page.locator("section");
      expect(await panel.textContent()).toBe(await panel.getAttribute("id"));
      expect(hydrationErrors).toEqual([]);
    } finally {
      await browser.close();
      await stop?.();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  },
  180_000,
);
